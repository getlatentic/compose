import { Close } from "@carbon/react/icons";
import { SettingsPanel } from "./SettingsPanel";

/**
 * Modal wrapper around [SettingsPanel](./SettingsPanel.tsx). Used on the
 * dashboard, where there is no editor tab strip to host Settings as a
 * pane. Inside a workspace, Settings opens as a tab instead (see the pane
 * host in AppShell), which is why this is now a thin chrome shell — all
 * the actual settings UI lives in `SettingsPanel`.
 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop">
      <section className="settings-dialog" aria-modal="true" role="dialog">
        <div className="settings-header">
          <h2>Settings</h2>
          <button
            type="button"
            onClick={onClose}
            title="Close settings"
            aria-label="Close settings"
            className="icon-button"
          >
            <Close size={16} />
          </button>
        </div>
        <SettingsPanel />
      </section>
    </div>
  );
}
