import Foundation

/// The app's workspaces as it last published them for the share sheet. The
/// extension cannot read the app's settings, so the app mirrors what the picker
/// needs into the shared container.
struct Destinations: Codable, Equatable {
    struct Workspace: Codable, Equatable, Identifiable {
        let id: String
        let name: String
    }

    let version: Int
    let activeWorkspaceId: String?
    let workspaces: [Workspace]
}

/// One clip waiting for the app, stored as `clip.json` beside its images. The
/// app owns turning it into a note; this records only what was shared and where
/// the user wants it.
struct Clip: Codable, Equatable {
    static let currentVersion = 1

    let version: Int
    let id: String
    /// Milliseconds since the epoch, like every other timestamp the app stores.
    let createdAt: Int64
    /// `nil` when the app had published no workspaces: it then files the clip
    /// in whichever workspace is active when it imports.
    let workspaceId: String?
    let title: String
    let url: String?
    let text: String?
    let html: String?
    /// A whole web page shared from Safari: the app files its article.
    let page: String?
    /// File names inside the clip's folder.
    let images: [String]
}

struct ClipImage: Equatable {
    let fileName: String
    let data: Data
}
