import Foundation

/// What the widget shows: the notes changed last, in one workspace or in all.
struct RecentNotes: Equatable {
    /// Why there is nothing to show, when there is nothing.
    enum Absence: Equatable {
        /// Compose has not published its notes: it has not run since installed.
        case unpublished
        case noNotes
    }

    static let everyWorkspace = "Recent Notes"

    let heading: String
    /// The one workspace shown, so that rows need not name it.
    let workspace: String?
    let notes: [PublishedNotes.Note]
    let absence: Absence?

    /// A workspace removed since the widget was set up shows every workspace.
    static func make(notes published: PublishedNotes?, destinations: Destinations?, workspaceId: String?)
        -> RecentNotes
    {
        guard let published else {
            return RecentNotes(heading: everyWorkspace, workspace: nil, notes: [], absence: .unpublished)
        }
        let workspace = workspaceId.flatMap { id in destinations?.workspaces.first { $0.id == id } }
        let notes = published.notes.filter { note in workspace.map { note.workspaceId == $0.id } ?? true }
        return RecentNotes(
            heading: workspace?.name ?? everyWorkspace,
            workspace: workspace?.name,
            notes: notes,
            absence: notes.isEmpty ? .noNotes : nil)
    }

    /// What the widget gallery shows before Compose has published anything.
    static let sample = RecentNotes(
        heading: everyWorkspace,
        workspace: nil,
        notes: [
            ("Launch plan", 20), ("Reading list", 3_600), ("Weekly review", 86_400),
            ("Interview notes", 172_800), ("Ideas", 259_200), ("Travel", 345_600),
            ("Recipes", 432_000), ("Books", 518_400),
        ].map { title, age in
            PublishedNotes.Note(
                path: "/\(title).md", title: title, workspaceId: "sample", workspaceName: "Notes",
                modifiedAt: Int64((Date().timeIntervalSince1970 - TimeInterval(age)) * 1000))
        },
        absence: nil)
}

extension PublishedNotes.Note {
    var modified: Date { Date(timeIntervalSince1970: TimeInterval(modifiedAt) / 1000) }
}

enum RecentNotesClock {
    /// When "5 min ago" has to be redrawn: often while times are short, then
    /// less. The notes themselves change when Compose reloads the widget.
    static func redraws(from start: Date) -> [Date] {
        [0, 60, 300, 900, 1_800, 3_600, 7_200, 14_400, 28_800, 57_600, 86_400]
            .map { start.addingTimeInterval(TimeInterval($0)) }
    }

    static func ago(_ date: Date, at now: Date) -> String {
        if now.timeIntervalSince(date) < 60 { return "Just now" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        formatter.dateTimeStyle = .named
        return formatter.localizedString(for: date, relativeTo: now)
    }
}
