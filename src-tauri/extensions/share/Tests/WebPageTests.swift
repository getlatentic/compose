import AppKit

/// What Safari hands over for a shared page: the property list ComposePage.js
/// returned, under the key Safari files it by.
func safariPage(_ results: [String: String]) -> NSItemProvider {
    NSItemProvider(
        item: [NSExtensionJavaScriptPreprocessingResultsKey: results] as NSDictionary,
        typeIdentifier: "com.apple.property-list")
}

func testWebPages() {
    let whole = sharedContent(from: [item(safariPage([
        "url": "https://thinkyorubafirst.org/books/ifa/",
        "title": "Ifa: An Exposition",
        "selection": "",
        "page": "<html><body><article><p>Ifa is a body of literature.</p></article></body></html>",
    ]))])
    check("a shared page keeps its address", whole.draft.url?.host == "thinkyorubafirst.org")
    check("and is titled as the page is, not by its host", whole.draft.title == "Ifa: An Exposition",
          whole.draft.title)
    check("and carries the page for the app to find its article",
          whole.draft.page?.contains("<article>") == true && whole.draft.html == nil)
    check("so it can be saved", !whole.draft.isEmpty)

    let selected = sharedContent(from: [item(safariPage([
        "url": "https://thinkyorubafirst.org/books/ifa/",
        "title": "Ifa: An Exposition",
        "selection": "<p>Just <b>this</b>.</p>",
        "page": "",
    ]))])
    check("a selection is filed as it is, without the page",
          selected.draft.html == "<p>Just <b>this</b>.</p>" && selected.draft.page == nil)

    let clip = whole.draft.clip(id: "p", workspaceId: nil, createdAt: Date())
    let json = String(data: try! JSONEncoder().encode(clip), encoding: .utf8)!
    check("clip.json carries the page", json.contains("\"page\""), json)
}
