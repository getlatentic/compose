import Foundation

var failures = 0

func check(_ name: String, _ condition: Bool, _ detail: @autoclosure () -> String = "") {
    if condition { return }
    failures += 1
    print("FAIL \(name) \(detail())")
}

// --- the proposed title -------------------------------------------------------

check("the item's own title wins",
      ClipDraft.suggestedTitle(itemTitle: "Page Title", text: "body", url: URL(string: "https://x.dev")) == "Page Title")
check("else the first line that says something",
      ClipDraft.suggestedTitle(itemTitle: "  ", text: "\n\n  First line  \nsecond", url: nil) == "First line")
check("else where it came from",
      ClipDraft.suggestedTitle(itemTitle: nil, text: nil, url: URL(string: "https://www.latentic.ai/a")) == "www.latentic.ai")
check("never empty", ClipDraft.suggestedTitle(itemTitle: nil, text: nil, url: nil) == "Clipping")
check("a long first line is cut",
      ClipDraft.suggestedTitle(itemTitle: nil, text: String(repeating: "a", count: 500), url: nil).count == 120)

// --- where the sheet opens ------------------------------------------------------

let published = Destinations(
    version: 1, activeWorkspaceId: "b",
    workspaces: [.init(id: "a", name: "A"), .init(id: "b", name: "B")])
check("the workspace last saved to", ShareModel.defaultWorkspace(in: published, lastUsed: "a") == "a")
check("the open one once that workspace is gone",
      ShareModel.defaultWorkspace(in: published, lastUsed: "removed") == "b")
check("nothing when the app has published nothing",
      ShareModel.defaultWorkspace(in: nil, lastUsed: "a") == nil)

// --- clip.json: the Rust importer decodes exactly these keys -------------------

let draft = ClipDraft(
    title: "  A Title \n", url: URL(string: "https://x.dev/p"), text: "t", html: nil,
    images: [ClipImage(fileName: "1-photo.png", data: Data([1, 2, 3]))])
let clip = draft.clip(id: "abc", workspaceId: "w1", createdAt: Date(timeIntervalSince1970: 1.5))
let json = String(data: try! JSONEncoder().encode(clip), encoding: .utf8)!
for key in ["version", "id", "createdAt", "workspaceId", "title", "url", "text", "images"] {
    check("clip.json carries \(key)", json.contains("\"\(key)\""), json)
}
check("the title is trimmed", clip.title == "A Title")
check("createdAt is in milliseconds", clip.createdAt == 1500)
check("an empty draft cannot be saved", ClipDraft().isEmpty)

// --- image names ------------------------------------------------------------------

check("a shared name is kept, made safe", ImageNaming.name(index: 0, suggested: "IMG 12/34", ext: "HEIC") == "1-IMG-12-34.heic")
check("no name still gets one", ImageNaming.name(index: 2, suggested: nil, ext: "png") == "3-image.png")

// --- the inbox write --------------------------------------------------------------

let temp = FileManager.default.temporaryDirectory
    .appendingPathComponent("share-inbox-test-\(UUID().uuidString)", isDirectory: true)
let inbox = ShareInbox(root: temp)
do {
    try inbox.write(clip, images: draft.images)
    let placed = inbox.inboxURL.appendingPathComponent("abc", isDirectory: true)
    check("the clip lands under its id",
          FileManager.default.fileExists(atPath: placed.appendingPathComponent("clip.json").path))
    check("its images land beside it",
          FileManager.default.fileExists(atPath: placed.appendingPathComponent("1-photo.png").path))
    let staging = try FileManager.default.contentsOfDirectory(atPath: inbox.inboxURL.path)
        .filter { $0.hasPrefix(".") }
    check("no staging folder is left behind", staging.isEmpty, "\(staging)")
    let decoded = try JSONDecoder().decode(
        Clip.self, from: Data(contentsOf: placed.appendingPathComponent("clip.json")))
    check("what lands decodes back to the clip", decoded == clip)
} catch {
    check("inbox write", false, "\(error)")
}
try? FileManager.default.removeItem(at: temp)

// --- the contract, pinned by fixtures the Rust importer's tests read too ---------

if let fixtures = ProcessInfo.processInfo.environment["SHARE_FIXTURES"] {
    let base = URL(fileURLWithPath: fixtures, isDirectory: true)
    do {
        let clip = try JSONDecoder().decode(
            Clip.self, from: Data(contentsOf: base.appendingPathComponent("clip.json")))
        check("the fixture clip decodes",
              clip.title == "Proof of Code Understanding" && clip.images == ["1-shot.png"]
                  && clip.html == nil && clip.createdAt == 1_789_500_000_000)
        let again = try JSONDecoder().decode(Clip.self, from: JSONEncoder().encode(clip))
        check("a clip survives its own encoding", again == clip)
        let destinations = try JSONDecoder().decode(
            Destinations.self, from: Data(contentsOf: base.appendingPathComponent("destinations.json")))
        check("the destinations the app writes decode",
              destinations.workspaces.map(\.name) == ["My Notes", "Thesis"]
                  && destinations.activeWorkspaceId == destinations.workspaces.first?.id)
    } catch {
        check("contract fixtures", false, "\(error)")
    }
} else {
    check("SHARE_FIXTURES names the fixture folder (extensions/test.sh sets it)", false)
}

if failures == 0 {
    print("all share extension tests passed")
} else {
    print("\n\(failures) failing")
    exit(1)
}
