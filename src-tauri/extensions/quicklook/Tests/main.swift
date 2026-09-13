import Foundation

var failures = 0

/// Both are variadic and either may be omitted, so a case can state what the
/// HTML must have, must not have, or both.
func expect(
    _ name: String, _ actual: String, contains expected: String..., lacks unexpected: String...
) {
    let missing = expected.filter { !actual.contains($0) }
    let present = unexpected.filter { actual.contains($0) }
    if missing.isEmpty && present.isEmpty { return }
    failures += 1
    print("FAIL \(name)")
    for item in missing { print("  missing: \(item)") }
    for item in present { print("  should not be there: \(item)") }
    print("  actual: \(actual)")
}

func expect(_ name: String, _ actual: String?, equals expected: String?) {
    if actual == expected { return }
    failures += 1
    print("FAIL \(name)\n  expected: \(expected ?? "nil")\n  actual: \(actual ?? "nil")")
}

func html(_ markdown: String) -> String { HTMLRenderer.render(markdown) }

// --- blocks -----------------------------------------------------------------

expect("heading", html("## Method"), contains: "<h2>Method</h2>")

expect(
  "nested list keeps its nesting",
  html("- one\n- two\n  - deep"),
  contains: "<ul>", "<li>one</li>", "<li>two<ul><li>deep</li>")

expect(
  "two separate lists do not merge",
  html("- a\n\ntext\n\n- b"),
  contains: "</ul>", "<p>text</p>")

expect(
  "a tight list item writes no paragraph",
  html("- one\n- two"),
  lacks: "<p>")

expect(
  "code block keeps its language and does not get marked up",
  html("```swift\nlet x = *1*\n```"),
  contains: "<pre><code class=\"language-swift\">", "let x = *1*")

expect(
  "table header cells differ from body cells",
  html("| a | b |\n|---|--:|\n| 1 | 2 |"),
  contains: "<table>", "<th>a</th>", "<td>1</td>", "text-align:right")

expect("blockquote", html("> quoted"), contains: "<blockquote>", "quoted")
expect("thematic break", html("a\n\n---\n\nb"), contains: "<hr>")

// --- inline -----------------------------------------------------------------

expect(
  "inline intents",
  html("*a* **b** `c` ~~d~~"),
  contains: "<em>a</em>", "<strong>b</strong>", "<code>c</code>", "<del>d</del>")

expect("link", html("[x](https://a.dev)"), contains: "<a href=\"https://a.dev\">x</a>")

expect(
  "html in the source is escaped, not passed through",
  html("<script>alert(1)</script> & <b>"),
  contains: "&lt;script&gt;", "&amp;", lacks: "<script>")

// --- Compose's own syntax ---------------------------------------------------

expect("wiki link", html("see [[Thesis]]"), contains: "<span class=\"wikilink\">Thesis</span>")
expect(
  "aliased wiki link shows the alias only",
  html("see [[thesis/framework|the framework]]"),
  contains: ">the framework<", lacks: "thesis/framework")

expect(
  "task list",
  html("- [ ] todo\n- [x] done"),
  contains: "<input type=\"checkbox\" disabled> todo", "disabled checked> done",
  lacks: "[ ]", "[x]")

// --- images -----------------------------------------------------------------

// A sandboxed preview extension may read the previewed file and nothing beside
// it, so every image is named rather than shown — see Inline.placeholder.
expect(
  "a local image is named, not fetched",
  html("![shot](shots/a.png)"),
  contains: "<span class=\"image-placeholder\">shot</span>", lacks: "<img")

expect(
  "a remote image is never fetched",
  html("![x](https://tracker.example/p.png)"),
  contains: "image-placeholder", lacks: "<img", "tracker.example")

expect(
  "an image with no alt text still says something",
  html("![](a.png)"),
  contains: ">image<")

// --- frontmatter ------------------------------------------------------------

let doc = MarkdownDocument(source: "---\ntitle: \"The Framework\"\ntags: [a]\n---\n\n# Body\n\ntext")
expect("frontmatter title", doc.title, equals: "The Framework")
expect("frontmatter is not rendered", html(doc.body), contains: "<h1>Body</h1>", lacks: "tags")

let untitled = MarkdownDocument(source: "# First Heading\n\ntext")
expect("falls back to the first heading", untitled.title, equals: "First Heading")

let dashes = MarkdownDocument(source: "---\n\nnot frontmatter")
expect("a lone rule is not frontmatter", dashes.body, equals: "---\n\nnot frontmatter")

// ---------------------------------------------------------------------------

if failures == 0 {
    print("all renderer tests passed")
} else {
    print("\n\(failures) failing")
    exit(1)
}
