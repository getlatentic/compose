import { useEffect } from "react";
import { Button, InlineNotification, SkeletonText, Tag } from "@carbon/react";
import { useSystemStore } from "../../app/store/systemStore";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { InstallHintInline } from "./InstallHint";

/**
 * The "Local AI" panel: detect the optional on-device tools (Ollama) and, for
 * anything missing, hand the user to the official download — the same
 * detect-and-link contract agents get ({@link InstallHintInline}). Compose
 * never installs: the user downloads, then Recheck picks it up.
 */
export function SystemSetupPanel() {
  const statuses = useSystemStore((state) => state.statuses);
  const loaded = useSystemStore((state) => state.loaded);
  const loadSystemReadiness = useSystemStore((state) => state.loadSystemReadiness);

  useEffect(() => {
    void loadSystemReadiness();
  }, [loadSystemReadiness]);

  if (!isTauriRuntime()) {
    return (
      <div className="settings-section">
        <InlineNotification
          hideCloseButton
          kind="info"
          lowContrast
          title="Desktop only"
          subtitle="Local AI detection runs in the Compose desktop app."
        />
      </div>
    );
  }

  return (
    <div className="settings-section">
      <p className="settings-helper">
        Optional on-device AI. Compose works without it — install any of these
        yourself and Compose picks them up.
      </p>

      {!loaded ? (
        <ul className="system-deps" aria-hidden>
          <li className="system-deps__row">
            <SkeletonText heading width="35%" />
            <SkeletonText width="80%" />
          </li>
        </ul>
      ) : (
        <ul className="system-deps">
          {statuses.map((status) => (
            <li key={status.id} className="system-deps__row">
              <div className="system-deps__title">
                <strong>{status.name}</strong>
                {status.present ? (
                  <Tag size="sm" type="green">
                    {status.version ? `Installed · ${status.version}` : "Installed"}
                  </Tag>
                ) : (
                  <Tag size="sm" type="warm-gray">
                    Not installed
                  </Tag>
                )}
              </div>
              <p className="settings-helper">{status.description}</p>
              {status.present ? null : <InstallHintInline hint={status.hint} />}
            </li>
          ))}
        </ul>
      )}

      <Button size="sm" kind="tertiary" onClick={loadSystemReadiness}>
        Recheck
      </Button>
    </div>
  );
}
