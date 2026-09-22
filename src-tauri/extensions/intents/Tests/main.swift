import AppKit
import Foundation

var failures = 0

func check(_ name: String, _ condition: Bool, _ detail: @autoclosure () -> String = "") {
    if condition { return }
    failures += 1
    print("FAIL \(name) \(detail())")
}

func failure<T>(_ attempt: () throws -> T) -> IntentFailure? {
    do {
        _ = try attempt()
        return nil
    } catch {
        return error as? IntentFailure
    }
}

// --- Add to Compose: the note some text makes ------------------------------------

do {
    let draft = try AddToComposeIntent.draft(text: "  Buy milk\nand eggs \n", title: nil)
    check("the first line names the note", draft.title == "Buy milk", draft.title)
    check("the text is kept, trimmed", draft.text == "Buy milk\nand eggs")
    check("a title given is used", try AddToComposeIntent.draft(text: "body", title: " Groceries ").title == "Groceries")
    check("a blank title is no title", try AddToComposeIntent.draft(text: "body", title: "  ").title == "body")
    let link = try AddToComposeIntent.draft(text: " https://example.com/a?b=1 ", title: nil)
    check("a web address alone is a note about that page",
          link.url?.absoluteString == "https://example.com/a?b=1" && link.text == nil && link.title == "example.com")
    check("an address among words stays text",
          try AddToComposeIntent.draft(text: "see https://example.com", title: nil).url == nil)
} catch {
    check("drafting from text", false, "\(error)")
}
check("nothing to add is refused", failure { try AddToComposeIntent.draft(text: " \n ", title: nil) } == .nothingToAdd)

// --- New Note from Clipboard, on a private pasteboard: the user's is never touched ---

let board = NSPasteboard.withUniqueName()

func onClipboard(_ fill: (NSPasteboard) -> Void) throws -> ClipDraft {
    board.clearContents()
    fill(board)
    return try ClipboardDraft.read(board)
}

func onePixelPNG() -> Data {
    let image = NSImage(size: NSSize(width: 1, height: 1))
    image.lockFocus()
    NSColor.red.setFill()
    NSRect(x: 0, y: 0, width: 1, height: 1).fill()
    image.unlockFocus()
    return ClipImages.png(image)!
}

let png = onePixelPNG()
let isPNG = { (data: Data) in data.starts(with: [0x89, 0x50, 0x4E, 0x47]) }

do {
    let rich = try onClipboard {
        $0.setString("Weekly plan\nMonday: write", forType: .string)
        $0.setString("<p><b>Weekly plan</b></p><p>Monday: write</p>", forType: .html)
    }
    check("copied text keeps its formatting for the app to convert",
          rich.text == "Weekly plan\nMonday: write" && rich.html?.contains("<b>Weekly plan</b>") == true)
    check("and is named by its first line", rich.title == "Weekly plan")

    let rtf = try onClipboard {
        let bold = NSAttributedString(string: "Bold words", attributes: [.font: NSFont.boldSystemFont(ofSize: 12)])
        $0.setString("Bold words", forType: .string)
        $0.setData(try! bold.data(from: NSRange(location: 0, length: bold.length),
                                  documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]), forType: .rtf)
    }
    check("rich text without HTML is turned into HTML", rtf.html?.contains("Bold words") == true, rtf.html ?? "nil")

    let link = try onClipboard { $0.setString("https://www.latentic.ai/blog", forType: .string) }
    check("a copied web address is a note about that page",
          link.url?.absoluteString == "https://www.latentic.ai/blog" && link.text == nil && link.title == "www.latentic.ai")

    let image = try onClipboard { $0.setData(png, forType: .png) }
    check("a copied image is kept as PNG",
          image.images.map(\.fileName) == ["1-clipboard.png"] && image.images.first?.data == png && image.title == "Clipping")

    let tiff = try onClipboard { $0.setData(NSImage(data: png)!.tiffRepresentation!, forType: .tiff) }
    check("a TIFF image becomes PNG", tiff.images.first.map { isPNG($0.data) } == true)

    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("intents-tests-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let photo = folder.appendingPathComponent("Holiday photo.png")
    let report = folder.appendingPathComponent("report.pdf")
    try png.write(to: photo)
    try Data("%PDF".utf8).write(to: report)
    let files = try onClipboard {
        $0.writeObjects([report as NSURL, photo as NSURL])
        // As Finder does: the icon comes along as an image.
        $0.addTypes([.tiff], owner: nil)
        $0.setData(NSImage(named: NSImage.folderName)!.tiffRepresentation!, forType: .tiff)
    }
    check("copied files bring their images, not their names as text",
          files.images.map(\.fileName) == ["2-Holiday-photo.png"] && files.text == nil, "\(files.images.map(\.fileName)) \(files.text ?? "nil")")
    check("files with no image leave nothing for a note",
          failure { try onClipboard { $0.writeObjects([report as NSURL]) } } == .emptyClipboard)
    try? FileManager.default.removeItem(at: folder)
} catch {
    check("reading the clipboard", false, "\(error)")
}

