/// The mermaid-free form, which only tests need: production always has a
/// (possibly empty) SVG map to pass. Keeps one public entry point rather
/// than two that must be kept in step.
fn render_markdown_to_html(markdown: &str, title: &str, doc_dir: &Path) -> String {
    render_markdown_to_html_with_mermaid(markdown, title, doc_dir, HashMap::new(), &ExportTypefaces::default())
}

use super::math::*;
use super::preprocess::*;
use super::*;
use std::fs;
use tempfile::tempdir;

fn doc_dir() -> std::path::PathBuf {
    tempdir().expect("tempdir").keep()
}

#[test]
fn embeds_bundled_serif_font() {
    let html = render_markdown_to_html("hello", "doc", &doc_dir());
    assert!(html.contains("@font-face"), "font faces embedded");
    assert!(
        html.contains("font-family: \"Latin Modern Roman\""),
        "body uses the bundled serif: {html:.400}"
    );
    assert!(html.contains("data:font/woff2;base64,"), "font inlined as data URI");
}

#[test]
fn body_has_no_padding_so_page_margins_stay_consistent() {
    // Page margins come from @page / NSPrintInfo, never body padding (which
    // would apply once to the whole flow → first-page-only top margin + an
    // empty trailing page). Guards against a regression to body padding.
    let html = render_markdown_to_html("hi", "doc", &doc_dir());
    assert!(html.contains("padding: 0;"), "body padding zeroed: {html:.500}");
    assert!(html.contains("@page { size: letter; margin: 2cm; }"), "{html:.500}");
}

#[test]
fn renders_wikilinks_as_links_not_raw_brackets() {
    let html =
        render_markdown_to_html("See [[Daily Note]] and [[plan|the plan]].", "doc", &doc_dir());
    assert!(html.contains(">Daily Note</a>"), "{html}");
    assert!(html.contains(">the plan</a>"), "{html}");
    assert!(!html.contains("[[Daily Note]]"), "raw brackets must be gone: {html}");
}

#[test]
fn plain_text_keeps_every_character_and_line_break() {
    let html = render_plain_text_to_html("# not a heading\n  *not emphasis*\n<b>tag</b> & more", "todo", &ExportTypefaces::default());

    assert!(html.contains("<div class=\"plain-text\"># not a heading\n  *not emphasis*\n&lt;b&gt;tag&lt;/b&gt; &amp; more</div>"), "{html}");
    assert!(!html.contains("<h1") && !html.contains("<em>"), "{html}");
    assert!(html.contains("<title>todo</title>"));
}

#[test]
fn a_wikilink_that_names_a_markdown_extension_keeps_it() {
    assert_eq!(wikilink_href("plan.mdown#part"), "plan.mdown");
    assert_eq!(wikilink_href("Plan.MD"), "Plan.MD");
    assert_eq!(wikilink_href("plan"), "plan.md");
}

#[test]
fn leaves_wikilinks_in_fenced_code_alone() {
    let html = render_markdown_to_html("```\n[[Literal]]\n```", "doc", &doc_dir());
    assert!(html.contains("[[Literal]]"), "code-fenced wikilink stays literal: {html}");
}

#[test]
fn a_tilde_line_inside_a_backtick_fence_does_not_end_it() {
    // A ~~~ line inside a backtick fence is content per CommonMark, so
    // the wikilink under it stays literal.
    let md = "```\n~~~\n[[Still Code]]\n```\n\n[[Real Link]]";
    let html = render_markdown_to_html(md, "doc", &doc_dir());
    assert!(html.contains("[[Still Code]]"), "inside the fence stays literal: {html}");
    assert!(html.contains(">Real Link</a>"), "prose wikilink still converts: {html}");
}

#[test]
fn a_shorter_closer_does_not_end_a_longer_fence() {
    // ```` opens; a ``` line is content per CommonMark, not a closer.
    let md = "````\n```\n[[Code]]\n````\n";
    let html = render_markdown_to_html(md, "doc", &doc_dir());
    assert!(html.contains("[[Code]]"), "{html}");
}

#[test]
fn protects_fences_nested_in_list_items() {
    // Fence indent limits are container-relative: 4 absolute spaces inside
    // a "1. " item is a fence to comrak, so its body must never be
    // wikilink-rewritten.
    let md = "1. Install:\n\n    ```bash\n    npm i [[not-a-link]]\n    ```\n\nSee [[Real]].";
    let html = render_markdown_to_html(md, "doc", &doc_dir());
    // The body renders as highlighted code (tokens split across syntect
    // spans), so assert the rewrite's absence, not a contiguous substring.
    assert!(!html.contains("not-a-link.md"), "fence body must not be rewritten: {html}");
    assert!(html.contains("language-bash"), "still a code block: {html}");
    assert!(html.contains(">Real</a>"), "prose wikilink still converts: {html}");
}

