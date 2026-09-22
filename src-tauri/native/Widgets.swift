import WidgetKit

/// The app has published notes its widgets show: WidgetKit redraws them now
/// rather than on its own schedule. Only the app and its extensions can ask.
@_cdecl("compose_reload_widgets")
public func composeReloadWidgets() {
    if #available(macOS 11.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
    }
}
