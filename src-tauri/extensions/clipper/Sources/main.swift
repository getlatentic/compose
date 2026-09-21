import Foundation

// Started by the browser for the Compose clipper, with a native-messaging
// channel on stdin and stdout. Answers each message until the browser closes
// its end.
let host = ClipperHost.live()
let input = FileHandle.standardInput
let output = FileHandle.standardOutput

while true {
    let message: Data?
    do {
        message = try NativeMessaging.nextMessage { input.readData(ofLength: $0) }
    } catch {
        FileHandle.standardError.write(Data("compose clipper host: \(error)\n".utf8))
        exit(1)
    }
    guard let message else { exit(0) }
    do {
        output.write(try NativeMessaging.frame(host.respond(to: message)))
    } catch {
        FileHandle.standardError.write(Data("compose clipper host: \(error)\n".utf8))
        exit(1)
    }
}
