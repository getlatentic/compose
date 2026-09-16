import AppKit

/// Reads shared items the way the sheet does, from a synchronous test. The run
/// loop keeps turning while it waits — an item provider calls back on it.
final class Box: @unchecked Sendable { var content: SharedContent? }

func sharedContent(
    from items: [NSExtensionItem], documents: DocumentFiles = DocumentFiles(extensions: [])
) -> SharedContent {
    let box = Box()
    Task { box.content = await SharedItems.content(from: items, documents: documents) }
    let deadline = Date().addingTimeInterval(10)
    while box.content == nil, Date() < deadline {
        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
    }
    return box.content ?? SharedContent()
}

func item(_ provider: NSItemProvider, title: String? = nil) -> NSExtensionItem {
    items([provider], title: title)
}

func items(_ providers: [NSItemProvider], title: String? = nil) -> NSExtensionItem {
    let item = NSExtensionItem()
    item.attachments = providers
    if let title { item.attributedTitle = NSAttributedString(string: title) }
    return item
}

/// A real file in a fresh folder, so providers are built by the system from it.
func temporaryFile(_ name: String, _ contents: Data = Data("text".utf8)) -> URL {
    let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("share-tests-\(UUID().uuidString)", isDirectory: true)
    try! FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let file = folder.appendingPathComponent(name)
    try! contents.write(to: file)
    return file
}

/// The extensions Compose declares in tauri.conf.json — the list build.sh
/// generates the rule and the document list from.
func declaredDocumentExtensions() -> [String] {
    guard let path = ProcessInfo.processInfo.environment["COMPOSE_CONFIG"],
        let data = FileManager.default.contents(atPath: path),
        let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let bundle = config["bundle"] as? [String: Any],
        let associations = bundle["fileAssociations"] as? [[String: Any]]
    else {
        check("COMPOSE_CONFIG names tauri.conf.json (extensions/test.sh sets it)", false)
        return []
    }
    return associations.flatMap { $0["ext"] as? [String] ?? [] }
}
