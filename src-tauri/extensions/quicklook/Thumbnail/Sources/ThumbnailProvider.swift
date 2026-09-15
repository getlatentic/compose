import AppKit
import QuickLookThumbnailing

/// The Finder's icon for a `.md` file.
///
/// Named in `Info.plist` as the extension's principal class, so the `@objc`
/// name is part of the bundle's contract.
@objc(ComposeThumbnailProvider)
final class ComposeThumbnailProvider: QLThumbnailProvider {
    override func provideThumbnail(
        for request: QLFileThumbnailRequest,
        _ handler: @escaping (QLThumbnailReply?, Error?) -> Void
    ) {
        let page: ThumbnailPage
        do {
            let source = try String(decoding: Data(contentsOf: request.fileURL), as: UTF8.self)
            page = ThumbnailPage(document: MarkdownDocument(source: source))
        } catch {
            handler(nil, error)
            return
        }

        let size = PageGeometry.size(fitting: request.maximumSize)
        let reply = QLThumbnailReply(contextSize: size) {
            PageGeometry.draw(page, in: CGRect(origin: .zero, size: size))
            return true
        }
        reply.extensionBadge = "md"
        handler(reply, nil)
    }
}
