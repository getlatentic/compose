import Foundation
import QuickLookUI

/// Quick Look's entry point: Space on a `.md` in the Finder lands here.
///
/// Named in `Info.plist` as the extension's principal class, so the `@objc`
/// name is part of the bundle's contract and not free to change.
@objc(ComposePreviewProvider)
final class ComposePreviewProvider: QLPreviewProvider, QLPreviewingController {
    /// Wide enough for the 46em measure the stylesheet sets, so the first frame
    /// is not a reflow.
    private static let contentSize = CGSize(width: 820, height: 1000)

    func providePreview(for request: QLFilePreviewRequest) async throws -> QLPreviewReply {
        let source = try String(decoding: Data(contentsOf: request.fileURL), as: UTF8.self)
        let document = MarkdownDocument(source: source)
        let rendered = HTMLRenderer.render(document.body)
        let page = PreviewStyle.page(title: document.title, body: rendered)

        let reply = QLPreviewReply(
            dataOfContentType: .html,
            contentSize: Self.contentSize
        ) { _ in Data(page.utf8) }
        reply.stringEncoding = .utf8
        reply.title = document.title ?? request.fileURL.lastPathComponent
        return reply
    }
}