#[test]
fn protects_wikilinks_inside_inline_code_spans() {
    let md = "prose [[Link]] and `[[literal]]` in one line";
    let html = render_markdown_to_html(md, "doc", &doc_dir());
    assert!(html.contains(">Link</a>"), "{html}");
    assert!(html.contains("[[literal]]"), "inline-code wikilink stays literal: {html}");
}

#[test]
fn inline_code_protection_survives_multibyte_prefixes() {
    // Sourcepos columns count UTF-8 bytes; multibyte chars before the code
    // span must not shift the protected range.
    let md = "héllo — `[[code]]` then [[Real]]";
    let html = render_markdown_to_html(md, "doc", &doc_dir());
    assert!(html.contains("[[code]]"), "{html}");
    assert!(html.contains(">Real</a>"), "{html}");
}

#[test]
fn protects_indented_code_blocks() {
    let md = "para\n\n    [[indented code]]\n\n[[Real]]";
    let html = render_markdown_to_html(md, "doc", &doc_dir());
    assert!(html.contains("[[indented code]]"), "{html}");
    assert!(html.contains(">Real</a>"), "{html}");
}

#[test]
fn mermaid_tag_with_leading_space_still_renders_the_diagram() {
    // "``` Mermaid": the editor's CodeInfo excludes the leading space and
    // matches the tag case-insensitively — the export must agree.
    let mut svgs = HashMap::new();
    svgs.insert("graph TD; A-->B".to_string(), "<svg id=\"s\"></svg>".to_string());
    let html = render_markdown_to_html_with_mermaid(
        "``` Mermaid\ngraph TD; A-->B\n```",
        "doc",
        &doc_dir(),
        svgs, &ExportTypefaces::default(),
    );
    assert!(
        html.contains("<figure class=\"mermaid-diagram\"><svg id=\"s\">"),
        "{html:.400}"
    );
}

#[test]
fn mermaid_fence_with_meta_exports_as_source_like_the_editor() {
    // The editor renders a diagram only for a bare `mermaid` info string;
    // "mermaid title=x" shows as source there and must export as source.
    let mut svgs = HashMap::new();
    svgs.insert("graph TD; A-->B".to_string(), "<svg id=\"m\"></svg>".to_string());
    let html = render_markdown_to_html_with_mermaid(
        "```mermaid title=x\ngraph TD; A-->B\n```",
        "doc",
        &doc_dir(),
        svgs, &ExportTypefaces::default(),
    );
    assert!(!html.contains("<figure"), "meta fence must stay source: {html:.400}");
    assert!(html.contains("language-mermaid"), "{html:.400}");
}

#[test]
fn list_nested_mermaid_fence_normalizes_its_tag_too() {
    // The opener-line surgery must handle container indentation, where the
    // marks sit past 3 absolute columns.
    let mut svgs = HashMap::new();
    svgs.insert("graph LR; A-->B".to_string(), "<svg id=\"n\"></svg>".to_string());
    let html = render_markdown_to_html_with_mermaid(
        "- item\n\n  ```Mermaid\n  graph LR; A-->B\n  ```",
        "doc",
        &doc_dir(),
        svgs, &ExportTypefaces::default(),
    );
    assert!(html.contains("<svg id=\"n\">"), "{html:.400}");
}

#[test]
fn mermaid_fence_language_is_matched_case_insensitively() {
    // The editor accepts ```Mermaid; comrak's per-language dispatch is
    // exact-match, so the info token is normalized before parsing.
    let mut svgs = HashMap::new();
    svgs.insert("graph TD; A-->B".to_string(), "<svg id=\"c\"></svg>".to_string());
    let html = render_markdown_to_html_with_mermaid(
        "```Mermaid\ngraph TD; A-->B\n```",
        "doc",
        &doc_dir(),
        svgs, &ExportTypefaces::default(),
    );
    assert!(
        html.contains("<figure class=\"mermaid-diagram\"><svg id=\"c\">"),
        "a case-varied mermaid tag still renders its diagram: {html:.400}"
    );
}

#[test]
fn typesets_dollar_math_as_mathml() {
    let inline = render_markdown_to_html("mass-energy: $E = mc^2$.", "doc", &doc_dir());
    assert!(inline.contains("<math"), "inline $…$ becomes MathML: {inline:.300}");
    assert!(
        !inline.contains("data-math-style"),
        "the comrak math span is converted, not left raw: {inline:.300}"
    );

    let block = render_markdown_to_html("$$\\frac{a}{b}$$", "doc", &doc_dir());
    assert!(block.contains("<math"), "block $$…$$ becomes MathML: {block:.300}");
    assert!(block.contains("display=\"block\""), "display math uses block: {block:.300}");
}

