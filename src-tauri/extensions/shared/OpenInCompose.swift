import AppKit

/// The Compose this extension ships inside: brought forward, or handed files and
/// notes to open through the paths Compose already has for them.
///
/// macOS lets a sandboxed extension open files this way only for types that app
/// declares, and only once it has been launched.
enum OpenInCompose {
    /// `…/Compose.app/Contents/PlugIns/ComposeShare.appex` → `…/Compose.app`, and
    /// the same from `Contents/Extensions`.
    static var app: URL {
        Bundle.main.bundleURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    /// Whether Compose is running, and so files a clip the moment it lands.
    static var isRunning: Bool {
        guard let identifier = Bundle(url: app)?.bundleIdentifier else { return false }
        return !NSRunningApplication.runningApplications(withBundleIdentifier: identifier).isEmpty
    }

    /// Opens files where they are, as the Finder's Open With does.
    static func open(_ files: [URL]) async throws {
        _ = try await NSWorkspace.shared.open(files, withApplicationAt: app, configuration: forward())
    }

    /// Brings Compose forward, launching it when it is not running.
    static func activate() async throws {
        _ = try await NSWorkspace.shared.openApplication(at: app, configuration: forward())
    }

    /// Opens the note at `path`. Compose opens a `compose://open` link only for a
    /// note inside one of its workspaces.
    static func note(at path: String) async throws {
        _ = try await NSWorkspace.shared.open([link(toNoteAt: path)], withApplicationAt: app, configuration: forward())
    }

    /// Everything but unreserved ASCII and `/` is escaped: the app reads the query
    /// as a form, where `&`, `=` and `+` would end or change the path.
    static func link(toNoteAt path: String) -> URL {
        let plain = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~/")
        let escaped = path.addingPercentEncoding(withAllowedCharacters: plain) ?? ""
        return URL(string: "compose://open?path=\(escaped)")!
    }

    private static func forward() -> NSWorkspace.OpenConfiguration {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        return configuration
    }
}
