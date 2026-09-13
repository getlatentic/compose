import Foundation

/// A note split into the parts a preview cares about.
///
/// Frontmatter is metadata, not prose: left in place it parses as a thematic
/// break followed by a paragraph of `key: value` lines, which is the first
/// thing the reader would see.
struct MarkdownDocument {
    let title: String?
    let body: String

    init(source: String) {
        let (frontmatter, body) = MarkdownDocument.split(source)
        self.body = body
        self.title = frontmatter.flatMap(MarkdownDocument.title(inFrontmatter:))
            ?? MarkdownDocument.firstHeading(in: body)
    }

    private static func split(_ source: String) -> (frontmatter: String?, body: String) {
        let lines = source.components(separatedBy: "\n")
        guard lines.first?.trimmingCharacters(in: .whitespaces) == "---" else {
            return (nil, source)
        }
        guard
            let close = lines.dropFirst().firstIndex(where: {
                $0.trimmingCharacters(in: .whitespaces) == "---"
            })
        else {
            // An unterminated fence is just a thematic break; leave it alone.
            return (nil, source)
        }
        return (
            lines[1..<close].joined(separator: "\n"),
            lines[(close + 1)...].joined(separator: "\n")
        )
    }

    /// The `title:` value, read as a line rather than as YAML — a preview needs
    /// a label, not a document model.
    private static func title(inFrontmatter frontmatter: String) -> String? {
        for line in frontmatter.components(separatedBy: "\n") {
            guard let separator = line.firstIndex(of: ":"),
                line[..<separator].trimmingCharacters(in: .whitespaces) == "title"
            else { continue }
            let value = line[line.index(after: separator)...]
                .trimmingCharacters(in: .whitespaces)
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            return value.isEmpty ? nil : value
        }
        return nil
    }

    private static func firstHeading(in body: String) -> String? {
        for line in body.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("#") else { continue }
            let text = trimmed.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces)
            return text.isEmpty ? nil : text
        }
        return nil
    }
}
