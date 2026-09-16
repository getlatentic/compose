import Foundation

/// The files Compose opens where they are, rather than clipping them: the ones it
/// declares to macOS, which build.sh copies from tauri.conf.json into this
/// extension's Info.plist.
struct DocumentFiles {
    let extensions: Set<String>

    init<Extensions: Sequence>(extensions: Extensions) where Extensions.Element == String {
        self.extensions = Set(extensions.map { $0.lowercased() })
    }

    static let declared = DocumentFiles(
        extensions: Bundle.main.object(forInfoDictionaryKey: "ComposeDocumentExtensions") as? [String] ?? [])

    func contains(_ url: URL) -> Bool {
        url.isFileURL && extensions.contains(url.pathExtension.lowercased())
    }
}
