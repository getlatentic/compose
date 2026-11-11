import Carbon.HIToolbox

/// System-wide keys through `RegisterEventHotKey`, the call Compose's own
/// shortcuts go through, reporting each press by the key's place in the list
/// last registered.
final class CarbonHotKeys {
    var onPress: (Int) -> Void = { _ in }
    private var registered: [EventHotKeyRef] = []
    private var handler: EventHandlerRef?

    /// Kept for the life of the process: the helper does nothing else.
    init() {
        var pressed = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(
            GetApplicationEventTarget(),
            { _, event, context in
                guard let event, let context else { return OSStatus(eventNotHandledErr) }
                var key = EventHotKeyID()
                let found = GetEventParameter(
                    event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                    nil, MemoryLayout<EventHotKeyID>.size, nil, &key)
                guard found == noErr else { return found }
                Unmanaged<CarbonHotKeys>.fromOpaque(context).takeUnretainedValue().onPress(Int(key.id))
                return noErr
            },
            1, &pressed, Unmanaged.passUnretained(self).toOpaque(), &handler)
    }

    func register(_ shortcuts: [QuickNoteShortcut]) {
        for (index, shortcut) in shortcuts.enumerated() {
            var key: EventHotKeyRef?
            let id = EventHotKeyID(signature: CarbonHotKeys.signature, id: UInt32(index))
            let status = RegisterEventHotKey(shortcut.keyCode, shortcut.modifiers, id, GetApplicationEventTarget(), 0, &key)
            if status == noErr, let key {
                registered.append(key)
            } else {
                FileHandle.standardError.write(Data("compose shortcuts: \(shortcut.view) not registered (\(status))\n".utf8))
            }
        }
    }

    func unregisterAll() {
        registered.forEach { UnregisterEventHotKey($0) }
        registered = []
    }

    /// `CMPS`, which tells these keys' events apart from any other.
    private static let signature = OSType(0x434D_5053)
}
