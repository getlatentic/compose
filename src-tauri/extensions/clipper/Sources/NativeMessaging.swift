import Foundation

/// Native messaging's framing: every message is a 32-bit length in the
/// machine's byte order, then that many bytes of UTF-8 JSON.
enum NativeMessaging {
    /// Chrome drops a reply from a host that is larger than 1 MB.
    static let largestReply = 1024 * 1024
    /// Browsers send up to 64 MiB to a host. A clip is text, so this is ample.
    static let largestRequest = 64 * 1024 * 1024

    enum FrameError: Error, Equatable {
        /// The input ended in the middle of a message.
        case truncated
        case tooLarge(Int)
    }

    /// The next message, or `nil` when the input ends between messages, which
    /// is how the browser says it is done. `read(n)` returns up to `n` bytes,
    /// and no bytes at the end of the input.
    static func nextMessage(_ read: (Int) -> Data) throws -> Data? {
        guard let header = try exactly(4, read, emptyIsEnd: true) else { return nil }
        let length = Int(header.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) })
        guard length <= largestRequest else { throw FrameError.tooLarge(length) }
        return try exactly(length, read, emptyIsEnd: false) ?? Data()
    }

    static func frame(_ message: Data) throws -> Data {
        guard message.count <= largestReply else { throw FrameError.tooLarge(message.count) }
        var length = UInt32(message.count)
        return Data(bytes: &length, count: 4) + message
    }

    private static func exactly(_ count: Int, _ read: (Int) -> Data, emptyIsEnd: Bool) throws -> Data? {
        var data = Data()
        while data.count < count {
            let chunk = read(count - data.count)
            if chunk.isEmpty {
                if data.isEmpty && emptyIsEnd { return nil }
                throw FrameError.truncated
            }
            data.append(chunk)
        }
        return data
    }
}