#[test]
fn renders_array_with_spaced_column_spec_as_a_table() {
    // The textbook writes `{r | r}` with spaces around the pipe; pulldown-latex
    // rejects spaces in a column spec, so this must be normalized to `{r|r}`.
    let md = "$$\n\\begin{array}{r | r}\n2 & 180 \\\\\n\\hline\n& 45\n\\end{array}\n$$";
    let html = render_markdown_to_html(md, "doc", &doc_dir());
    assert!(html.contains("<mtable"), "valid array renders as a MathML table: {html:.400}");
    assert!(!html.contains("merror"), "no parser error for a valid array: {html:.400}");
    assert!(!html.contains("$$"), "the raw $$ delimiters are gone: {html:.400}");
}

#[test]
fn invalid_array_renders_a_graceful_error_not_raw_dollars() {
    // `{2}` is not a valid column spec — a genuine source error. It must
    // degrade to an inline (red) error, never the literal `$$…$$`.
    let md = "$$\n\\begin{array}{2}\na & b \\\\\n\\end{array}\n$$";
    let html = render_markdown_to_html(md, "doc", &doc_dir());
    assert!(!html.contains("$$"), "no raw $$ for an invalid array: {html:.400}");
    // pulldown-latex emits an in-band <merror>; that is the graceful marker.
    assert!(html.contains("merror"), "invalid array shows a math error: {html:.400}");
}

#[test]
fn array_spec_normalization_preserves_nested_brace_content() {
    // Top-level spaces go; spacing inside a nested `@{…}` stays.
    assert_eq!(normalize_array_column_specs("\\begin{array}{r | r}"), "\\begin{array}{r|r}");
    assert_eq!(normalize_array_column_specs("\\begin{array}{l r r}"), "\\begin{array}{lrr}");
    assert_eq!(
        normalize_array_column_specs("\\begin{array}{c @{ : } c}"),
        "\\begin{array}{c@{ : }c}"
    );
    // Non-array braces are untouched.
    assert_eq!(normalize_array_column_specs("\\frac{a b}{c}"), "\\frac{a b}{c}");
}

#[test]
fn renders_core_gfm_constructs() {
    let md = "# Title\n\nsome **bold** and ~~strike~~.\n\n\
              | a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] todo\n- [x] done\n";
    let html = render_markdown_to_html(md, "doc", &doc_dir());
    assert!(html.contains("<h1"));
    assert!(html.contains("<strong>bold</strong>"));
    assert!(html.contains("<del>strike</del>"));
    assert!(html.contains("<table>"));
    assert!(html.contains("type=\"checkbox\""));
    assert!(html.contains("<!doctype html>"));
    assert!(html.contains("<title>doc</title>"));
}

#[test]
fn syntax_highlights_fenced_code() {
    // A known language gets syntect color spans + a theme background on the
    // <pre>, matching the editor's highlighted rendering.
    let html = render_markdown_to_html("```rust\nfn main() {}\n```", "doc", &doc_dir());
    assert!(
        html.contains("<span style=\"color:"),
        "fenced code should be syntax-highlighted: {html:.500}"
    );
    assert!(
        html.contains("background-color:"),
        "highlighted <pre> carries a theme background: {html:.500}"
    );
}

#[test]
fn mermaid_fence_without_svg_falls_back_to_source() {
    // No SVG supplied → the diagram degrades to its source, never a blank.
    let html = render_markdown_to_html("```mermaid\ngraph TD; A-->B\n```", "doc", &doc_dir());
    assert!(html.contains("graph TD"), "mermaid fence keeps its source: {html:.300}");
    assert!(!html.contains("<figure"), "no diagram figure without an svg: {html:.300}");
}

#[test]
fn mermaid_fence_with_svg_is_inlined_as_a_diagram() {
    let mut svgs = HashMap::new();
    svgs.insert("graph TD; A-->B".to_string(), "<svg id=\"d\"></svg>".to_string());
    let html = render_markdown_to_html_with_mermaid(
        "```mermaid\ngraph TD; A-->B\n```",
        "doc",
        &doc_dir(),
        svgs, &ExportTypefaces::default(),
    );
    assert!(
        html.contains("<figure class=\"mermaid-diagram\"><svg id=\"d\">"),
        "supplied SVG is inlined as a diagram: {html:.400}"
    );
    assert!(!html.contains("language-mermaid"), "no source code block remains: {html:.400}");
}

#[test]
fn drops_yaml_frontmatter() {
    let md = "---\ntitle: Secret Meta\ntags: [a, b]\n---\n\n# Body Heading\n";
    let html = render_markdown_to_html(md, "doc", &doc_dir());
    assert!(html.contains("Body Heading"));
    assert!(
        !html.contains("Secret Meta"),
        "frontmatter must not render into the body: {html}"
    );
}

