import SwiftUI
import WidgetKit

struct RecentNotesView: View {
    let entry: RecentNotesEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let absence = entry.recent.absence {
            NoNotes(heading: entry.recent.heading, absence: absence, offersNewNote: family != .systemSmall)
        } else if family == .systemSmall, let note = entry.recent.notes.first {
            LatestNote(note: note, recent: entry.recent, now: entry.date)
                .widgetURL(OpenInCompose.link(toNoteAt: note.path))
        } else {
            NoteList(recent: entry.recent, rows: family == .systemLarge ? 8 : 3, now: entry.date)
        }
    }
}

/// The widget's title, and a way to start a note.
private struct Heading: View {
    let text: String
    let offersNewNote: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(text).font(.headline).lineLimit(1)
            Spacer(minLength: 8)
            if offersNewNote {
                Link(destination: OpenInCompose.newNoteLink) {
                    Image(systemName: "square.and.pencil")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel("New quick note")
            }
        }
    }
}

/// Small: the note changed last. The whole widget opens it.
private struct LatestNote: View {
    let note: PublishedNotes.Note
    let recent: RecentNotes
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(recent.heading).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 0)
            Text(note.title).font(.headline).lineLimit(3).privacySensitive()
            Text(detail(note, recent: recent, now: now)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

private struct NoteList: View {
    let recent: RecentNotes
    let rows: Int
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Heading(text: recent.heading, offersNewNote: true)
            ForEach(recent.notes.prefix(rows), id: \.path) { note in
                Link(destination: OpenInCompose.link(toNoteAt: note.path)) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(note.title).font(.subheadline.weight(.medium)).lineLimit(1).privacySensitive()
                        Text(detail(note, recent: recent, now: now)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

private struct NoNotes: View {
    let heading: String
    let absence: RecentNotes.Absence
    let offersNewNote: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Heading(text: heading, offersNewNote: offersNewNote)
            Spacer(minLength: 0)
            Text(absence == .unpublished ? "Open Compose to see your notes here." : "Notes you change in Compose appear here.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/// When the note changed, and where it is unless the widget shows one workspace.
private func detail(_ note: PublishedNotes.Note, recent: RecentNotes, now: Date) -> String {
    let ago = RecentNotesClock.ago(note.modified, at: now)
    return recent.workspace == nil ? "\(note.workspaceName) · \(ago)" : ago
}
