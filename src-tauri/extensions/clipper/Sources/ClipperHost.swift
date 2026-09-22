import AppKit

/// Answers the browser clipper. A clip goes into the share inbox the Share
/// extension uses, so Compose files it the same way, now or when it next opens.
struct ClipperHost {
    static let composeBundleId = "ai.latentic.compose"
    static let noInbox =
        "This copy of Compose cannot take clips. Install Compose from its download page, then try again."

    let inbox: ShareInbox?
    let composeRunning: () -> Bool
    let openCompose: () -> Bool
    let now: () -> Date
    let newId: () -> String

    /// The host as the browser starts it: the inbox of the app group it was
    /// signed into, and the Compose it ships inside.
    static func live() -> ClipperHost {
        ClipperHost(
            inbox: ShareInbox.located(),
            composeRunning: {
                !NSRunningApplication.runningApplications(withBundleIdentifier: composeBundleId).isEmpty
            },
            openCompose: openEnclosingCompose,
            now: Date.init,
            newId: { UUID().uuidString })
    }

    /// Always an answer, even to a request it cannot read: a browser waiting on
    /// a host that says nothing shows the user nothing either.
    func respond(to message: Data) -> Data {
        let response: ClipperResponse
        if let request = try? JSONDecoder().decode(ClipperRequest.self, from: message) {
            response = handle(request)
        } else {
            response = .failure(
                "Compose could not read that request. Update the clipper or Compose.",
                composeRunning: composeRunning())
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return (try? encoder.encode(response)) ?? Data(#"{"ok":false}"#.utf8)
    }

    func handle(_ request: ClipperRequest) -> ClipperResponse {
        let running = composeRunning()
        switch request {
        case .hello:
            guard let inbox else { return .failure(Self.noInbox, composeRunning: running) }
            return .success(composeRunning: running, destinations: inbox.destinations())
        case .clip(let submission):
            guard let inbox else { return .failure(Self.noInbox, composeRunning: running) }
            return file(submission, in: inbox, composeRunning: running)
        case .open:
            return openCompose()
                ? .success(composeRunning: true)
                : .failure("Compose could not be opened.", composeRunning: running)
        }
    }

    private func file(_ submission: ClipSubmission, in inbox: ShareInbox, composeRunning: Bool)
        -> ClipperResponse
    {
        guard !submission.markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return .failure("There was nothing on this page to clip.", composeRunning: composeRunning)
        }
        let url = submission.url.flatMap(URL.init(string:))
        let clip = Clip(
            version: Clip.currentVersion,
            id: newId(),
            createdAt: Int64((now().timeIntervalSince1970 * 1000).rounded()),
            workspaceId: submission.workspaceId,
            title: ClipDraft.suggestedTitle(itemTitle: submission.title, text: nil, url: url),
            url: submission.url,
            text: nil,
            html: nil,
            page: nil,
            markdown: submission.markdown,
            images: [],
            open: false)
        do {
            try inbox.write(clip, images: [])
        } catch {
            return .failure(
                "Compose could not save the clip: \(error.localizedDescription)",
                composeRunning: composeRunning)
        }
        return .success(composeRunning: composeRunning, clipId: clip.id)
    }

    /// The host lives at `Compose.app/Contents/Helpers/`, so the Compose to open
    /// is the one it came in, not whichever copy the system finds first.
    private static func openEnclosingCompose() -> Bool {
        let app = Bundle.main.executableURL?
            .deletingLastPathComponent()  // Helpers
            .deletingLastPathComponent()  // Contents
            .deletingLastPathComponent()  // Compose.app
        guard let app, app.pathExtension == "app" else { return false }
        let open = Process()
        open.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        open.arguments = [app.path]
        do {
            try open.run()
            open.waitUntilExit()
            return open.terminationStatus == 0
        } catch {
            return false
        }
    }
}