#[test]
fn inlines_local_images_and_leaves_remote_alone() {
    let dir = doc_dir();
    fs::write(dir.join("pic.png"), crate::image_file::fixtures::PNG).unwrap();
    let md = "![local](pic.png)\n\n![remote](https://example.com/x.png)\n";
    let html = render_markdown_to_html(md, "doc", &dir);
    assert!(
        html.contains("data:image/png;base64,"),
        "local image should be inlined: {html}"
    );
    assert!(
        html.contains("https://example.com/x.png"),
        "remote image should be left as-is: {html}"
    );
}

#[test]
fn missing_local_image_is_left_untouched_not_fatal() {
    let html = render_markdown_to_html("![x](nope.png)", "doc", &doc_dir());
    assert!(html.contains("nope.png"));
    assert!(!html.contains("data:image"));
}

#[test]
fn percent_decoded_image_path_resolves() {
    let dir = doc_dir();
    fs::create_dir_all(dir.join("my images")).unwrap();
    fs::write(dir.join("my images/p.png"), crate::image_file::fixtures::PNG).unwrap();
    let html = render_markdown_to_html("![x](my%20images/p.png)", "doc", &dir);
    assert!(html.contains("data:image/png;base64,"), "{html}");
}

#[test]
fn a_wikilink_becomes_a_link_and_a_broken_one_stays_text() {
    // Export is the last stop: a wikilink left as `[[...]]` prints raw
    // brackets in the PDF, and one converted with an empty target prints a
    // link that goes nowhere.
    let mut out = String::new();
    let mut cursor = 0;
    let line = "see [[Some Note]] here";
    convert_one_wikilink(line, line.find("[[").unwrap(), &mut cursor, &mut out);
    out.push_str(&line[cursor..]);
    // The destination is not percent-encoded, and does not need to be: the
    // angle-bracket form is exactly the one that permits spaces. Encoding
    // it as well would produce a path with a literal `%20` in it.
    assert_eq!(out, "see [Some Note](<Some Note.md>) here", "got {out}");

    // `target|label` shows the label and links the target.
    let mut out = String::new();
    let mut cursor = 0;
    let line = "[[Target|Shown]]";
    convert_one_wikilink(line, 0, &mut cursor, &mut out);
    assert!(out.starts_with("[Shown](<"), "label is what the reader sees: {out}");
    assert!(out.contains("Target"), "target is what it points at: {out}");
}

#[test]
fn an_unclosed_or_empty_wikilink_is_left_alone_and_still_advances() {
    // Two things at once, and the second is the one with teeth. The caller
    // loops on `line[cursor..].find("[[")`, so a path that declines to
    // convert must still move the cursor past the opener — otherwise it
    // finds the same `[[` forever and the export hangs.
    //
    // Asserting only the text cannot see that: with the cursor left at 0
    // the caller's `push_str(&line[cursor..])` re-emits the same bytes the
    // literal would have.
    for line in ["[[never closed", "[[]]", "[[ |label]]"] {
        let mut out = String::new();
        let mut cursor = 0;
        convert_one_wikilink(line, 0, &mut cursor, &mut out);
        assert!(cursor >= 2, "{line}: cursor stuck at {cursor}, the caller would spin");
        out.push_str(&line[cursor..]);
        assert_eq!(out, line, "{line} should survive verbatim");
    }
}

#[test]
fn a_line_of_broken_wikilinks_terminates() {
    // The property the cursor rule exists for, through the real caller.
    let line = "[[a [[b [[c";
    let mut out = String::new();
    convert_wikilinks_in_line(line, &[], &mut out);
    assert_eq!(out, line);
}

#[test]
fn a_mermaid_fence_is_recognised_however_it_is_written() {
    // The opener is normalized so the mermaid pass can find it. Miss one
    // spelling and that diagram exports as a code block instead of a
    // picture — which still looks like a successful export.
    let normalized = |line: &str| {
        let mut out = String::new();
        normalize_mermaid_opener_line(line, &mut out);
        out
    };
    // What is normalized is the language token's *case*; the surrounding
    // layout is left exactly as the author wrote it.
    assert_eq!(normalized("```Mermaid"), "```mermaid");
    assert_eq!(normalized("```MERMAID"), "```mermaid");
    assert_eq!(normalized("   ```Mermaid"), "   ```mermaid", "indent preserved");
    assert_eq!(normalized("```  Mermaid"), "```  mermaid", "padding preserved");
    assert_eq!(normalized("~~~Mermaid"), "~~~mermaid", "tilde fences too");
    assert_eq!(normalized("````Mermaid"), "````mermaid", "longer fences");

    // Another language is not ours to touch, and a line with no fence at
    // all must survive verbatim — this runs over every line of the document.
    assert_eq!(normalized("```rust"), "```rust");
    assert_eq!(normalized("```mermaidish"), "```mermaidish", "a prefix is not a match");
    assert_eq!(normalized("plain text"), "plain text");
}
