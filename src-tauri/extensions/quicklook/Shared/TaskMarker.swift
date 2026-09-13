import Foundation

/// The `[ ]` / `[x]` at the head of a task item.
///
/// `AttributedString` does not parse task lists, so the marker survives into
/// the item's first run and is recognised there — by the preview, which turns
/// it into a checkbox, and by the thumbnail, which turns it into a ballot box.
enum TaskMarker {
    case todo, done

    private static let markers: [(String, TaskMarker)] = [
        ("[ ] ", .todo), ("[x] ", .done), ("[X] ", .done),
    ]

    /// Strips the marker off the front of an item's text, if it has one.
    static func take(from text: inout String) -> TaskMarker? {
        guard let (marker, state) = markers.first(where: { text.hasPrefix($0.0) }) else {
            return nil
        }
        text.removeFirst(marker.count)
        return state
    }
}
