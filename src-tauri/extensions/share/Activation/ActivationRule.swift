import Foundation
import UniformTypeIdentifiers

/// When macOS offers Compose in a Share menu: for a link, a web page, text,
/// images, and the files Compose opens — with every attachment one of those, so
/// a selection holding anything else does not offer it.
///
/// Generated at build time from the file types Compose declares, which is what
/// lets macOS hand those files to it at all.
enum ActivationRule {
    /// The sheet reads every image it is given into memory.
    static let maxAttachments = 10

    static func predicate(documentExtensions extensions: [String]) -> String {
        let documentTypes = Set(extensions.flatMap(typeIdentifiers(forExtension:))).sorted()
        let supported =
            [conforms("public.image")]
            + documentTypes.map { #"ANY $attachment.registeredTypeIdentifiers UTI-EQUALS "\#($0)""# }
            // A page Safari shares arrives as the property list ComposePage.js
            // returns; a property-list *file* is not a page.
            + ["((\(conforms("public.url")) OR \(conforms("public.text")) OR \(conforms("com.apple.property-list"))) AND NOT \(conforms("public.file-url")))"]
        return """
            extensionItems.@count >= 1 AND SUBQUERY(extensionItems, $item, \
            $item.attachments.@count >= 1 AND $item.attachments.@count <= \(maxAttachments) AND \
            SUBQUERY($item.attachments, $attachment, \(supported.joined(separator: " OR "))).@count \
            == $item.attachments.@count).@count == extensionItems.@count
            """
    }

    /// A file's type as this Mac declares it, and as a Mac that declares
    /// nothing for its extension derives it — `.mdown` and `.mkd` everywhere,
    /// and `.md` on systems older than the one that declares Markdown.
    static func typeIdentifiers(forExtension ext: String) -> [String] {
        let derived = derivedIdentifiers(forExtension: ext)
        guard let declared = UTType(filenameExtension: ext)?.identifier, !derived.contains(declared) else {
            return derived
        }
        return [declared] + derived
    }

    /// The two identifiers macOS derives for an extension no type declares: as
    /// data (`?0=6:1=md`, what `UTType(filenameExtension:)` returns) and bare
    /// (`1=md`, what an item provider built from the file registers).
    static func derivedIdentifiers(forExtension ext: String) -> [String] {
        [derivedIdentifier(encoding: "?0=6:1=\(ext)"), derivedIdentifier(encoding: "1=\(ext)")]
    }

    /// `specification`, packed five bits at a time into macOS's own alphabet.
    private static func derivedIdentifier(encoding specification: String) -> String {
        let alphabet = Array("abcdefghkmnpqrstuvwxyz0123456789")
        var identifier = "dyn.a"
        var buffer = 0
        var bits = 0
        for byte in specification.utf8 {
            buffer = (buffer << 8) | Int(byte)
            bits += 8
            while bits >= 5 {
                bits -= 5
                identifier.append(alphabet[(buffer >> bits) & 0x1F])
            }
            buffer &= (1 << bits) - 1
        }
        if bits > 0 {
            identifier.append(alphabet[(buffer << (5 - bits)) & 0x1F])
        }
        return identifier
    }

    private static func conforms(_ type: String) -> String {
        #"ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "\#(type)""#
    }
}
