import Foundation

enum WebLink {
    /// `text` as a web address, when it is one and nothing else: such a note is
    /// about the page, and keeps the address as where it came from.
    static func only(in text: String) -> URL? {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.contains(where: \.isWhitespace),
            let url = URL(string: text),
            let scheme = url.scheme?.lowercased(),
            scheme == "http" || scheme == "https",
            url.host?.isEmpty == false
        else { return nil }
        return url
    }
}

extension String {
    /// Trimmed, or `nil` when nothing is left.
    var trimmedToContent: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
