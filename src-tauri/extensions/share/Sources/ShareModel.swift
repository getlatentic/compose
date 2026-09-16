import Foundation

@MainActor
final class ShareModel: ObservableObject {
    @Published var draft = ClipDraft()
    @Published var loading = true
    @Published var destinations: [Destinations.Workspace] = []
    @Published var workspaceId: String?
    @Published var failure: String?
    /// The files that opened in Compose, when a clip came with them.
    @Published var opened: String?

    var canSave: Bool { !loading && !draft.isEmpty }

    /// A few lines of what will be saved, for the sheet. Tags are stripped for
    /// display only; the app converts the real HTML.
    var excerpt: String? {
        let source = draft.text
            ?? draft.html?.replacingOccurrences(
                of: "<[^>]+>", with: " ", options: .regularExpression)
        let collapsed = source?
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        return collapsed?.isEmpty == false ? collapsed : nil
    }

    /// The workspace the sheet opens on: the one last saved to, while it still
    /// exists, else the one open in Compose.
    nonisolated static func defaultWorkspace(in destinations: Destinations?, lastUsed: String?)
        -> String?
    {
        guard let destinations else { return nil }
        let ids = destinations.workspaces.map(\.id)
        if let lastUsed, ids.contains(lastUsed) { return lastUsed }
        if let active = destinations.activeWorkspaceId, ids.contains(active) { return active }
        return ids.first
    }
}
