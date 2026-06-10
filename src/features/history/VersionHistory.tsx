import { useEffect, useState } from "react";
import { Button, InlineLoading, InlineNotification, Modal } from "@carbon/react";

import { relativeTime } from "../chat/conversationView";
import {
  listVersions,
  restoreVersion,
  type DocumentVersion,
} from "../../lib/ipc/historyClient";

/**
 * Plain-language "restore a previous version" dialog for one file — the
 * git-free undo. Lists the recent saved versions of `filePath` (newest first,
 * backed by document_snapshots) and writes a chosen one back. Restoring saves
 * the current content first, so a restore is itself undoable. Desktop-only
 * data (SQLite history); the browser preview shows an empty list.
 */
export function VersionHistory({
  workspaceId,
  filePath,
  open,
  onClose,
  onRestored,
}: {
  workspaceId: string;
  filePath: string;
  open: boolean;
  onClose: () => void;
  onRestored: () => void | Promise<void>;
}) {
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRestoringId(null);
    listVersions(workspaceId, filePath)
      .then((result) => {
        if (!cancelled) {
          setVersions(result);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Could not load previous versions.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId, filePath]);

  async function handleRestore(version: DocumentVersion) {
    setRestoringId(version.revisionId);
    setError(null);
    try {
      await restoreVersion(workspaceId, filePath, version.revisionId);
      await onRestored();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not restore this version.");
      setRestoringId(null);
    }
  }

  const now = Date.now();

  return (
    <Modal
      open={open}
      passiveModal
      modalHeading="Previous versions"
      modalLabel={filePath}
      onRequestClose={onClose}
    >
      <p className="bob-version-history__intro">
        Pick a version to go back to. Your current file is saved first, so you can undo a
        restore too.
      </p>
      {error ? (
        <InlineNotification
          hideCloseButton
          kind="error"
          lowContrast
          title="Something went wrong"
          subtitle={error}
        />
      ) : null}
      {loading ? (
        <InlineLoading description="Loading previous versions…" />
      ) : versions.length === 0 ? (
        <p className="bob-version-history__empty">
          No earlier versions yet. Compose saves one each time this file changes.
        </p>
      ) : (
        <ul className="bob-version-history__list" style={{ display: "grid", gap: "0.5rem" }}>
          {versions.map((version) => (
            <li
              key={version.revisionId}
              className="bob-version-history__item"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "1rem",
              }}
            >
              <div className="bob-version-history__meta" style={{ display: "flex", gap: "0.75rem" }}>
                <span className="bob-version-history__when">{relativeTime(version.createdAt, now)}</span>
                <span className="bob-version-history__size">{formatBytes(version.sizeBytes)}</span>
                {version.isCurrent ? (
                  <span className="bob-version-history__current">Current version</span>
                ) : null}
              </div>
              <Button
                size="sm"
                kind="tertiary"
                disabled={version.isCurrent || restoringId !== null}
                onClick={() => void handleRestore(version)}
              >
                {restoringId === version.revisionId ? "Restoring…" : "Restore"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} bytes`;
  }
  return `${Math.round(size / 1024)} KB`;
}
