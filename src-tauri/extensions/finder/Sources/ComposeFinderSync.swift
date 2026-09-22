import AppKit
import FinderSync

/// Compose in the Finder: in the workspaces' folders, open notes in Compose and
/// start new ones from the context menu or the toolbar item, and see the
/// workspaces' own folders badged.
@objc(ComposeFinderSync)
final class ComposeFinderSync: FIFinderSync {
    private static let workspaceBadge = "workspace"

    private let inbox = ShareInbox.located()
    private var folders = WorkspaceFolders(nil)
    private var published: DispatchSourceFileSystemObject?
    private var offered: [FinderAction] = []

    override init() {
        super.init()
        FIFinderSyncController.default().setBadgeImage(
            Self.composeIcon(size: 64), label: "Compose workspace", forBadgeIdentifier: Self.workspaceBadge)
        refresh()
        watchPublished()
    }

    override func requestBadgeIdentifier(for url: URL) {
        if folders.isRoot(url) {
            FIFinderSyncController.default().setBadgeIdentifier(Self.workspaceBadge, for: url)
        }
    }

    override var toolbarItemName: String { "Compose" }
    override var toolbarItemToolTip: String { "Open notes in Compose, or start a new one here" }
    override var toolbarItemImage: NSImage {
        NSImage(systemSymbolName: "square.and.pencil", accessibilityDescription: "Compose") ?? Self.composeIcon(size: 16)
    }

    override func menu(for menuKind: FIMenuKind) -> NSMenu {
        let controller = FIFinderSyncController.default()
        offered = FinderMenu.actions(
            at: place(menuKind), selected: controller.selectedItemURLs() ?? [], targeted: controller.targetedURL(),
            folders: folders, documents: .declared, isFolder: Self.isFolder)
        let menu = NSMenu(title: "")
        for (index, action) in offered.enumerated() {
            let item = NSMenuItem(title: action.title, action: #selector(choose(_:)), keyEquivalent: "")
            item.tag = index
            item.target = self
            item.image = Self.composeIcon(size: 16)
            menu.addItem(item)
        }
        return menu
    }

    @objc private func choose(_ item: NSMenuItem) {
        guard offered.indices.contains(item.tag) else { return }
        switch offered[item.tag] {
        case .open(let notes):
            Task { try? await OpenInCompose.notes(at: notes.map(\.path)) }
        case .newNote(let folder):
            newNote(in: folder)
        }
    }

    /// Compose writes the note, as the extension may not: it is asked through
    /// the inbox, and brought forward to open what it filed.
    private func newNote(in folder: URL) {
        guard let inbox else { return }
        var draft = ClipDraft()
        draft.title = "Untitled"
        let clip = draft.clip(id: UUID().uuidString, workspaceId: nil, createdAt: Date(), open: true, folder: folder.path)
        do {
            try inbox.write(clip, images: [])
            Task { try? await OpenInCompose.activate() }
        } catch {
            NSLog("Compose could not be asked for a new note: \(error)")
        }
    }

    /// The folders to watch are the workspaces', which Compose republishes as
    /// they change.
    private func refresh() {
        folders = WorkspaceFolders(inbox?.destinations())
        FIFinderSyncController.default().directoryURLs = Set(folders.roots)
    }

    private func watchPublished() {
        guard let root = inbox?.root else { return }
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let descriptor = open(root.path, O_EVTONLY)
        guard descriptor >= 0 else { return }
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: descriptor, eventMask: [.write, .rename, .delete], queue: .main)
        source.setEventHandler { [weak self] in self?.refresh() }
        source.setCancelHandler { close(descriptor) }
        source.resume()
        published = source
    }

    private func place(_ kind: FIMenuKind) -> FinderMenu.Place {
        switch kind {
        case .contextualMenuForContainer: .background
        case .contextualMenuForSidebar: .sidebar
        case .toolbarItemMenu: .toolbar
        default: .items
        }
    }

    private static func isFolder(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
    }

    private static func composeIcon(size: CGFloat) -> NSImage {
        let icon = NSWorkspace.shared.icon(forFile: OpenInCompose.app.path)
        icon.size = NSSize(width: size, height: size)
        return icon
    }
}
