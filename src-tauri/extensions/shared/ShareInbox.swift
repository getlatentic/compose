import Foundation
import Security

/// Where the extensions and the app meet: a folder in their shared app-group
/// container. An extension is sandboxed and cannot write into a workspace, so a
/// clip is dropped here and the app — which can — turns it into a note. The app
/// publishes here what the extensions show: its workspaces and recent notes.
struct ShareInbox {
    let root: URL

    var destinationsURL: URL { root.appendingPathComponent("destinations.json") }
    var notesURL: URL { root.appendingPathComponent("notes.json") }
    var inboxURL: URL { root.appendingPathComponent("Inbox", isDirectory: true) }

    /// The container of the app group this process was signed into. Read from
    /// the signature rather than written into the source, so it cannot disagree
    /// with the entitlement that grants access to it.
    static func located() -> ShareInbox? {
        guard let task = SecTaskCreateFromSelf(nil),
            let groups = SecTaskCopyValueForEntitlement(
                task, "com.apple.security.application-groups" as CFString, nil) as? [String],
            let group = groups.first,
            let container = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: group)
        else { return nil }
        return ShareInbox(root: container.appendingPathComponent("Share", isDirectory: true))
    }

    func destinations() -> Destinations? {
        guard let data = try? Data(contentsOf: destinationsURL) else { return nil }
        return try? JSONDecoder().decode(Destinations.self, from: data)
    }

    func notes() -> PublishedNotes? {
        guard let data = try? Data(contentsOf: notesURL) else { return nil }
        return try? JSONDecoder().decode(PublishedNotes.self, from: data)
    }

    /// Writes under a dot-named staging folder and renames it into place, so the
    /// app never picks up a clip whose images are still being written.
    func write(_ clip: Clip, images: [ClipImage]) throws {
        let files = FileManager.default
        try files.createDirectory(at: inboxURL, withIntermediateDirectories: true)
        let staging = inboxURL.appendingPathComponent(".incoming-\(clip.id)", isDirectory: true)
        try? files.removeItem(at: staging)
        try files.createDirectory(at: staging, withIntermediateDirectories: false)
        for image in images {
            try image.data.write(to: staging.appendingPathComponent(image.fileName))
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(clip).write(to: staging.appendingPathComponent("clip.json"))
        try files.moveItem(at: staging, to: inboxURL.appendingPathComponent(clip.id, isDirectory: true))
    }
}
