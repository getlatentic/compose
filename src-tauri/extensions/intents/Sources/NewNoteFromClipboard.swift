import AppIntents
import AppKit

/// Saves what is on the clipboard as a new note, from Shortcuts, Spotlight or
/// Siri, without switching to Compose first.
struct NewNoteFromClipboardIntent: AppIntent {
    static let title: LocalizedStringResource = "New Note from Clipboard"
    static let description = IntentDescription(
        "Saves what is on the clipboard — text with its formatting, a web address, or images — as a new note in Compose.",
        categoryName: "Notes")

    @Parameter(title: "Workspace", description: "Where the note goes. The workspace open in Compose when left empty.")
    var workspace: WorkspaceEntity?

    @Parameter(title: "Open in Compose", default: true)
    var openNote: Bool

    static var parameterSummary: some ParameterSummary {
        Summary("New note from the clipboard") {
            \.$workspace
            \.$openNote
        }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let filing = try Filing.located()
        let draft = try await MainActor.run { try ClipboardDraft.read(NSPasteboard.general) }
        let clip = try filing.file(draft, workspaceId: workspace?.id, open: openNote)
        if openNote { try await OpenInCompose.activate() }
        return .result(dialog: "\(filing.report(clip, composeRunning: OpenInCompose.isRunning))")
    }
}

/// What the clipboard holds, as a note.
enum ClipboardDraft {
    static let mostImages = 10
    /// What password managers mark a copied password with (nspasteboard.org).
    private static let concealed = NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")

    static func read(_ board: NSPasteboard) throws -> ClipDraft {
        let types = board.types ?? []
        if types.contains(concealed) { throw IntentFailure.privateClipboard }
        var draft = ClipDraft()
        draft.images = images(board)
        // Copied files bring their names along as text: the files are what was copied.
        if !types.contains(.fileURL), let text = board.string(forType: .string)?.trimmedToContent {
            if let link = WebLink.only(in: text) {
                draft.url = link
            } else {
                draft.text = text
                draft.html = board.string(forType: .html) ?? board.data(forType: .rtf).flatMap { RichText.html(from: $0 as NSData) }
            }
        }
        guard !draft.isEmpty else { throw IntentFailure.emptyClipboard }
        draft.title = ClipDraft.suggestedTitle(itemTitle: nil, text: draft.text, url: draft.url)
        return draft
    }

    /// The images among copied files, else a copied image. Finder puts a copied
    /// file's icon beside it, which is not what was copied.
    private static func images(_ board: NSPasteboard) -> [ClipImage] {
        if board.types?.contains(.fileURL) == true {
            let files = board.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
            return Array(
                files.lazy.enumerated()
                    .compactMap { index, file in ClipImages.file(at: file, index: index) }
                    .prefix(mostImages))
        }
        guard let png = board.data(forType: .png) ?? board.data(forType: .tiff).flatMap(ClipImages.png(fromTIFF:)) else {
            return []
        }
        return [ClipImage(fileName: ImageNaming.name(index: 0, suggested: "clipboard", ext: "png"), data: png)]
    }
}
