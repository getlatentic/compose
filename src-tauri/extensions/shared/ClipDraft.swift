import Foundation

/// What the user is about to save, assembled from whatever the sharing app
/// handed over.
struct ClipDraft: Equatable {
    var title = ""
    var url: URL?
    var text: String?
    var html: String?
    var page: String?
    var images: [ClipImage] = []

    private static let titleLimit = 120

    var isEmpty: Bool {
        url == nil && (text ?? "").isEmpty && (html ?? "").isEmpty && (page ?? "").isEmpty
            && images.isEmpty
    }

    /// A clip is filed under a title, so one is always proposed: what the app
    /// called the item, else the first line of its text, else where it came from.
    static func suggestedTitle(itemTitle: String?, text: String?, url: URL?) -> String {
        if let title = firstLine(itemTitle) { return title }
        if let line = firstLine(text) { return line }
        if let host = url?.host, !host.isEmpty { return host }
        return "Clipping"
    }

    func clip(id: String, workspaceId: String?, createdAt: Date, open: Bool = false) -> Clip {
        Clip(
            version: Clip.currentVersion,
            id: id,
            createdAt: Int64((createdAt.timeIntervalSince1970 * 1000).rounded()),
            workspaceId: workspaceId,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            url: url?.absoluteString,
            text: text,
            html: html,
            page: page,
            markdown: nil,
            images: images.map(\.fileName),
            open: open
        )
    }

    private static func firstLine(_ text: String?) -> String? {
        guard
            let line = text?
                .split(whereSeparator: \.isNewline)
                .lazy
                .map({ $0.trimmingCharacters(in: .whitespaces) })
                .first(where: { !$0.isEmpty })
        else { return nil }
        return String(line.prefix(titleLimit))
    }
}
