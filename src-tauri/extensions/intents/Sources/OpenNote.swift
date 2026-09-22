import AppIntents

struct OpenNoteIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Note"
    static let description = IntentDescription("Opens a note in Compose.", categoryName: "Notes")

    @Parameter(title: "Note", requestValueDialog: "Which note?")
    var note: NoteEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$note)")
    }

    func perform() async throws -> some IntentResult {
        try await OpenInCompose.notes(at: [note.id])
        return .result()
    }
}
