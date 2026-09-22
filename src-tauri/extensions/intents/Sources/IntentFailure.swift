import AppIntents

/// Why an action could not do what was asked, in words Shortcuts and Siri show.
enum IntentFailure: Error, Equatable, CustomLocalizedStringResourceConvertible {
    /// This copy of Compose is not signed into the folder it shares with its
    /// extensions, so nothing handed to it would arrive.
    case unreachable
    case nothingToAdd
    case emptyClipboard
    case privateClipboard

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .unreachable: "Shortcuts cannot reach this copy of Compose. Reinstall Compose, then try again."
        case .nothingToAdd: "There is no text to add."
        case .emptyClipboard: "The clipboard holds no text or images for a note."
        case .privateClipboard: "The clipboard holds a password, which Compose does not save."
        }
    }
}
