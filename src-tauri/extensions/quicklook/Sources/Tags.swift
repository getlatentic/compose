import Foundation

/// The block-kind → HTML-tag mapping, kept as a pair of lookups rather than
/// spread through the writer. Both take the enclosing components, because two
/// kinds are decided by their ancestors: a table cell is a `th` or a `td`
/// depending on its row, and a paragraph inside a list item writes no tag at
/// all. Closing has to reach the same verdict as opening did.
enum Tags {
    static func open(_ kind: PresentationIntent.Kind, within ancestors: [PresentationIntent.IntentType])
        -> String
    {
        switch kind {
        case .paragraph:
            return isInsideListItem(ancestors) ? "" : "<p>"
        case .header(let level): return "<h\(clamp(level))>"
        case .orderedList: return "<ol>"
        case .unorderedList: return "<ul>"
        case .listItem: return "<li>"
        case .blockQuote: return "<blockquote>"
        case .codeBlock(let language):
            let hint = language.map { " class=\"language-\(HTMLRenderer.escape($0))\"" } ?? ""
            return "<pre><code\(hint)>"
        case .thematicBreak: return "<hr>"
        case .table: return "<table>"
        case .tableHeaderRow, .tableRow: return "<tr>"
        case .tableCell(let column):
            let tag = isHeaderCell(ancestors) ? "th" : "td"
            let style = alignment(ofColumn: column, within: ancestors)
                .map { " style=\"text-align:\($0)\"" } ?? ""
            return "<\(tag)\(style)>"
        @unknown default: return ""
        }
    }

    static func close(_ kind: PresentationIntent.Kind, within ancestors: [PresentationIntent.IntentType])
        -> String
    {
        switch kind {
        case .paragraph: return isInsideListItem(ancestors) ? "" : "</p>\n"
        case .header(let level): return "</h\(clamp(level))>\n"
        case .orderedList: return "</ol>\n"
        case .unorderedList: return "</ul>\n"
        case .listItem: return "</li>\n"
        case .blockQuote: return "</blockquote>\n"
        case .codeBlock: return "</code></pre>\n"
        case .thematicBreak: return "\n"
        case .table: return "</table>\n"
        case .tableHeaderRow, .tableRow: return "</tr>\n"
        case .tableCell: return isHeaderCell(ancestors) ? "</th>" : "</td>"
        @unknown default: return ""
        }
    }

    private static func clamp(_ level: Int) -> Int { min(max(level, 1), 6) }

    private static func isHeaderCell(_ ancestors: [PresentationIntent.IntentType]) -> Bool {
        ancestors.contains { if case .tableHeaderRow = $0.kind { true } else { false } }
    }

    private static func isInsideListItem(_ ancestors: [PresentationIntent.IntentType]) -> Bool {
        if case .listItem = ancestors.last?.kind { return true }
        return false
    }

    private static func alignment(
        ofColumn column: Int, within ancestors: [PresentationIntent.IntentType]
    ) -> String? {
        for component in ancestors {
            guard case .table(let columns) = component.kind, column < columns.count else { continue }
            switch columns[column].alignment {
            case .center: return "center"
            case .right: return "right"
            default: return nil
            }
        }
        return nil
    }
}