check("a copied password is refused", failure {
    try onClipboard {
        $0.setString("hunter2", forType: .string)
        $0.setString("", forType: NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType"))
    }
} == .privateClipboard)
check("an empty clipboard is refused", failure { try onClipboard { _ in } } == .emptyClipboard)
board.releaseGlobally()

// --- filing, and what the user is told --------------------------------------------

let fixtures = ProcessInfo.processInfo.environment["CONTRACT_FIXTURES"].map { URL(fileURLWithPath: $0, isDirectory: true) }
check("CONTRACT_FIXTURES names the fixture folder (extensions/test.sh sets it)", fixtures != nil)

if let fixtures {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("intents-inbox-\(UUID().uuidString)")
    do {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try FileManager.default.copyItem(
            at: fixtures.appendingPathComponent("destinations.json"), to: root.appendingPathComponent("destinations.json"))
        let filing = Filing(inbox: ShareInbox(root: root))
        var draft = ClipDraft(title: "Buy milk", text: "Buy milk")
        draft.images = [ClipImage(fileName: "1-clipboard.png", data: png)]
        let clip = try filing.file(draft, workspaceId: nil, open: true)
        let placed = filing.inbox.inboxURL.appendingPathComponent(clip.id, isDirectory: true)
        let landed = try JSONDecoder().decode(Clip.self, from: Data(contentsOf: placed.appendingPathComponent("clip.json")))
        check("the clip lands for the app, asking to be opened", landed == clip && landed.open && landed.workspaceId == nil)
        check("its images land beside it",
              FileManager.default.fileExists(atPath: placed.appendingPathComponent("1-clipboard.png").path))
        check("the workspace open in Compose is named when none was chosen",
              filing.report(clip, composeRunning: true) == "Added “Buy milk” to My Notes.")
        let waiting = try filing.file(ClipDraft(title: "Later", text: "x"), workspaceId: "0a9e8d7c-6b5a-4f3e-2d1c-0b9a8f7e6d5c", open: false)
        check("a Compose that is not running files it when it next opens",
              filing.report(waiting, composeRunning: false) == "Saved “Later”. Compose files it in Thesis when it next opens.")
        let nowhere = Filing(inbox: ShareInbox(root: root.appendingPathComponent("unpublished")))
        check("with nothing published, the note still goes to Compose",
              nowhere.report(clip, composeRunning: true) == "Added “Buy milk” to Compose.")
    } catch {
        check("filing", false, "\(error)")
    }
    try? FileManager.default.removeItem(at: root)

    // --- the entities, from what the app publishes ---------------------------------

    do {
        let destinations = try JSONDecoder().decode(
            Destinations.self, from: Data(contentsOf: fixtures.appendingPathComponent("destinations.json")))
        check("every published workspace is offered", WorkspaceEntity.all(in: destinations).map(\.name) == ["My Notes", "Thesis"])
        check("nothing published offers nothing", WorkspaceEntity.all(in: nil).isEmpty)

        let notes = try JSONDecoder().decode(
            PublishedNotes.self, from: Data(contentsOf: fixtures.appendingPathComponent("notes.json")))
        let fixture = NoteSearch(notes).notes(matching: "launch")
        check("the notes the app writes decode and are found",
              fixture.map(\.id) == ["/Users/me/My Notes/Ideas/Launch plan.md"]
                  && fixture.first?.workspace == "My Notes"
                  && fixture.first?.modified == Date(timeIntervalSince1970: 1_789_500_000))
    } catch {
        check("published entities", false, "\(error)")
    }
}

func published(_ titles: [String]) -> PublishedNotes {
    PublishedNotes(version: 1, notes: titles.enumerated().map { index, title in
        .init(path: "/n/\(index).md", title: title, workspaceId: "w", workspaceName: "W", modifiedAt: Int64(100 - index))
    })
}

let search = NoteSearch(published(["Plans for launch", "Launch checklist", "Café notes", "launch", "Groceries"]))
check("the title itself, then titles starting with it, then the rest",
      search.notes(matching: "Launch").map(\.title) == ["launch", "Launch checklist", "Plans for launch"])
check("accents do not matter", search.notes(matching: "cafe").map(\.title) == ["Café notes"])
check("an empty search suggests the newest", search.notes(matching: " ").map(\.title).first == "Plans for launch")
check("notes are found again by path, in the order asked",
      search.notes(at: ["/n/4.md", "/n/0.md", "/missing.md"]).map(\.title) == ["Groceries", "Plans for launch"])
check("suggestions stop at a screenful",
      NoteSearch(published((0..<100).map { "Note \($0)" })).recent().count == NoteSearch.mostSuggested)

// --- the link that opens a note ------------------------------------------------------

check("a note's name survives the link, whatever it holds",
      OpenInCompose.link(toNoteAt: "/Users/me/My Notes/A&B+C=é.md").absoluteString
          == "compose://open?path=/Users/me/My%20Notes/A%26B%2BC%3D%C3%A9.md")

if failures == 0 {
    print("all intents extension tests passed")
} else {
    print("\n\(failures) failing")
    exit(1)
}
