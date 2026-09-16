import AppKit

func testDocumentFiles() {
    let documents = DocumentFiles(extensions: ["md", "TXT"])
    check("a declared file is a document, whatever its case",
          documents.contains(URL(fileURLWithPath: "/notes/Plan.MD")))
    check("so is a text file", documents.contains(URL(fileURLWithPath: "/notes/todo.txt")))
    check("an image file is not", !documents.contains(URL(fileURLWithPath: "/notes/shot.png")))
    check("nor is a web page that happens to end in .md",
          !documents.contains(URL(string: "https://example.com/readme.md")!))

    let note = temporaryFile("plan.md")
    let alone = sharedContent(from: [item(NSItemProvider(contentsOf: note)!)], documents: documents)
    check("a shared note opens where it is", alone.documents.map(\.lastPathComponent) == ["plan.md"],
          "\(alone.documents)")
    check("and leaves nothing to clip", alone.draft.isEmpty)

    let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    let photo = temporaryFile("shot.png", png)
    let picture = sharedContent(from: [item(NSItemProvider(contentsOf: photo)!)], documents: documents)
    check("a shared image file is still clipped", picture.draft.images.count == 1 && picture.documents.isEmpty)

    let link = NSItemProvider(item: URL(string: "https://example.com")! as NSURL, typeIdentifier: "public.url")
    let mixed = sharedContent(
        from: [items([NSItemProvider(contentsOf: note)!, link])], documents: documents)
    check("a note shared with a link opens, and the link is clipped",
          mixed.documents.count == 1 && mixed.draft.url?.host == "example.com")

    let script = temporaryFile("tool.py")
    let code = sharedContent(from: [item(NSItemProvider(contentsOf: script)!)], documents: documents)
    check("a file Compose does not open is neither opened nor clipped, and is named",
          code.documents.isEmpty && code.draft.isEmpty
              && code.ignoredFiles.map(\.lastPathComponent) == ["tool.py"])
}
