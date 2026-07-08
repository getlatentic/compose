import { memo, useCallback, useMemo } from "react";
import { Close, Document } from "@carbon/react/icons";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { selectLooseWorkspace } from "../../app/store/activeWorkspace";
import { useConfirm } from "../dialogs/ConfirmProvider";
import { basename } from "../../lib/workspace/displayPath";

/**
 * The "External files" sidebar group (#113) — files opened from outside any
 * workspace, listed above the tree and OUTSIDE it: they belong to no folder
 * here, so they never mix with workspace rows. Each row opens the original
 * file in place; the ✕ stops tracking it (the file on disk is untouched).
 * Hidden entirely while the list is empty.
 */

/** The loose file paths with a STABLE array reference while the displayed
 *  list is unchanged (same pattern as the tree's useStableFileList). */
function useLooseFilePaths(): string[] {
  const key = useWorkspaceStore((state) => {
    const loose = selectLooseWorkspace(state);
    return loose ? loose.files.map((entry) => entry.relativePath).join("\n") : "";
  });
  return useMemo(() => (key ? key.split("\n") : []), [key]);
}

/** Per-row unsaved dot, self-subscribed so a dirty flip re-renders only it. */
function LooseRowDirtyDot({ path }: { path: string }) {
  const dirty = useWorkspaceStore((state) =>
    Boolean(selectLooseWorkspace(state)?.fileContents[path]?.dirty),
  );
  return dirty ? <span className="dirty-dot" aria-label="Unsaved" /> : null;
}

const ExternalFileRow = memo(function ExternalFileRow({
  path,
  active,
  onSelect,
  onRemove,
}: {
  path: string;
  active: boolean;
  onSelect: (path: string) => void;
  onRemove: (path: string) => void;
}) {
  const handleSelect = useCallback(() => onSelect(path), [onSelect, path]);
  const handleRemove = useCallback(() => onRemove(path), [onRemove, path]);
  const name = basename(path);

  return (
    <div
      className={["external-files__row", active ? "external-files__row--active" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="external-files__open"
        title={path}
        onClick={handleSelect}
      >
        <Document size={16} aria-hidden />
        <span className="truncate">{name}</span>
        <LooseRowDirtyDot path={path} />
      </button>
      <button
        type="button"
        className="external-files__remove"
        aria-label={`Remove ${name} from external files`}
        title="Remove from list (the file stays on disk)"
        onClick={handleRemove}
      >
        <Close size={16} aria-hidden />
      </button>
    </div>
  );
});

export function ExternalFilesSection() {
  const paths = useLooseFilePaths();
  const activePath = useWorkspaceStore((state) =>
    state.focusedArea === "loose" ? selectLooseWorkspace(state)?.activeFilePath ?? "" : "",
  );
  const selectLooseFile = useWorkspaceStore((state) => state.selectLooseFile);
  const removeLooseFile = useWorkspaceStore((state) => state.removeLooseFile);
  const confirm = useConfirm();

  const handleSelect = useCallback(
    (path: string) => void selectLooseFile(path),
    [selectLooseFile],
  );
  const handleRemove = useCallback(
    (path: string) => {
      void (async () => {
        // A dirty NON-conflicted buffer is saved by removeLooseFile, so the ✕
        // is loss-free. A CONFLICTED one can't be auto-saved (the disk copy is
        // newer) — removing would discard the local edits, so ask first.
        const buffer = selectLooseWorkspace(useWorkspaceStore.getState())?.fileContents[path];
        if (buffer?.dirty && buffer.conflict) {
          const confirmed = await confirm({
            title: "Discard your changes?",
            message: `${basename(path)} has unsaved changes, and the file also changed on disk. Remove it from the list and discard your changes?`,
            confirmLabel: "Remove and discard",
            danger: true,
          });
          if (!confirmed) {
            return;
          }
        }
        await removeLooseFile(path);
      })();
    },
    [removeLooseFile, confirm],
  );

  if (paths.length === 0) {
    return null;
  }

  return (
    <div className="external-files" role="group" aria-label="External files">
      <div className="external-files__heading">External files</div>
      {paths.map((path) => (
        <ExternalFileRow
          key={path}
          path={path}
          active={path === activePath}
          onSelect={handleSelect}
          onRemove={handleRemove}
        />
      ))}
    </div>
  );
}
