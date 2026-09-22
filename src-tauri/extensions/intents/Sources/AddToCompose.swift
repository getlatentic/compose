import AppIntents
import Foundation

/// Saves text as a new note: typed, dictated to Siri, or handed on by the action
/// before it — Get Clipboard, a web page's address, a transcription.
struct AddToComposeIntent: AppIntent {
    static let title: LocalizedStringResource = "Add to Compose"
    static let description = IntentDescription(
        "Saves text as a new note in Compose. A web address on its own becomes a note about that page.",
        categoryName: "Notes")

    @Parameter(
        title: "Text",
        inputOptions: String.IntentInputOptions(multiline: true),
        requestValueDialog: "What should Compose add?",
        inputConnectionBehavior: .connectToPreviousIntentResult)
    var text: String

    @Parameter(title: "Title", description: "The note's name. Its first line when left empty.")
    var noteTitle: String?

    @Parameter(title: "Workspace", description: "Where the note goes. The workspace open in Compose when left empty.")
    var workspace: WorkspaceEntity?

    @Parameter(title: "Open in Compose", default: false)
    var openNote: Bool

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$text) to Compose") {
            \.$noteTitle
            \.$workspace
            \.$openNote
        }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let filing = try Filing.located()
        let clip = try filing.file(try Self.draft(text: text, title: noteTitle), workspaceId: workspace?.id, open: openNote)
        if openNote { try await OpenInCompose.activate() }
        return .result(dialog: "\(filing.report(clip, composeRunning: OpenInCompose.isRunning))")
    }

    static func draft(text: String, title: String?) throws -> ClipDraft {
        guard let text = text.trimmedToContent else { throw IntentFailure.nothingToAdd }
        var draft = ClipDraft()
        if let link = WebLink.only(in: text) {
            draft.url = link
        } else {
            draft.text = text
        }
        draft.title = title?.trimmedToContent
            ?? ClipDraft.suggestedTitle(itemTitle: nil, text: draft.text, url: draft.url)
        return draft
    }
}
