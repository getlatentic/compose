import SwiftUI

struct ShareForm: View {
    @ObservedObject var model: ShareModel
    let save: () -> Void
    let cancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if model.loading {
                ProgressView().controlSize(.small).frame(maxWidth: .infinity)
            } else {
                form
            }
        }
        .padding(18)
        .frame(width: 420)
    }

    @ViewBuilder private var form: some View {
        if let opened = model.opened {
            Text("Opened \(opened) in Compose.").font(.callout).foregroundStyle(.secondary)
        }
        TextField("Title", text: $model.draft.title)
            .textFieldStyle(.roundedBorder)
            .font(.headline)
        destination
        preview
        if let failure = model.failure {
            Text(failure).font(.callout).foregroundStyle(.red)
        }
        HStack {
            Spacer()
            Button("Cancel", action: cancel).keyboardShortcut(.cancelAction)
            Button("Save", action: save)
                .keyboardShortcut(.defaultAction)
                .disabled(!model.canSave)
        }
    }

    @ViewBuilder private var destination: some View {
        if model.destinations.isEmpty {
            Text("Saves to the workspace open in Compose.")
                .font(.callout)
                .foregroundStyle(.secondary)
        } else {
            Picker("Save to", selection: $model.workspaceId) {
                ForEach(model.destinations) { workspace in
                    Text(workspace.name).tag(Optional(workspace.id))
                }
            }
        }
    }

    private var preview: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let url = model.draft.url {
                Text(url.absoluteString).lineLimit(1).truncationMode(.middle)
            }
            if let excerpt = model.excerpt {
                Text(excerpt).lineLimit(4)
            }
            if !model.draft.images.isEmpty {
                let count = model.draft.images.count
                Text(count == 1 ? "1 image" : "\(count) images")
            }
        }
        .font(.callout)
        .foregroundStyle(.secondary)
    }
}
