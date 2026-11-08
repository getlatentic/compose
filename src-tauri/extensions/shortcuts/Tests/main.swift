import Foundation

var failures = 0

func check(_ name: String, _ condition: Bool, _ detail: @autoclosure () -> String = "") {
    if condition { return }
    failures += 1
    print("FAIL \(name) \(detail())")
}

let notes = QuickNoteShortcut(view: "notes", keyCode: 45, modifiers: 6144)
let clipboard = QuickNoteShortcut(view: "clipboard", keyCode: 9, modifiers: 6144)

/// A holder over fakes: what it registers, and what it asks Compose for.
final class Rig {
    var running = false
    var published = [notes, clipboard]
    var registered: [QuickNoteShortcut] = []
    var started: [String] = []
    lazy var holder = ShortcutHolder(
        keys: .init(register: { self.registered = $0 }, unregisterAll: { self.registered = [] }),
        composeRunning: { self.running },
        published: { self.published },
        startCompose: { self.started.append($0) })
}

do {
    let rig = Rig()
    rig.holder.composeChanged()
    check("with Compose not running, its shortcuts are held", rig.registered == [notes, clipboard])

    rig.holder.pressed(1)
    check("a press starts Compose on that shortcut's view", rig.started == ["clipboard"])

    rig.running = true
    rig.holder.composeChanged()
    check("once Compose runs, the shortcuts are let go for it to hold", rig.registered.isEmpty)
    rig.holder.pressed(0)
    check("and a press is Compose's to answer", rig.started == ["clipboard"])
}

do {
    let rig = Rig()
    rig.holder.composeChanged()
    rig.running = true
    rig.holder.pressed(0)
    check("a press while Compose is starting does not start a second", rig.started.isEmpty)
}

do {
    let rig = Rig()
    rig.holder.composeChanged()
    rig.published = [notes]
    rig.running = true
    rig.holder.composeChanged()
    rig.running = false
    rig.holder.composeChanged()
    check("Compose quitting hands over the shortcuts it last published", rig.registered == [notes])
    rig.holder.pressed(5)
    check("a press that matches nothing held does nothing", rig.started.isEmpty)
}

do {
    let rig = Rig()
    rig.published = []
    rig.holder.composeChanged()
    check("with every shortcut turned off, nothing is held", rig.registered.isEmpty && rig.holder.holding.isEmpty)
}

if let fixtures = ProcessInfo.processInfo.environment["CONTRACT_FIXTURES"] {
    let file = URL(fileURLWithPath: fixtures).appendingPathComponent("shortcuts.json")
    let decoded = (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode(QuickNoteShortcuts.self, from: $0) }
    check("reads the shortcuts the app writes", decoded?.shortcuts == [notes, clipboard], "\(String(describing: decoded))")
} else {
    check("CONTRACT_FIXTURES names the fixture folder (extensions/test.sh sets it)", false)
}

if failures > 0 {
    print("\(failures) shortcuts helper check(s) failed")
    exit(1)
}
print("shortcuts helper: all checks passed")
