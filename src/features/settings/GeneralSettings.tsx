import { Toggle } from "@carbon/react";

import { useUiStore } from "../../app/store/uiStore";

/** The "General" settings pane: app-wide preferences not tied to any agent. */
export function GeneralSettings() {
  const soundOnComplete = useUiStore((state) => state.soundOnComplete);
  const setSoundOnComplete = useUiStore((state) => state.setSoundOnComplete);

  return (
    <div className="settings-section">
      <h3>Preferences</h3>
      <Toggle
        id="sound-on-complete"
        size="sm"
        labelText="Sound when a run finishes"
        labelA="Off"
        labelB="On"
        toggled={soundOnComplete}
        onToggle={(checked) => setSoundOnComplete(checked)}
      />
      <p className="settings-helper">Play a subtle chime when an agent finishes a run.</p>
    </div>
  );
}
