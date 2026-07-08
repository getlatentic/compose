import { useMemo } from "react";
import { useMarkdownPreview } from "./useMarkdownPreview";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { useUiStore } from "../../app/store/uiStore";
import { selectFocusedWorkspace } from "../../app/store/activeWorkspace";
import { isActiveFilePresent } from "../../app/workspaceModel";

/**
 * The editor status bar — file path, the Rich/Raw mode toggle, and the
 * unsaved-dot + word-count.
 *
 * A self-subscribing leaf so the word count (which updates as you type) and the
 * dirty flip re-render HERE and not the whole {@link EditorRegion}. It reads the
 * active buffer through narrow selectors and runs its own (cached, debounced)
 * preview for the count.
 */
export function DocumentStatusBar() {
  const activeFileExists = useWorkspaceStore((state) => {
    const workspace = selectFocusedWorkspace(state);
    return workspace ? isActiveFilePresent(workspace) : false;
  });
  const content = useWorkspaceStore((state) => {
    const workspace = selectFocusedWorkspace(state);
    return workspace?.activeFilePath
      ? workspace.fileContents[workspace.activeFilePath]?.content ?? ""
      : "";
  });
  const dirty = useWorkspaceStore((state) => {
    const workspace = selectFocusedWorkspace(state);
    return Boolean(
      workspace?.activeFilePath && workspace.fileContents[workspace.activeFilePath]?.dirty,
    );
  });
  const editorMode = useUiStore((state) => state.editorMode);
  const toggleEditorMode = useUiStore((state) => state.toggleEditorMode);

  const preview = useMarkdownPreview(content);
  const parseStatus = useMemo(() => {
    if (preview.status === "ready") {
      return `${preview.document.meta.wordCount} words`;
    }
    if (preview.status === "failed") {
      return "Parse failed";
    }
    return "Worker parsing";
  }, [preview]);

  const statusMeta = activeFileExists ? (dirty ? "Unsaved" : parseStatus) : "";

  return (
    <div className="status-bar">
      <span className="status-bar__meta">
        {activeFileExists ? (
          <span className="mode-toggle" role="group" aria-label="Editor mode">
            <button
              type="button"
              className={[
                "mode-toggle__option",
                editorMode === "wysiwyg" ? "mode-toggle__option--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-pressed={editorMode === "wysiwyg"}
              onClick={() => {
                if (editorMode !== "wysiwyg") toggleEditorMode();
              }}
            >
              Rich
            </button>
            <button
              type="button"
              className={[
                "mode-toggle__option",
                editorMode === "source" ? "mode-toggle__option--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-pressed={editorMode === "source"}
              onClick={() => {
                if (editorMode !== "source") toggleEditorMode();
              }}
            >
              Raw
            </button>
          </span>
        ) : null}
        {statusMeta ? (
          <>
            <span
              className={["status-bar__dot", dirty ? "status-bar__dot--dirty" : ""]
                .filter(Boolean)
                .join(" ")}
            />
            <span>{statusMeta}</span>
          </>
        ) : null}
      </span>
    </div>
  );
}
