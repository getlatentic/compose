import AppIntents
import Foundation

/// One of the notes Compose last published: those changed most recently.
struct NoteEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(
        name: "Note", numericFormat: "\(placeholder: .int) notes")
    static let defaultQuery = NoteQuery()

    /// The note's absolute path.
    let id: String
    @Property(title: "Title") var title: String
    @Property(title: "Workspace") var workspace: String
    @Property(title: "Path") var path: String
    @Property(title: "Modified") var modified: Date

    init(_ note: PublishedNotes.Note) {
        id = note.path
        title = note.title
        workspace = note.workspaceName
        path = note.path
        modified = Date(timeIntervalSince1970: TimeInterval(note.modifiedAt) / 1000)
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(workspace)")
    }
}

struct NoteQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [NoteEntity] {
        NoteSearch(ShareInbox.located()?.notes()).notes(at: identifiers)
    }

    func entities(matching text: String) async throws -> [NoteEntity] {
        NoteSearch(ShareInbox.located()?.notes()).notes(matching: text)
    }

    func suggestedEntities() async throws -> [NoteEntity] {
        NoteSearch(ShareInbox.located()?.notes()).recent()
    }
}

/// Finding notes among those Compose published, which come newest first.
struct NoteSearch {
    static let mostSuggested = 30
    static let mostMatches = 50

    let published: [PublishedNotes.Note]

    init(_ notes: PublishedNotes?) {
        published = notes?.notes ?? []
    }

    func notes(at paths: [String]) -> [NoteEntity] {
        paths.compactMap { path in published.first { $0.path == path } }.map(NoteEntity.init)
    }

    /// Titles holding `text`, ignoring case and accents: the title itself first,
    /// then titles that start with it, then the rest, each newest first.
    func notes(matching text: String) -> [NoteEntity] {
        guard let wanted = text.trimmedToContent else { return recent() }
        let options: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]
        func closeness(_ title: String) -> Int? {
            if title.compare(wanted, options: options) == .orderedSame { return 0 }
            if title.range(of: wanted, options: options.union(.anchored)) != nil { return 1 }
            if title.range(of: wanted, options: options) != nil { return 2 }
            return nil
        }
        return published.enumerated()
            .compactMap { age, note in closeness(note.title).map { (closeness: $0, age: age, note: note) } }
            .sorted { ($0.closeness, $0.age) < ($1.closeness, $1.age) }
            .prefix(Self.mostMatches)
            .map { NoteEntity($0.note) }
    }

    func recent() -> [NoteEntity] {
        published.prefix(Self.mostSuggested).map(NoteEntity.init)
    }
}
