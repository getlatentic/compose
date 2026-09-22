import Foundation

var failures = 0

func check(_ name: String, _ condition: Bool, _ detail: @autoclosure () -> String = "") {
    if condition { return }
    failures += 1
    print("FAIL \(name) \(detail())")
}

let destinations = Destinations(
    version: 1, activeWorkspaceId: "w1",
    workspaces: [.init(id: "w1", name: "My Notes", path: "/vaults/My Notes"), .init(id: "w2", name: "Thesis", path: "/vaults/Thesis")])
let folders = WorkspaceFolders(destinations)
let documents = DocumentFiles(extensions: ["md", "markdown"])

func file(_ path: String) -> URL { URL(fileURLWithPath: path, isDirectory: false) }
func folder(_ path: String) -> URL { URL(fileURLWithPath: path, isDirectory: true) }

// --- the workspaces' folders ---------------------------------------------------------

check("a note in a workspace is in its folders", folders.contains(file("/vaults/My Notes/Ideas/a.md")))
check("a workspace's own folder counts", folders.contains(folder("/vaults/Thesis")) && folders.isRoot(folder("/vaults/Thesis/")))
check("a folder that only starts with a workspace's name is outside",
      !folders.contains(file("/vaults/My Notes Old/a.md")) && !folders.contains(folder("/vaults")))
check("a subfolder is not badged as a workspace", !folders.isRoot(folder("/vaults/My Notes/Ideas")))
check("a Compose that published no paths offers nothing",
      WorkspaceFolders(Destinations(version: 1, activeWorkspaceId: nil, workspaces: [.init(id: "w", name: "Old")])).roots.isEmpty)

// --- what each menu offers -------------------------------------------------------------

func actions(_ place: FinderMenu.Place, selected: [URL] = [], targeted: URL? = nil) -> [FinderAction] {
    FinderMenu.actions(at: place, selected: selected, targeted: targeted, folders: folders, documents: documents,
                       isFolder: \.hasDirectoryPath)
}

let note = file("/vaults/My Notes/a.md")
let other = file("/vaults/Thesis/b.markdown")
let ideas = folder("/vaults/My Notes/Ideas")

check("selected notes open in Compose, and only the notes",
      actions(.items, selected: [note, file("/vaults/My Notes/photo.png"), other]) == [.open([note, other])])
check("a selected workspace folder gets a new note", actions(.items, selected: [ideas]) == [.newNote(in: ideas)])
check("the background of a workspace folder gets a new note", actions(.background, targeted: ideas) == [.newNote(in: ideas)])
check("the toolbar offers both", actions(.toolbar, selected: [note], targeted: ideas) == [.open([note]), .newNote(in: ideas)])
check("outside the workspaces, nothing",
      actions(.items, selected: [file("/Users/me/Desktop/a.md")]).isEmpty
          && actions(.background, targeted: folder("/Users/me/Desktop")).isEmpty)
check("the background never offers to open what happens to be selected",
      actions(.background, selected: [note], targeted: ideas) == [.newNote(in: ideas)])

check("one note or several", FinderAction.open([note]).title == "Open in Compose"
      && FinderAction.open([note, other]).title == "Open 2 Notes in Compose")
check("a new note says whose it is", FinderAction.newNote(in: ideas).title == "New Compose Note")

// --- the clip New Compose Note leaves --------------------------------------------------

var draft = ClipDraft()
draft.title = "Untitled"
let clip = draft.clip(id: "c1", workspaceId: nil, createdAt: Date(timeIntervalSince1970: 0), open: true, folder: ideas.path)
let json = String(data: try! JSONEncoder().encode(clip), encoding: .utf8)!
check("the note is asked for in the folder, to be opened",
      json.contains("\"folder\":\"\\/vaults\\/My Notes\\/Ideas\"") && json.contains("\"open\":true"), json)
let plain = ClipDraft(title: "T", text: "x").clip(id: "c2", workspaceId: nil, createdAt: Date())
check("a clip without a folder names none", !String(data: try! JSONEncoder().encode(plain), encoding: .utf8)!.contains("folder"))

// --- the contract, from the fixture the Rust tests pin too -----------------------------

if let fixtures = ProcessInfo.processInfo.environment["CONTRACT_FIXTURES"] {
    let published = try! JSONDecoder().decode(
        Destinations.self, from: Data(contentsOf: URL(fileURLWithPath: fixtures).appendingPathComponent("destinations.json")))
    check("the workspaces' folders the app writes decode", WorkspaceFolders(published).roots.map(\.path) == ["/vaults/My Notes", "/vaults/Thesis"])
} else {
    check("CONTRACT_FIXTURES names the fixture folder (extensions/test.sh sets it)", false)
}

if failures == 0 {
    print("all Finder extension tests passed")
} else {
    print("\n\(failures) failing")
    exit(1)
}
