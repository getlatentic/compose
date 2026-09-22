import Foundation

/// The app's workspaces as it last published them. The extensions cannot read
/// the app's settings, so the app mirrors what they need into the shared
/// container.
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
    /// Markdown a browser extension already made from the page: filed as it is.
    let markdown: String?
    /// File names inside the clip's folder.
    let images: [String]
    /// The user asked to see the note: the app opens it once filed.
    let open: Bool
}

/// The notes changed most recently across every workspace, newest first, as the
/// app last published them.
struct PublishedNotes: Codable, Equatable {
    struct Note: Codable, Equatable {
        /// Absolute, and what `compose://open?path=` opens.
        let path: String
        let title: String
        let workspaceId: String
        let workspaceName: String
        /// Milliseconds since the epoch.
        let modifiedAt: Int64
    }

    let version: Int
    let notes: [Note]
}

struct ClipImage: Equatable {
    let fileName: String
    let data: Data
}
