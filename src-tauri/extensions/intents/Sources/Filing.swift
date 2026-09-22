import Foundation

/// Leaving a note for Compose to file, and telling the user where it went.
struct Filing {
    let inbox: ShareInbox

    /// The folder this extension shares with Compose.
    static func located() throws -> Filing {
        guard let inbox = ShareInbox.located() else { throw IntentFailure.unreachable }
        return Filing(inbox: inbox)
    }

    /// Leaves `draft` for Compose to file in `workspaceId`, or in the workspace
    /// open in Compose when it files it.
    func file(_ draft: ClipDraft, workspaceId: String?, open: Bool, now: Date = Date()) throws -> Clip {
        let clip = draft.clip(id: UUID().uuidString, workspaceId: workspaceId, createdAt: now, open: open)
        try inbox.write(clip, images: draft.images)
        return clip
    }

    /// Where `clip` went. A Compose that is not running files it when it next
    /// opens, and the user is told so rather than looking for it in vain.
    func report(_ clip: Clip, composeRunning: Bool) -> String {
        let destinations = inbox.destinations()
        let workspaceId = clip.workspaceId ?? destinations?.activeWorkspaceId
        let workspace = destinations?.workspaces.first { $0.id == workspaceId }?.name
        if composeRunning || clip.open {
            return "Added “\(clip.title)” to \(workspace ?? "Compose")."
        }
        let place = workspace.map { " in \($0)" } ?? ""
        return "Saved “\(clip.title)”. Compose files it\(place) when it next opens."
    }
}
