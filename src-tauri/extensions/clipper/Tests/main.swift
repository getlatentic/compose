import Foundation

var failures = 0

func check(_ name: String, _ condition: Bool, _ detail: @autoclosure () -> String = "") {
    if condition { return }
    failures += 1
    print("FAIL \(name) \(detail())")
}

func fixture(_ directory: String, _ name: String) -> Data {
    let root = ProcessInfo.processInfo.environment[directory]!
    return try! Data(contentsOf: URL(fileURLWithPath: root).appendingPathComponent(name))
}

func temporaryInbox() -> ShareInbox {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("clipper-tests-\(UUID().uuidString)", isDirectory: true)
    try! FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    return ShareInbox(root: root)
}

func host(inbox: ShareInbox?, running: Bool = true, opens: Bool = true) -> ClipperHost {
    ClipperHost(
        inbox: inbox,
        composeRunning: { running },
        openCompose: { opens },
        now: { Date(timeIntervalSince1970: 1_789_600_000) },
        newId: { "9D1E4B7A-2C3F-4A5B-8C6D-7E8F9A0B1C2D" })
}

func reply(_ host: ClipperHost, _ json: String) -> [String: Any] {
    let data = host.respond(to: Data(json.utf8))
    return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
}

// --- framing -------------------------------------------------------------------

func reader(_ data: Data, chunk: Int = 3) -> (Int) -> Data {
    var rest = data
    return { wanted in
        let part = rest.prefix(min(wanted, chunk))
        rest = rest.dropFirst(part.count)
        return Data(part)
    }
}

let framed = try! NativeMessaging.frame(Data(#"{"type":"hello"}"#.utf8))
check("a frame is a length then the message", framed.count == 4 + 16)
check("a message reads back whole, however the input arrives",
      (try? NativeMessaging.nextMessage(reader(framed))) == Data(#"{"type":"hello"}"#.utf8))
check("no input left is the end, not an error", (try? NativeMessaging.nextMessage(reader(Data()))) == .some(nil))
do {
    _ = try NativeMessaging.nextMessage(reader(framed.dropLast(2)))
    check("a message cut short is an error", false)
} catch {
    check("a message cut short is an error", error as? NativeMessaging.FrameError == .truncated)
}
var huge = UInt32(NativeMessaging.largestRequest + 1)
do {
    _ = try NativeMessaging.nextMessage(reader(Data(bytes: &huge, count: 4)))
    check("a message larger than any browser sends is refused", false)
} catch {
    check("a message larger than any browser sends is refused",
          error as? NativeMessaging.FrameError == .tooLarge(NativeMessaging.largestRequest + 1))
}
check("a reply too large for the browser is refused",
      (try? NativeMessaging.frame(Data(count: NativeMessaging.largestReply + 1))) == nil)

// --- hello ---------------------------------------------------------------------

let published = temporaryInbox()
try! fixture("SHARE_FIXTURES", "destinations.json").write(to: published.destinationsURL)
let hello = reply(host(inbox: published, running: false), #"{"type":"hello"}"#)
check("hello answers with the protocol it speaks", hello["protocolVersion"] as? Int == ClipperProtocol.version)
check("hello offers the workspaces Compose published",
      ((hello["destinations"] as? [String: Any])?["workspaces"] as? [Any])?.isEmpty == false)
check("hello says whether Compose is running", hello["composeRunning"] as? Bool == false)
check("hello with nothing published still succeeds, offering nothing",
      reply(host(inbox: temporaryInbox()), #"{"type":"hello"}"#)["ok"] as? Bool == true)
let unsigned = reply(host(inbox: nil), #"{"type":"hello"}"#)
check("a Compose that cannot take clips says so", unsigned["ok"] as? Bool == false
      && (unsigned["error"] as? String) == ClipperHost.noInbox)

// --- clip: the request the clipper sends becomes the clip the importer reads ---

let inbox = temporaryInbox()
let filed = host(inbox: inbox).respond(to: fixture("CLIPPER_FIXTURES", "clip-request.json"))
let answer = try! JSONSerialization.jsonObject(with: filed) as! [String: Any]
check("a clip is filed", answer["ok"] as? Bool == true, "\(answer)")
check("under the id it was given", answer["clipId"] as? String == "9D1E4B7A-2C3F-4A5B-8C6D-7E8F9A0B1C2D")
let written = inbox.inboxURL.appendingPathComponent("9D1E4B7A-2C3F-4A5B-8C6D-7E8F9A0B1C2D/clip.json")
let decoded = try? JSONDecoder().decode(Clip.self, from: Data(contentsOf: written))
let expected = try? JSONDecoder().decode(Clip.self, from: fixture("SHARE_FIXTURES", "browser-clip.json"))
check("the clip written is the one the Rust importer's fixture decodes", decoded != nil && decoded == expected,
      "\(String(describing: decoded))")

let untitled = temporaryInbox()
_ = reply(host(inbox: untitled),
          #"{"type":"clip","clip":{"title":"  ","url":"https://www.latentic.ai/x","markdown":"Body"}}"#)
let untitledClip = try? JSONDecoder().decode(
    Clip.self,
    from: Data(contentsOf: untitled.inboxURL.appendingPathComponent("9D1E4B7A-2C3F-4A5B-8C6D-7E8F9A0B1C2D/clip.json")))
check("a page without a title is named after its site", untitledClip?.title == "www.latentic.ai")
check("and without a destination goes to whichever workspace is open", untitledClip?.workspaceId == nil)

let empty = temporaryInbox()
let nothing = reply(host(inbox: empty), #"{"type":"clip","clip":{"title":"T","url":null,"markdown":" \n "}}"#)
check("an empty clip is refused, not filed", nothing["ok"] as? Bool == false
      && !FileManager.default.fileExists(atPath: empty.inboxURL.path))

// --- anything else --------------------------------------------------------------

check("open brings Compose forward", reply(host(inbox: nil, opens: true), #"{"type":"open"}"#)["ok"] as? Bool == true)
check("and says when it could not", reply(host(inbox: nil, opens: false), #"{"type":"open"}"#)["ok"] as? Bool == false)
let unknown = reply(host(inbox: inbox), #"{"type":"format-disk"}"#)
check("a request it does not know is answered, not dropped",
      unknown["ok"] as? Bool == false && (unknown["error"] as? String)?.isEmpty == false)
check("so is one that is not JSON", reply(host(inbox: inbox), "not json")["ok"] as? Bool == false)

if failures > 0 {
    print("\(failures) clipper host check(s) failed")
    exit(1)
}
print("clipper host: all checks passed")
