import Foundation

/// Holds the quick-note shortcuts while Compose is not running. Compose holds
/// its own while it runs — answering at once, over full-screen apps — so the
/// two never hold the same keys together: this takes them when Compose quits
/// and lets them go when it starts. A press starts Compose on the quick note.
final class ShortcutHolder {
    struct Keys {
        var register: ([QuickNoteShortcut]) -> Void
        var unregisterAll: () -> Void
    }

    private let keys: Keys
    private let composeRunning: () -> Bool
    private let published: () -> [QuickNoteShortcut]
    private let startCompose: (_ view: String) -> Void
    private(set) var holding: [QuickNoteShortcut] = []

    init(
        keys: Keys,
        composeRunning: @escaping () -> Bool,
        published: @escaping () -> [QuickNoteShortcut],
        startCompose: @escaping (_ view: String) -> Void
    ) {
        self.keys = keys
        self.composeRunning = composeRunning
        self.published = published
        self.startCompose = startCompose
    }

    /// Compose started or quit, or this helper did: take the shortcuts Compose
    /// last published when it is not running, and let them go when it is.
    func composeChanged() {
        keys.unregisterAll()
        holding = composeRunning() ? [] : published()
        if !holding.isEmpty { keys.register(holding) }
    }

    /// The shortcut held at `index` was pressed. Compose may have started in the
    /// meantime, and then answers the keys itself.
    func pressed(_ index: Int) {
        guard holding.indices.contains(index), !composeRunning() else { return }
        startCompose(holding[index].view)
    }
}
