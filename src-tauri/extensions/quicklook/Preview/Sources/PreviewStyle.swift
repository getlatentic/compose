import Foundation

/// The page a rendered note is dropped into.
///
/// Quick Look shows a preview in whatever appearance the Mac is in, and the
/// panel paints its own background behind the page, so both schemes are
/// defined here rather than inherited.
enum PreviewStyle {
    static func page(title: String?, body: String) -> String {
        """
        <!doctype html>
        <meta charset="utf-8">
        <title>\(title.map(HTMLRenderer.escape) ?? "")</title>
        <style>\(css)</style>
        <article>\(body)</article>
        """
    }

    private static let css = """
        :root {
          color-scheme: light dark;
          --fg: #1a1a1a; --muted: #6b6b6b; --bg: #ffffff;
          --rule: #e0e0e0; --surface: #f4f4f4; --accent: #0f62fe;
        }
        @media (prefers-color-scheme: dark) {
          :root {
            --fg: #f4f4f4; --muted: #a8a8a8; --bg: #161616;
            --rule: #393939; --surface: #262626; --accent: #78a9ff;
          }
        }
        html { background: var(--bg); }
        body { margin: 0; }
        article {
          color: var(--fg);
          font: 15px/1.6 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
          margin: 0 auto;
          max-width: 46em;
          padding: 2.5em 3em 4em;
          -webkit-text-size-adjust: 100%;
        }
        h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.5em; font-weight: 600; }
        h1 { font-size: 1.9em; margin-top: 0; letter-spacing: -0.02em; }
        h2 { font-size: 1.45em; }
        h3 { font-size: 1.2em; }
        h4, h5, h6 { font-size: 1em; }
        p, ul, ol, blockquote, pre, table { margin: 0 0 1em; }
        ul, ol { padding-left: 1.5em; }
        li { margin: 0.25em 0; }
        li > ul, li > ol { margin: 0.25em 0 0; }
        li input[type="checkbox"] { margin-right: 0.3em; vertical-align: baseline; }
        a { color: var(--accent); text-decoration: none; }
        a:hover { text-decoration: underline; }
        .wikilink { color: var(--accent); border-bottom: 1px dotted currentColor; }
        .image-placeholder { color: var(--muted); font-style: italic; }
        code {
          background: var(--surface);
          border-radius: 3px;
          font: 0.88em/1.5 ui-monospace, "SF Mono", Menlo, monospace;
          padding: 0.12em 0.35em;
        }
        pre {
          background: var(--surface);
          border-radius: 6px;
          overflow-x: auto;
          padding: 0.9em 1.1em;
        }
        pre code { background: none; padding: 0; }
        blockquote {
          border-left: 3px solid var(--rule);
          color: var(--muted);
          padding-left: 1em;
        }
        blockquote > :last-child { margin-bottom: 0; }
        hr { background: var(--rule); border: 0; height: 1px; margin: 2em 0; }
        table { border-collapse: collapse; display: block; overflow-x: auto; width: max-content; max-width: 100%; }
        th, td { border: 1px solid var(--rule); padding: 0.45em 0.8em; text-align: left; }
        th { background: var(--surface); font-weight: 600; }
        img { border-radius: 4px; max-width: 100%; }
        """
}
