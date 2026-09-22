import Foundation

var failures = 0

func check(_ name: String, _ condition: Bool, _ detail: @autoclosure () -> String = "") {
    if condition { return }
    failures += 1
    print("FAIL \(name) \(detail())")
}

let destinations = Destinations(
    version: 1, activeWorkspaceId: "w1", workspaces: [.init(id: "w1", name: "My Notes"), .init(id: "w2", name: "Thesis")])

func note(_ title: String, in workspace: String, _ name: String) -> PublishedNotes.Note {
    PublishedNotes.Note(path: "/\(workspace)/\(title).md", title: title, workspaceId: workspace, workspaceName: name, modifiedAt: 0)
}

let published = PublishedNotes(version: 1, notes: [
    note("Chapter two", in: "w2", "Thesis"), note("Groceries", in: "w1", "My Notes"), note("Chapter one", in: "w2", "Thesis"),
])

// --- what the widget shows ------------------------------------------------------

let all = RecentNotes.make(notes: published, destinations: destinations, workspaceId: nil)
check("every workspace, newest first, when none is chosen",
      all.notes.map(\.title) == ["Chapter two", "Groceries", "Chapter one"] && all.heading == "Recent Notes" && all.workspace == nil)

let thesis = RecentNotes.make(notes: published, destinations: destinations, workspaceId: "w2")
check("one workspace, headed with its name",
      thesis.notes.map(\.title) == ["Chapter two", "Chapter one"] && thesis.heading == "Thesis" && thesis.workspace == "Thesis")

let removed = RecentNotes.make(notes: published, destinations: destinations, workspaceId: "gone")
check("a workspace removed since set up shows every workspace", removed.notes.count == 3 && removed.workspace == nil)

check("before Compose has published, the widget says to open it",
      RecentNotes.make(notes: nil, destinations: nil, workspaceId: nil).absence == .unpublished)
check("a workspace with no notes says so",
      RecentNotes.make(notes: PublishedNotes(version: 1, notes: []), destinations: destinations, workspaceId: "w1").absence == .noNotes)
check("the gallery's sample fills the largest widget", RecentNotes.sample.notes.count >= 8 && RecentNotes.sample.absence == nil)

// --- when it was changed -----------------------------------------------------------

let now = Date(timeIntervalSince1970: 1_789_500_000)
check("a moment ago is just now", RecentNotesClock.ago(now.addingTimeInterval(-20), at: now) == "Just now")
check("minutes read as minutes", RecentNotesClock.ago(now.addingTimeInterval(-300), at: now).contains("5"),
      RecentNotesClock.ago(now.addingTimeInterval(-300), at: now))
let redraws = RecentNotesClock.redraws(from: now)
check("times are redrawn from now, ever less often",
      redraws.first == now && zip(redraws, redraws.dropFirst()).allSatisfy { $0 < $1 })

// --- the links -----------------------------------------------------------------------

check("New note opens the quick-note window", OpenInCompose.newNoteLink.absoluteString == "compose://capture")
check("a row opens its note", OpenInCompose.link(toNoteAt: "/w2/Chapter two.md").absoluteString == "compose://open?path=/w2/Chapter%20two.md")

if failures == 0 {
    print("all widget extension tests passed")
} else {
    print("\n\(failures) failing")
    exit(1)
}
