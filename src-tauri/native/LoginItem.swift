import AppKit
import Foundation
import ServiceManagement

/// The login item `which` names: 0 Compose itself, 1 the helper that holds the
/// quick-note shortcuts while Compose is not running, `<app id>.shortcuts`.
@available(macOS 13.0, *)
private func loginItem(_ which: Int32) -> SMAppService? {
    switch which {
    case 0: return .mainApp
    case 1: return Bundle.main.bundleIdentifier.map { SMAppService.loginItem(identifier: "\($0).shortcuts") }
    default: return nil
    }
}

/// Whether login item `which` runs at login: -1 when it cannot — before macOS 13,
/// or a build without the helper; 0 off; 1 on; 2 registered but switched off
/// under Login Items.
@_cdecl("compose_login_item_status")
public func composeLoginItemStatus(_ which: Int32) -> Int32 {
    guard #available(macOS 13.0, *), let service = loginItem(which) else { return -1 }
    switch service.status {
    case .enabled: return 1
    case .requiresApproval: return 2
    case .notFound where which == 1: return -1
    default: return 0
    }
}

/// Run login item `which` at login, or stop. `nil` when done, else why not,
/// which the caller frees.
@_cdecl("compose_login_item_set")
public func composeLoginItemSet(_ which: Int32, _ enabled: Bool) -> UnsafeMutablePointer<CChar>? {
    guard #available(macOS 13.0, *) else { return strdup("This needs macOS 13 or later.") }
    guard let service = loginItem(which) else { return strdup("There is no such login item.") }
    do {
        if enabled {
            try service.register()
        } else if service.status != .notRegistered {
            try service.unregister()
        }
        return nil
    } catch {
        return strdup(error.localizedDescription)
    }
}

/// System Settings → General → Login Items, where the user allows it again.
@_cdecl("compose_login_item_settings")
public func composeLoginItemSettings() {
    if #available(macOS 13.0, *) {
        SMAppService.openSystemSettingsLoginItems()
    }
}

/// macOS opened Compose as a login item: the launch event says so. Read while
/// the app finishes launching, when that event is still the current one.
@_cdecl("compose_launched_at_login")
public func composeLaunchedAtLogin() -> Bool {
    guard let event = NSAppleEventManager.shared().currentAppleEvent else { return false }
    return event.eventID == AEEventID(kAEOpenApplication)
        && event.paramDescriptor(forKeyword: AEKeyword(keyAEPropData))?.enumCodeValue == OSType(keyAELaunchedAsLogInItem)
}
