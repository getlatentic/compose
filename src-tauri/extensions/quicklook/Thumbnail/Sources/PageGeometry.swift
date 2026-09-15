import AppKit

/// Draws a note as a sheet of paper.
///
/// Always light, whatever the system appearance: a thumbnail is cached and
/// shown in both, and a document icon that reads as paper is what every other
/// document in the Finder looks like.
enum PageGeometry {
    private static let aspect: CGFloat = 8.5 / 11
    private static let margin: CGFloat = 0.085
    /// Chosen so a full page of body text fills the sheet.
    private static let bodyLines: CGFloat = 30

    static func size(fitting maximum: CGSize) -> CGSize {
        let height = max(maximum.height, 1)
        let width = height * aspect
        guard width > maximum.width else { return CGSize(width: width, height: height) }
        return CGSize(width: maximum.width, height: maximum.width / aspect)
    }

    static func draw(_ page: ThumbnailPage, in rect: CGRect) {
        NSColor.white.setFill()
        rect.fill()
        NSColor(white: 0.82, alpha: 1).setStroke()
        let border = NSBezierPath(rect: rect.insetBy(dx: 0.5, dy: 0.5))
        border.lineWidth = 1
        border.stroke()

        let inset = rect.width * margin
        var cursor = rect.maxY - inset
        let unit = rect.height / bodyLines
        let column = rect.insetBy(dx: inset, dy: 0)

        for line in page.lines {
            let style = Style(line.weight, unit: unit)
            cursor -= style.leading
            guard cursor >= rect.minY + inset - style.leading else { break }
            let content = line.marker.map { "\($0) \(line.text)" } ?? line.text
            content.draw(
                with: CGRect(x: column.minX, y: cursor, width: column.width, height: style.leading),
                options: [.truncatesLastVisibleLine, .usesLineFragmentOrigin],
                attributes: style.attributes
            )
        }
    }
}

/// How one line is set. Sizes are multiples of the page's line unit so a
/// thumbnail looks the same at every size the Finder asks for.
private struct Style {
    let attributes: [NSAttributedString.Key: Any]
    let leading: CGFloat

    init(_ weight: ThumbnailPage.Weight, unit: CGFloat) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail

        switch weight {
        case .title:
            leading = unit * 2.1
            attributes = Style.of(NSFont.boldSystemFont(ofSize: unit * 1.5), 0.1, paragraph)
        case .heading:
            leading = unit * 1.5
            attributes = Style.of(NSFont.boldSystemFont(ofSize: unit * 1.05), 0.2, paragraph)
        case .code:
            leading = unit
            attributes = Style.of(
                NSFont.monospacedSystemFont(ofSize: unit * 0.72, weight: .regular), 0.45, paragraph)
        case .body:
            leading = unit * 1.1
            attributes = Style.of(NSFont.systemFont(ofSize: unit * 0.8), 0.32, paragraph)
        }
    }

    private static func of(_ font: NSFont, _ grey: CGFloat, _ paragraph: NSParagraphStyle)
        -> [NSAttributedString.Key: Any]
    {
        [
            .font: font,
            .foregroundColor: NSColor(white: grey, alpha: 1),
            .paragraphStyle: paragraph,
        ]
    }
}
