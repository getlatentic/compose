import AppKit

/// Rich text as HTML, so the app converts it with the same Markdown converter a
/// paste goes through.
enum RichText {
    static func html(from value: NSSecureCoding?) -> String? {
        guard let rich = attributed(value) else { return nil }
        let range = NSRange(location: 0, length: rich.length)
        let attributes: [NSAttributedString.DocumentAttributeKey: Any] = [
            .documentType: NSAttributedString.DocumentType.html
        ]
        guard let data = try? rich.data(from: range, documentAttributes: attributes) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private static func attributed(_ value: NSSecureCoding?) -> NSAttributedString? {
        switch value {
        case let rich as NSAttributedString: return rich
        case let data as Data:
            return NSAttributedString(rtf: data, documentAttributes: nil)
                ?? NSAttributedString(rtfd: data, documentAttributes: nil)
        default: return nil
        }
    }
}
