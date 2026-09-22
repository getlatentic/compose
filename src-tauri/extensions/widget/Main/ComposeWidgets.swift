import SwiftUI
import WidgetKit

/// Compose's widgets. WidgetKit asks this extension to draw them; Compose tells
/// WidgetKit when the notes they show change.
@main
struct ComposeWidgets: WidgetBundle {
    var body: some Widget {
        RecentNotesWidget()
    }
}
