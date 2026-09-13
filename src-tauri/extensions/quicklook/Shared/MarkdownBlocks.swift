import Foundation

/// One block of a note — a paragraph, a heading, a table row, a line of code.
struct MarkdownBlock {
    /// What a list item is written with: a bullet, its number, a ballot box.
    /// Carried separately because it is not part of the block's own text.
    let marker: String?
    let text: String
    let kind: PresentationIntent.Kind?
}

/// The document flattened to blocks, which is all a thumbnail needs: what each
/// block says and how prominent it is. (The preview needs the nesting too, and
/// walks the runs itself.)
enum MarkdownBlocks {
    static func parse(_ markdown: String, limit: Int) -> [MarkdownBlock] {
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
            return lines(of: markdown, limit: limit).map {
                MarkdownBlock(marker: nil, text: $0, kind: nil)
            }
        }

        var blocks: [MarkdownBlock] = []
        var openIdentity: Int?
        var innermostIdentity: Int?
        for run in parsed.runs {
            guard let component = grouping(run.presentationIntent) else { continue }
            let innermost = run.presentationIntent?.components.first?.identity
            let text = String(parsed[run.range].characters)
            if component.identity == openIdentity, let last = blocks.popLast() {
                // Runs of one paragraph join seamlessly — they are its words —
                // but a row's cells are separate values and need a gap.
                let joiner = innermost == innermostIdentity ? "" : " "
                innermostIdentity = innermost
                blocks.append(
                    MarkdownBlock(
                        marker: last.marker, text: last.text + joiner + text, kind: last.kind))
            } else {
                innermostIdentity = innermost
                if blocks.count >= limit { break }
                openIdentity = component.identity
                var text = text
                blocks.append(
                    MarkdownBlock(
                        marker: marker(of: run.presentationIntent, text: &text),
                        text: text, kind: component.kind))
            }
        }
        return blocks.flatMap(split).prefix(limit).map { $0 }
    }

    /// What the item is written with in the source. A task's `[ ]` is consumed
    /// from the text, because it is a marker rather than words.
    private static func marker(of intent: PresentationIntent?, text: inout String) -> String? {
        guard let components = intent?.components,
            let item = components.firstIndex(where: { if case .listItem = $0.kind { true } else { false } })
        else { return nil }
        if let task = TaskMarker.take(from: &text) {
            return task == .done ? "\u{2611}" : "\u{2610}"
        }
        guard case .listItem(let ordinal) = components[item].kind else { return nil }
        if case .orderedList = components[(item + 1)...].first?.kind { return "\(ordinal)." }
        return "\u{2022}"
    }

    /// The innermost component that is not a cell, so a table's row reads as one
    /// line rather than one line per column.
    private static func grouping(_ intent: PresentationIntent?) -> PresentationIntent.IntentType? {
        intent?.components.first { component in
            if case .tableCell = component.kind { return false }
            return true
        }
    }

    /// A fenced block arrives as a single run holding every line.
    private static func split(_ block: MarkdownBlock) -> [MarkdownBlock] {
        lines(of: block.text, limit: .max).enumerated().map {
            MarkdownBlock(marker: $0.offset == 0 ? block.marker : nil, text: $0.element, kind: block.kind)
        }
    }

    private static func lines(of text: String, limit: Int) -> [String] {
        text.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .prefix(limit)
            .map { $0 }
    }
}
