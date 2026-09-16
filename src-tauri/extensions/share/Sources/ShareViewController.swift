import AppKit
import SwiftUI

/// The sheet the system shows for Share → Compose. Named in `Info.plist` as the
/// extension's principal class, so the `@objc` name is part of the bundle's
/// contract.
@objc(ComposeShareViewController)
final class ComposeShareViewController: NSViewController {
    private static let lastWorkspaceKey = "lastWorkspaceId"

    private let model = ShareModel()
    private let inbox = ShareInbox.located()

    override func loadView() {
        let form = ShareForm(
            model: model,
            save: { [weak self] in self?.save() },
            cancel: { [weak self] in self?.cancel() })
        let host = NSHostingView(rootView: form)
        host.frame = NSRect(x: 0, y: 0, width: 420, height: 240)
        view = host
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let destinations = inbox?.destinations()
        model.destinations = destinations?.workspaces ?? []
        model.workspaceId = ShareModel.defaultWorkspace(
            in: destinations,
            lastUsed: UserDefaults.standard.string(forKey: Self.lastWorkspaceKey))
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        Task { @MainActor in
            let content = await SharedItems.content(from: items, documents: .declared)
            model.draft = content.draft
            if !content.ignoredFiles.isEmpty {
                model.ignored = ListFormatter.localizedString(
                    byJoining: content.ignoredFiles.map(\.lastPathComponent))
            }
            if !content.documents.isEmpty {
                let opened = await open(content.documents)
                if opened && content.draft.isEmpty {
                    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
                    return
                }
            }
            model.loading = false
        }
    }

    /// A shared Markdown or text file opens in Compose where it is; the sheet
    /// stays only for whatever else came with it, or to say why it could not.
    private func open(_ documents: [URL]) async -> Bool {
        let names = ListFormatter.localizedString(byJoining: documents.map(\.lastPathComponent))
        do {
            try await OpenInCompose.open(documents)
            model.opened = names
            return true
        } catch {
            model.failure = "Compose could not open \(names): \(error.localizedDescription)"
            return false
        }
    }

    private func save() {
        guard let inbox else {
            model.failure = "Compose could not reach its shared folder."
            return
        }
        let clip = model.draft.clip(
            id: UUID().uuidString, workspaceId: model.workspaceId, createdAt: Date())
        do {
            try inbox.write(clip, images: model.draft.images)
            if let workspaceId = model.workspaceId {
                UserDefaults.standard.set(workspaceId, forKey: Self.lastWorkspaceKey)
            }
            extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        } catch {
            model.failure = "The clip could not be saved: \(error.localizedDescription)"
        }
    }

    private func cancel() {
        extensionContext?.cancelRequest(
            withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
    }
}
