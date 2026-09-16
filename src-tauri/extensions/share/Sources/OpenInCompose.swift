import AppKit

/// Hands files to the Compose this extension ships inside, as the Finder's Open
/// With does, so they open where they are through the path Compose already has
/// for files opened from outside it.
///
/// macOS lets a sandboxed extension do this only for types that app declares,
/// and only once it has been launched.
enum OpenInCompose {
    /// `…/Compose.app/Contents/PlugIns/ComposeShare.appex` → `…/Compose.app`.
    static var app: URL {
        Bundle.main.bundleURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    static func open(_ files: [URL]) async throws {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        _ = try await NSWorkspace.shared.open(files, withApplicationAt: app, configuration: configuration)
    }
}
