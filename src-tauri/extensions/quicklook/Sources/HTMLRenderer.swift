import Foundation

/// Markdown rendered to HTML for a Quick Look preview.
///
/// The parse comes from `AttributedString`, which hands back a flat run list
/// where each run carries the stack of blocks containing it, innermost first.
/// Turning that back into nested HTML is a matter of diffing each run's stack
/// against the one still open — components carry an identity, so two adjacent
/// list items in the same list are distinguishable from two adjacent lists.
enum HTMLRenderer {
    static func render(_ markdown: String) -> String {
        guard
            let parsed = try? AttributedString(
                markdown: markdown,
                options: .init(
                    allowsExtendedAttributes: true,
                    interpretedSyntax: .full,
                    failurePolicy: .returnPartiallyParsedIfPossible
                )
            )
        else {
            return "<pre>\(escape(markdown))</pre>"
        }
        var writer = Writer()
        for run in parsed.runs {
            writer.emit(run: run, text: String(parsed[run.range].characters))
        }
        writer.closeAll()
        return writer.html
    }

    static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}

private struct Writer {
    private(set) var html = ""

    /// Outermost-first, mirroring the nesting of the tags written so far.
    private var open: [PresentationIntent.IntentType] = []
    /// A list item's marker (`[ ]`, `[x]`) is not parsed by `AttributedString`,
    /// so it survives into the item's first run and is recognised there.
    private var atItemStart = false

    mutating func emit(run: AttributedString.Runs.Run, text: String) {
        let wanted = Array((run.presentationIntent?.components ?? []).reversed())
        reconcile(with: wanted)
        guard let innermost = open.last?.kind else {
            html += Inline.render(run: run, text: text)
            return
        }
        switch innermost {
        case .thematicBreak:
            break  // the tag is the whole content
        case .codeBlock:
            html += HTMLRenderer.escape(text)
        default:
            html += body(run: run, text: text)
        }
    }

    mutating func closeAll() {
        reconcile(with: [])
    }

    private mutating func body(run: AttributedString.Runs.Run, text: String) -> String {
        var text = text
        var prefix = ""
        if atItemStart, let box = Checkbox(consuming: &text) {
            prefix = box.html
        }
        atItemStart = false
        return prefix + Inline.render(run: run, text: text)
    }

    private mutating func reconcile(with wanted: [PresentationIntent.IntentType]) {
        let shared = zip(open, wanted).prefix { $0.identity == $1.identity }.count
        for index in stride(from: open.count - 1, through: shared, by: -1) {
            html += Tags.close(open[index].kind, within: Array(open[..<index]))
        }
        open.removeSubrange(shared...)
        for component in wanted[shared...] {
            html += Tags.open(component.kind, within: open)
            open.append(component)
            if case .listItem = component.kind { atItemStart = true }
        }
    }
}

private struct Checkbox {
    let html: String

    /// Strips a task marker off the front of an item's text, if it has one.
    init?(consuming text: inout String) {
        let checked = ["[x] ", "[X] "]
        let unchecked = ["[ ] "]
        guard let marker = (checked + unchecked).first(where: text.hasPrefix) else { return nil }
        text.removeFirst(marker.count)
        let isChecked = checked.contains(marker)
        html = "<input type=\"checkbox\" disabled\(isChecked ? " checked" : "")> "
    }
}
