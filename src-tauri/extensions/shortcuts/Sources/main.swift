import AppKit

// The shortcuts helper: a login item with no window and no Dock icon, inside
// Compose.app/Contents/Library/LoginItems — so Compose is four folders up.
let application = NSApplication.shared
application.setActivationPolicy(.prohibited)
// Windowless and idle almost always, which is when macOS would otherwise quit
// it — and the shortcuts would stop with it.
ProcessInfo.processInfo.disableAutomaticTermination("Holds the quick-note shortcuts while Compose is not running.")

let composeURL = Bundle.main.bundleURL
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
guard let composeID = Bundle(url: composeURL)?.bundleIdentifier else {
    FileHandle.standardError.write(Data("compose shortcuts: not inside Compose (\(composeURL.path))\n".utf8))
    exit(1)
}

func composeRunning() -> Bool {
    NSRunningApplication.runningApplications(withBundleIdentifier: composeID).contains { !$0.isTerminated }
}

/// Compose on the quick note alone, staying behind the app the user is in.
func startCompose(on view: String) {
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.arguments = ["--quick-note", view]
    configuration.activates = false
    NSWorkspace.shared.openApplication(at: composeURL, configuration: configuration) { _, error in
        if let error {
            FileHandle.standardError.write(Data("compose shortcuts: Compose did not start (\(error.localizedDescription))\n".utf8))
        }
    }
}

let inbox = ShareInbox.located()
let hotKeys = CarbonHotKeys()
let holder = ShortcutHolder(
    keys: .init(register: hotKeys.register, unregisterAll: hotKeys.unregisterAll),
    composeRunning: composeRunning,
    published: { inbox?.shortcuts()?.shortcuts ?? [] },
    startCompose: startCompose)
hotKeys.onPress = holder.pressed

let workspace = NSWorkspace.shared.notificationCenter
for name in [NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification] {
    workspace.addObserver(forName: name, object: nil, queue: .main) { notification in
        let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
        if app?.bundleIdentifier == composeID { holder.composeChanged() }
    }
}
holder.composeChanged()
application.run()
