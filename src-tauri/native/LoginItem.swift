import AppKit
import Foundation
import ServiceManagement

/// Whether macOS opens Compose at login: -1 before macOS 13, which cannot say;
/// 0 off; 1 on; 2 registered but switched off under Login Items.
@_cdecl("compose_login_item_status")
public func composeLoginItemStatus() -> Int32 {
    guard #available(macOS 13.0, *) else { return -1 }
    switch SMAppService.mainApp.status {
    case .enabled: return 1
    case .requiresApproval: return 2
    default: return 0
    }
}

/// Open Compose at login, or stop. `nil` when done, else why not, which the
/// caller frees.
@_cdecl("compose_login_item_set")
public func composeLoginItemSet(_ enabled: Bool) -> UnsafeMutablePointer<CChar>? {
    guard #available(macOS 13.0, *) else { return strdup("Opening at login needs macOS 13 or later.") }
    let service = SMAppService.mainApp
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
