//! TeX in a note, typeset as MathML that WebKit draws in the export.

/// Typeset the math comrak tagged. comrak's math extension emits
/// `<span data-math-style="inline|display">latex</span>` for `$…$` / `$$…$$`
/// (it expects a client-side renderer). The export has none, so convert each
/// span to MathML, which WebKit typesets natively in the PDF.
pub(super) fn render_math_to_mathml(html: &str) -> String {
    const OPEN: &str = "<span data-math-style=\"";
    const CLOSE: &str = "</span>";
    let mut out = String::with_capacity(html.len() + 64);
    let mut rest = html;
    while let Some(at) = rest.find(OPEN) {
        out.push_str(&rest[..at]);
        let after = &rest[at + OPEN.len()..];
        match (after.find('"'), after.find('>'), after.find(CLOSE)) {
            (Some(quote), Some(gt), Some(close)) if quote < gt && gt < close => {
                let block = &after[..quote] == "display";
                let escaped_latex = &after[gt + 1..close];
                out.push_str(&latex_to_mathml(escaped_latex, block));
                rest = &after[close + CLOSE.len()..];
            }
            // Not a well-formed math span — emit the tag verbatim, keep scanning.
            _ => {
                out.push_str(OPEN);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Render one LaTeX equation (HTML-escaped, as comrak emits it) to MathML. On a
/// parse error, fall back to the escaped source so no content is lost.
pub(super) fn latex_to_mathml(escaped_latex: &str, block: bool) -> String {
    use pulldown_latex::config::DisplayMode;
    use pulldown_latex::{push_mathml, Parser, RenderConfig, Storage};

    let latex = normalize_array_column_specs(&html_unescape(escaped_latex));
    let storage = Storage::new();
    let parser = Parser::new(&latex, &storage);
    let config = RenderConfig {
        display_mode: if block { DisplayMode::Block } else { DisplayMode::Inline },
        ..RenderConfig::default()
    };
    let mut mathml = String::new();
    if push_mathml(&mut mathml, parser, config).is_ok() {
        mathml
    } else {
        format!("<code class=\"math-error\">{escaped_latex}</code>")
    }
}

/// Reverse comrak's HTML escaping so the raw LaTeX reaches the math parser.
pub(super) fn html_unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

/// Collapse insignificant whitespace inside every `\begin{array}{…}` column
/// spec. pulldown-latex's array parser rejects spaces between column tokens
/// (`{r | r}`, `{l r r}`) that KaTeX and LaTeX itself accept — so without this
/// an otherwise-valid array renders as a parser error instead of a table. Spaces
/// in a column spec carry no meaning, so stripping them is a faithful rewrite.
/// Nested brace groups (`@{…}`, `p{…}`, `*{n}{…}`) keep their contents verbatim.
pub(super) fn normalize_array_column_specs(latex: &str) -> String {
    const BEGIN: &str = "\\begin{array}";
    let mut out = String::with_capacity(latex.len());
    let mut rest = latex;
    while let Some(at) = rest.find(BEGIN) {
        out.push_str(&rest[..at]);
        out.push_str(BEGIN);
        let after = &rest[at + BEGIN.len()..];
        // The column spec is the next `{…}` group, possibly after whitespace.
        let spec_start = after.trim_start_matches([' ', '\t', '\n', '\r']);
        match (spec_start.starts_with('{')).then(|| take_brace_group(spec_start)).flatten() {
            Some((spec, tail)) => {
                out.push('{');
                out.push_str(&strip_spec_whitespace(spec));
                out.push('}');
                rest = tail;
            }
            // No `{…}` follows (malformed); leave the rest untouched.
            None => rest = after,
        }
    }
    out.push_str(rest);
    out
}

/// Given a string starting with `{`, return the contents of that brace group
/// (excluding the outer braces) and the remainder after the matching `}`.
/// Returns `None` if the braces are unbalanced.
pub(super) fn take_brace_group(s: &str) -> Option<(&str, &str)> {
    let bytes = s.as_bytes();
    debug_assert_eq!(bytes.first(), Some(&b'{'));
    let mut depth = 0usize;
    for (i, &b) in bytes.iter().enumerate() {
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some((&s[1..i], &s[i + 1..]));
                }
            }
            _ => {}
        }
    }
    None
}

/// Remove top-level whitespace from a column spec, preserving the contents of
/// any nested brace group (e.g. `@{ : }`) where spacing can be significant.
pub(super) fn strip_spec_whitespace(spec: &str) -> String {
    let mut out = String::with_capacity(spec.len());
    let mut depth = 0usize;
    for ch in spec.chars() {
        match ch {
            '{' => {
                depth += 1;
                out.push(ch);
            }
            '}' => {
                depth = depth.saturating_sub(1);
                out.push(ch);
            }
            ' ' | '\t' | '\n' | '\r' if depth == 0 => {}
            _ => out.push(ch),
        }
    }
    out
}
