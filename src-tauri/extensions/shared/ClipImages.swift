import AppKit
import UniformTypeIdentifiers

/// Images as a clip carries them: files beside `clip.json`, named so two cannot
/// collide.
enum ClipImages {
    /// An image file, read as it is; `nil` for a file that is not an image.
    static func file(at url: URL, index: Int) -> ClipImage? {
        guard UTType(filenameExtension: url.pathExtension)?.conforms(to: .image) == true,
            let data = try? Data(contentsOf: url)
        else { return nil }
        let stem = url.deletingPathExtension().lastPathComponent
        let name = ImageNaming.name(index: index, suggested: stem, ext: url.pathExtension)
        return ClipImage(fileName: name, data: data)
    }

    static func png(_ image: NSImage) -> Data? {
        image.tiffRepresentation.flatMap(png(fromTIFF:))
    }

    static func png(fromTIFF tiff: Data) -> Data? {
        NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:])
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
