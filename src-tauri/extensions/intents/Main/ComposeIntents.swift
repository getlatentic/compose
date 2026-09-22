import AppIntents
import ExtensionFoundation

/// Compose's actions for Shortcuts, Spotlight and Siri. They run here, sandboxed,
/// and reach the app through the folder it shares with its extensions.
@main
struct ComposeIntentsExtension: AppIntentsExtension {}

/// The actions offered without building a shortcut, and what to say to Siri.
struct ComposeShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddToComposeIntent(),
            phrases: ["Add to \(.applicationName)", "Add a note to \(.applicationName)"],
            shortTitle: "Add to Compose",
            systemImageName: "square.and.pencil")
        AppShortcut(
            intent: NewNoteFromClipboardIntent(),
            phrases: [
                "New \(.applicationName) note from the clipboard",
                "Save the clipboard to \(.applicationName)",
            ],
            shortTitle: "Note from Clipboard",
            systemImageName: "doc.on.clipboard")
        AppShortcut(
            intent: OpenNoteIntent(),
            phrases: ["Open a note in \(.applicationName)"],
            shortTitle: "Open Note",
            systemImageName: "doc.text")
    }
}
