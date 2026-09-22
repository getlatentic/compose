//! Telling WidgetKit that the notes Compose's widgets show have changed.

#[cfg(compose_native)]
extern "C" {
    fn compose_reload_widgets();
}

pub(super) fn reload() {
    // SAFETY: a Swift function taking and returning nothing (`native/Widgets.swift`).
    #[cfg(compose_native)]
    unsafe {
        compose_reload_widgets()
    }
}
