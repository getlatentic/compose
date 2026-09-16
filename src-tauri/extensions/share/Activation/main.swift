import Foundation

// build.sh: prints the Share extension's activation rule for the extensions
// Compose opens, as listed in tauri.conf.json.
let extensions = Array(CommandLine.arguments.dropFirst())
guard !extensions.isEmpty else {
    FileHandle.standardError.write(Data("usage: activation-rule <extension>...\n".utf8))
    exit(64)
}
print(ActivationRule.predicate(documentExtensions: extensions))
