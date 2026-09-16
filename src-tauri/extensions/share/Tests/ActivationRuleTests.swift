import AppKit
import UniformTypeIdentifiers

func testActivationRule() {
    check("the identifiers for .mdown are the ones macOS derives",
          ActivationRule.derivedIdentifiers(forExtension: "mdown")
              == ["dyn.ah62d4rv4ge8043dts71a", "dyn.age8043dts71a"])
    let undeclared = "zq\(Int.random(in: 1000...9999))"
    let derived = ActivationRule.derivedIdentifiers(forExtension: undeclared)
    check("as a type, for any extension nothing declares",
          UTType(filenameExtension: undeclared)?.identifier == derived.first, "\(undeclared) \(derived)")
    check("and as an item provider built from such a file registers it",
          NSItemProvider(contentsOf: temporaryFile("file.\(undeclared)"))?.registeredTypeIdentifiers.first
              == derived.last, "\(undeclared) \(derived)")

    let extensions = declaredDocumentExtensions()
    check("tauri.conf.json declares Markdown", extensions.contains("md"), "\(extensions)")
    let rule = NSPredicate(format: ActivationRule.predicate(documentExtensions: extensions))
    func offered(_ providers: [NSItemProvider]) -> Bool {
        rule.evaluate(with: [
            "extensionItems": [["attachments": providers.map { ["registeredTypeIdentifiers": $0.registeredTypeIdentifiers] }]]
        ])
    }
    func file(_ name: String) -> NSItemProvider { NSItemProvider(contentsOf: temporaryFile(name))! }

    for ext in extensions {
        check("Compose is offered for a .\(ext) file", offered([file("note.\(ext)")]))
    }
    check("for an image file", offered([file("shot.png")]))
    check("for a link", offered([NSItemProvider(item: URL(string: "https://example.com")! as NSURL,
                                                typeIdentifier: "public.url")]))
    check("for selected text", offered([NSItemProvider(object: "some words" as NSString)]))
    check("for a note and a picture together", offered([file("a.md"), file("b.png")]))

    for name in ["tool.py", "data.json", "archive.zip", "paper.pdf", "letter.rtf", "page.html"] {
        check("but not for \(name)", !offered([file(name)]))
    }
    check("nor for a note shared with a file it does not open", !offered([file("a.md"), file("tool.py")]))
    check("nor for nothing", !offered([]))
    check("nor for more than the sheet reads",
          !offered((0...ActivationRule.maxAttachments).map { _ in file("shot.png") }))
}
