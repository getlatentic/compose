import Foundation

/// What a thumbnail shows: the note as a short stack of lines, each with the
/// prominence its block earns. At icon sizes nobody reads the body — the shape
/// of the document and its title are what tell one note from another.
struct ThumbnailPage {
    enum Weight {
        case title, heading, body, code
    }

    struct Line {
        let marker: String?
        let text: String
        let weight: Weight
    }

    /// Enough to fill a large thumbnail; past that nothing is legible anyway.
    static let lineLimit = 26

    let lines: [Line]

    init(document: MarkdownDocument) {
        var lines = MarkdownBlocks.parse(document.body, limit: Self.lineLimit)
            .map { Line(marker: $0.marker, text: $0.text, weight: Weight($0.kind)) }
        // A note titled only in its frontmatter would otherwise open on its
        // first paragraph, and every such note would look alike.
        if let title = document.title, lines.first?.weight != .title,
            lines.first?.text != title
        {
            lines.insert(Line(marker: nil, text: title, weight: .title), at: 0)
            lines = Array(lines.prefix(Self.lineLimit))
        }
        self.lines = lines
    }
}

extension ThumbnailPage.Weight {
    init(_ kind: PresentationIntent.Kind?) {
        switch kind {
        case .header(let level): self = level <= 1 ? .title : .heading
        case .codeBlock: self = .code
        default: self = .body
        }
    }
}
