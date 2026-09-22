import AppIntents

/// One of the workspaces Compose last published.
struct WorkspaceEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Workspace"
    static let defaultQuery = WorkspaceQuery()

    let id: String
    let name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }

    static func all(in destinations: Destinations?) -> [WorkspaceEntity] {
        (destinations?.workspaces ?? []).map { WorkspaceEntity(id: $0.id, name: $0.name) }
    }

    /// The workspace open in Compose.
    static func open(in destinations: Destinations?) -> WorkspaceEntity? {
        all(in: destinations).first { $0.id == destinations?.activeWorkspaceId }
    }
}

struct WorkspaceQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [WorkspaceEntity] {
        WorkspaceEntity.all(in: ShareInbox.located()?.destinations()).filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [WorkspaceEntity] {
        WorkspaceEntity.all(in: ShareInbox.located()?.destinations())
    }

    func defaultResult() async -> WorkspaceEntity? {
        WorkspaceEntity.open(in: ShareInbox.located()?.destinations())
    }
}
