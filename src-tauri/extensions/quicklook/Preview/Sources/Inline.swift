import Foundation

/// A run's text as HTML: escaped, wrapped in whatever inline intents it
/// carries, and with Compose's own `[[wiki links]]` marked up — `AttributedString`
/// leaves those literal, and a note's links are most of why a preview is useful.
enum Inline {
    static func render(run: AttributedString.Runs.Run, text: String) -> String {
        if run.imageURL != nil {
            return placeholder(alt: text)
        }
        var html = wikiLinks(in: HTMLRenderer.escape(text))
        html = html.replacingOccurrences(of: "\n", with: "<br>\n")
        for (intent, tag) in wrappers where run.inlinePresentationIntent?.contains(intent) == true {
            html = "<\(tag)>\(html)</\(tag)>"
        }
        if let destination = run.link?.absoluteString {
            html = "<a href=\"\(HTMLRenderer.escape(destination))\">\(html)</a>"
        }
        return html
    }

    /// Innermost first, so `*`code`*` nests the way the source reads.
    private static let wrappers: [(InlinePresentationIntent, String)] = [
        (.code, "code"),
        (.emphasized, "em"),
        (.stronglyEmphasized, "strong"),
        (.strikethrough, "del"),
    ]

    /// Quick Look runs an extension sandboxed — it is registered only if it is
    /// — and that sandbox grants the previewed file alone, not the folder it
    /// sits in, so a note's images cannot be read (`NSFileReadNoPermissionError`).
    /// Showing them would mean asking for the user's folders so a preview that
    /// opens on a keypress could read them, which is not a trade worth making.
    private static func placeholder(alt: String) -> String {
        // An image with no alt text arrives as U+FFFC, the object replacement
        // character that stands in for the attachment itself.
        let stripped = alt.replacingOccurrences(of: "\u{FFFC}", with: "")
            .trimmingCharacters(in: .whitespaces)
        let label = stripped.isEmpty ? "image" : HTMLRenderer.escape(stripped)
        return "<span class=\"image-placeholder\">\(label)</span>"
    }

    /// Consuming `target|` in a non-capturing group leaves group 1 holding what
    /// the reader should see, whether or not the link was aliased.
    private static let wikiLink = try! NSRegularExpression(
        pattern: #"\[\[(?:[^\[\]|]+\|)?([^\[\]|]+)\]\]"#
    )

    private static func wikiLinks(in escaped: String) -> String {
        guard escaped.contains("[[") else { return escaped }
        return wikiLink.stringByReplacingMatches(
            in: escaped, range: NSRange(escaped.startIndex..., in: escaped),
            withTemplate: "<span class=\"wikilink\">$1</span>"
        )
    }
}
