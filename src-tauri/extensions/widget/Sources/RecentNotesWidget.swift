import AppIntents
import SwiftUI
import WidgetKit

/// The notes changed last, a click from opening. Set up for one workspace, or
/// every workspace when none is chosen.
struct RecentNotesWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: "RecentNotes", intent: RecentNotesConfiguration.self, provider: RecentNotesProvider()
        ) { entry in
            RecentNotesView(entry: entry)
                .containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("Recent Notes")
        .description("The notes you changed last, a click away.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct RecentNotesConfiguration: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Recent Notes"
    static let description = IntentDescription("Shows the notes you changed last.")

    @Parameter(title: "Workspace", description: "Every workspace when left empty.")
    var workspace: WorkspaceEntity?
}

struct RecentNotesEntry: TimelineEntry {
    let date: Date
    let recent: RecentNotes
}

struct RecentNotesProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> RecentNotesEntry {
        RecentNotesEntry(date: Date(), recent: .sample)
    }

    func snapshot(for configuration: RecentNotesConfiguration, in context: Context) async -> RecentNotesEntry {
        let recent = read(configuration)
        // The gallery shows what the widget looks like, which a sample shows
        // better than an empty widget.
        return RecentNotesEntry(date: Date(), recent: context.isPreview && recent.absence != nil ? .sample : recent)
    }

    func timeline(for configuration: RecentNotesConfiguration, in context: Context) async -> Timeline<RecentNotesEntry> {
        let recent = read(configuration)
        let entries = RecentNotesClock.redraws(from: Date()).map { RecentNotesEntry(date: $0, recent: recent) }
        return Timeline(entries: entries, policy: .atEnd)
    }

    private func read(_ configuration: RecentNotesConfiguration) -> RecentNotes {
        let inbox = ShareInbox.located()
        return RecentNotes.make(
            notes: inbox?.notes(), destinations: inbox?.destinations(), workspaceId: configuration.workspace?.id)
    }
}
