import Foundation

/// The workspaces' folders, as Compose last published them: where the Finder
/// extension offers anything at all.
struct WorkspaceFolders: Equatable {
    let roots: [URL]

    init(_ destinations: Destinations?) {
        roots = (destinations?.workspaces ?? []).compactMap { workspace in
            workspace.path.map { URL(fileURLWithPath: $0, isDirectory: true).resolvingSymlinksInPath() }
        }
    }

    func contains(_ url: URL) -> Bool {
        let path = url.resolvingSymlinksInPath().path
        return roots.contains { path == $0.path || path.hasPrefix($0.path + "/") }
    }

    func isRoot(_ url: URL) -> Bool {
        let path = url.resolvingSymlinksInPath().path
        return roots.contains { $0.path == path }
    }
}

/// What a Finder menu offers for what was clicked.
enum FinderAction: Equatable {
    case open([URL])
    case newNote(in: URL)

    var title: String {
        switch self {
        case .open(let notes): notes.count == 1 ? "Open in Compose" : "Open \(notes.count) Notes in Compose"
        case .newNote: "New Compose Note"
        }
    }
}

enum FinderMenu {
    /// Where the menu was opened, in the Finder's terms.
    enum Place {
        case items, background, sidebar, toolbar
    }

    /// Notes in a workspace can be opened; a workspace folder can get a new note.
    /// Anything outside the workspaces gets nothing.
    static func actions(
        at place: Place, selected: [URL], targeted: URL?, folders: WorkspaceFolders, documents: DocumentFiles,
        isFolder: (URL) -> Bool
    ) -> [FinderAction] {
        let notes = selected.filter { documents.contains($0) && folders.contains($0) }
        let open: [FinderAction] = notes.isEmpty ? [] : [.open(notes)]
        let folder: URL? =
            switch place {
            case .items, .sidebar: selected.count == 1 && isFolder(selected[0]) ? selected[0] : nil
            case .background, .toolbar: targeted
            }
        var newNote: [FinderAction] = []
        if let folder, folders.contains(folder) {
            newNote = [.newNote(in: folder)]
        }
        return place == .background || place == .sidebar ? newNote : open + newNote
    }
}
