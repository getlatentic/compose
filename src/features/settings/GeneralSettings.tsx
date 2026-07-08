import { Button, TextArea, Toggle } from "@carbon/react";
import { Launch } from "@carbon/react/icons";

import { useHarnessStore } from "../../app/store/harnessStore";
import { useUiStore } from "../../app/store/uiStore";
import { revealErrorLog } from "../../lib/diagnostics/errorReporter";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { DefaultMarkdownAppSection } from "./DefaultMarkdownAppSection";
import { ResetDataSection } from "./ResetDataSection";

/** Cap on the global custom instructions (~500 tokens) so they can't crowd out
 *  the workspace context in a small local model's window. */
const MAX_CUSTOM_INSTRUCTIONS_CHARS = 2000;

/**
 * The "General" settings pane: app-wide preferences not tied to any one agent —
 * notifications, the shared custom instructions added to every agent's prompt,
 * and the local-only diagnostics (open the error log, reset all data). The
 * custom instructions and the two diagnostics moved here so About stays pure
 * identity and the agent list stays pure per-agent setup.
 */
export function GeneralSettings() {
  return (
    <>
      <NotificationsSection />
      <CustomInstructionsSection />
      {isTauriRuntime() ? (
        <>
          <DefaultMarkdownAppSection />
          <PrivacySection />
          <ReportProblemSection />
          <ResetDataSection />
        </>
      ) : null}
    </>
  );
}

function NotificationsSection() {
  const soundOnComplete = useUiStore((state) => state.soundOnComplete);
  const setSoundOnComplete = useUiStore((state) => state.setSoundOnComplete);

  return (
    <div className="settings-section">
      <h3>Notifications</h3>
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

/** The shared custom instructions, appended to every agent's system prompt where
 *  supported. One contained box (title + textarea + counter); the Carbon
 *  TextArea owns its own label, so the section heading is visually hidden to
 *  avoid a doubled label while still anchoring the section for screen readers. */
function CustomInstructionsSection() {
  const customInstructions = useHarnessStore((state) => state.customInstructions);
  const setCustomInstructions = useHarnessStore((state) => state.setCustomInstructions);

  return (
    <div className="settings-section">
      <TextArea
        id="global-custom-instructions"
        labelText="Custom instructions"
        helperText="Added to every agent's system prompt, where supported."
        placeholder="e.g. Answer in British English; keep summaries to 3 bullets."
        rows={4}
        enableCounter
        maxCount={MAX_CUSTOM_INSTRUCTIONS_CHARS}
        value={customInstructions}
        onChange={(event) => setCustomInstructions(event.target.value)}
      />
    </div>
  );
}

function PrivacySection() {
  const analyticsEnabled = useUiStore((state) => state.analyticsEnabled);
  const setAnalyticsEnabled = useUiStore((state) => state.setAnalyticsEnabled);

  return (
    <div className="settings-section">
      <h3>Privacy</h3>
      <Toggle
        id="analytics-enabled"
        size="sm"
        labelText="Share anonymous usage statistics"
        labelA="Off"
        labelB="On"
        toggled={analyticsEnabled}
        onToggle={(checked) => setAnalyticsEnabled(checked)}
      />
      <p className="settings-helper">
        Sends an anonymous signal when Compose opens, so we can count active users and which version
        they're on. No note content, file names, or personal data — ever. Powered by Aptabase, a
        privacy-first analytics service.
      </p>
    </div>
  );
}

function ReportProblemSection() {
  return (
    <div className="settings-section">
      <h3>Report a problem</h3>
      <p className="settings-helper">
        Compose keeps a local error log on your computer — it's never sent anywhere. If something
        goes wrong, open it and attach it to your report.
      </p>
      <div className="settings-actions">
        <Button size="sm" kind="tertiary" renderIcon={Launch} onClick={() => void revealErrorLog()}>
          Open error log
        </Button>
      </div>
    </div>
  );
}
