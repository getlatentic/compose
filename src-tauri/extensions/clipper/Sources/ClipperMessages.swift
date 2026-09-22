import Foundation

/// What the browser clipper and this host say to each other over native
/// messaging. The clipper mirrors these types (compose-clipper, `src/protocol.ts`);
/// `protocolVersion` lets either side refuse a partner it does not understand.
enum ClipperProtocol {
    static let version = 1
}

/// A request from the clipper, told apart by `type`.
enum ClipperRequest: Decodable, Equatable {
    /// Which workspaces a clip can go to, and whether Compose is running.
    case hello
    /// Leave a clip for Compose to file.
    case clip(ClipSubmission)
    /// Bring Compose to the front, to see what was clipped.
    case open

    private enum CodingKeys: String, CodingKey {
        case type
        case clip
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "hello": self = .hello
        case "clip": self = .clip(try container.decode(ClipSubmission.self, forKey: .clip))
        case "open": self = .open
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: container, debugDescription: "unknown request type \(type)")
        }
    }
}

/// One page or selection, already Markdown: the clipper converts it where the
/// live page is, so Compose files it as it arrives.
struct ClipSubmission: Codable, Equatable {
    let title: String
    let url: String?
    let markdown: String
    /// `nil` to file it in whichever workspace is open in Compose.
    let workspaceId: String?
}

/// The host's answer. One shape for every request, so the clipper reads a
/// failure the same way whatever it asked.
struct ClipperResponse: Encodable, Equatable {
    let protocolVersion: Int
    let ok: Bool
    /// Why the request failed, in words the clipper can show as they are.
    let error: String?
    /// Whether Compose itself is running, so a saved clip can say when it will
    /// appear.
    let composeRunning: Bool
    /// On `hello`: the workspaces Compose last published, `nil` when it has
    /// published none.
    let destinations: Destinations?
    /// On `clip`: the id the clip was filed under.
    let clipId: String?

    static func success(
        composeRunning: Bool, destinations: Destinations? = nil, clipId: String? = nil
    ) -> ClipperResponse {
        ClipperResponse(
            protocolVersion: ClipperProtocol.version, ok: true, error: nil,
            composeRunning: composeRunning, destinations: destinations, clipId: clipId)
    }

    static func failure(_ error: String, composeRunning: Bool) -> ClipperResponse {
        ClipperResponse(
            protocolVersion: ClipperProtocol.version, ok: false, error: error,
            composeRunning: composeRunning, destinations: nil, clipId: nil)
    }
}
