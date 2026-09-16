import AppKit
import UniformTypeIdentifiers

/// Reads what the sharing app handed over into a draft.
///
/// Apps share through the same few Cocoa objects — a URL, a string, rich text,
/// an image — so this is driven by the types each item provider offers, never by
/// which app is sharing. Each provider is read once, in its richest form.
enum SharedItems {
    static func draft(from items: [NSExtensionItem]) async -> ClipDraft {
        var draft = ClipDraft()
        var itemTitle: String?
        for item in items {
            itemTitle = itemTitle ?? nonEmpty(item.attributedTitle?.string)
            for provider in item.attachments ?? [] {
                await read(provider, into: &draft)
            }
        }
        draft.title = ClipDraft.suggestedTitle(itemTitle: itemTitle, text: draft.text, url: draft.url)
        return draft
    }

    private static func read(_ provider: NSItemProvider, into draft: inout ClipDraft) async {
        if let type = offered(provider, [.image]) {
            if let image = await image(from: provider, type: type, index: draft.images.count) {
                draft.images.append(image)
            }
        } else if offered(provider, [.fileURL]) != nil {
            if let file = await url(from: provider),
                let image = imageFile(at: file, index: draft.images.count)
            {
                draft.images.append(image)
            }
        } else if offered(provider, [.url]) != nil {
            if draft.url == nil {
                draft.url = await url(from: provider)
            }
        } else if let type = offered(provider, [.html, .rtf, .rtfd, .plainText]) {
            await readText(provider, type: type, into: &draft)
        }
    }

    private static func readText(
        _ provider: NSItemProvider, type: UTType, into draft: inout ClipDraft
    ) async {
        let value = await load(provider, type)
        if type.conforms(to: .html), let html = string(value) {
            draft.html = joined(draft.html, html)
        } else if type.conforms(to: .rtf) || type.conforms(to: .rtfd),
            let html = RichText.html(from: value)
        {
            draft.html = joined(draft.html, html)
        } else if let text = string(value) {
            draft.text = joined(draft.text, text)
        }
    }

    private static func image(from provider: NSItemProvider, type: UTType, index: Int) async
        -> ClipImage?
    {
        let value = await load(provider, type)
        if let url = value as? URL { return imageFile(at: url, index: index) }
        let stem = provider.suggestedName.map { ($0 as NSString).deletingPathExtension }
        if let data = value as? Data {
            let name = ImageNaming.name(
                index: index, suggested: stem,
                ext: type.preferredFilenameExtension ?? "png")
            return ClipImage(fileName: name, data: data)
        }
        guard let png = (value as? NSImage).flatMap(pngData) else { return nil }
        return ClipImage(
            fileName: ImageNaming.name(index: index, suggested: stem, ext: "png"), data: png)
    }

    private static func imageFile(at url: URL, index: Int) -> ClipImage? {
        guard UTType(filenameExtension: url.pathExtension)?.conforms(to: .image) == true,
            let data = try? Data(contentsOf: url)
        else { return nil }
        let stem = url.deletingPathExtension().lastPathComponent
        let name = ImageNaming.name(index: index, suggested: stem, ext: url.pathExtension)
        return ClipImage(fileName: name, data: data)
    }

    /// The first of `types` the provider can supply, as the concrete type it
    /// registered — `public.heic`, not the abstract `public.image` — so a clip's
    /// file is loaded and named as what it actually is.
    private static func offered(_ provider: NSItemProvider, _ types: [UTType]) -> UTType? {
        let registered = provider.registeredTypeIdentifiers.compactMap(UTType.init)
        for wanted in types {
            if let concrete = registered.first(where: { $0.conforms(to: wanted) }) {
                return concrete
            }
            if provider.hasItemConformingToTypeIdentifier(wanted.identifier) { return wanted }
        }
        return nil
    }

    /// A shared link. `loadItem` answers a URL request with the raw bytes of the
    /// address, so the URL has to be asked for as an object.
    private static func url(from provider: NSItemProvider) async -> URL? {
        guard provider.canLoadObject(ofClass: URL.self) else { return nil }
        return await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: URL.self) { value, _ in
                continuation.resume(returning: value)
            }
        }
    }

    private static func load(_ provider: NSItemProvider, _ type: UTType) async -> NSSecureCoding? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: type.identifier, options: nil) { value, _ in
                continuation.resume(returning: value)
            }
        }
    }

    private static func string(_ value: NSSecureCoding?) -> String? {
        switch value {
        case let text as String: return text
        case let data as Data: return String(data: data, encoding: .utf8)
        case let rich as NSAttributedString: return rich.string
        default: return nil
        }
    }

    private static func pngData(_ image: NSImage) -> Data? {
        image.tiffRepresentation
            .flatMap { NSBitmapImageRep(data: $0) }?
            .representation(using: .png, properties: [:])
    }

    private static func nonEmpty(_ text: String?) -> String? {
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return text
    }

    private static func joined(_ existing: String?, _ addition: String) -> String {
        guard let existing, !existing.isEmpty else { return addition }
        return existing + "\n\n" + addition
    }
}

/// A shared image's name in the clip folder: its own name where the sharing app
/// gave one, prefixed with its position so two `image.png`s cannot collide.
enum ImageNaming {
    static func name(index: Int, suggested: String?, ext: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        let stem = (suggested ?? "")
            .unicodeScalars
            .map { allowed.contains($0) ? Character($0) : "-" }
            .reduce(into: "") { $0.append($1) }
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return "\(index + 1)-\(stem.isEmpty ? "image" : stem).\(ext.lowercased())"
    }
}
