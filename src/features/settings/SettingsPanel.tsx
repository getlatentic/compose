import { useState } from "react";
import { Button, Tab, TabList, TabPanel, TabPanels, Tabs, Toggle } from "@carbon/react";

import { useUiStore } from "../../app/store/uiStore";
import { useHarnessStore } from "../../app/store/harnessStore";
import { type HarnessReadiness } from "../../lib/ipc/harnessClient";
import { revealErrorLog } from "../../lib/diagnostics/errorReporter";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { AgentList } from "./AgentList";
import { AgentDetail } from "./AgentDetail";
import { AddAgentForm } from "./AddAgentForm";

/** bob's `readiness().details` payload (a JSON object on the wire). Read for
 * the Node.js diagnostics the About tab surfaces ("Runtime: Node …"). */
interface BobReadinessDetails {
  node?: {
    version?: string | null;
    satisfies_min?: boolean;
    min_version?: string;
    installed?: boolean;
  };
}

/** Narrow a readiness's opaque `details` to bob's node diagnostics. */
function bobNodeVersion(readiness: HarnessReadiness | null): string | null {
  const details = readiness?.details as BobReadinessDetails | null | undefined;
  return details?.node?.version ?? null;
}

/** Which agents view the AI-agents tab is showing: the registry list, one
 *  agent's setup/detail, or the add-a-custom-agent form. */
type AgentView = { kind: "list" } | { kind: "detail"; id: string } | { kind: "add" };

/**
 * Settings content — the registry of AI agents and app preferences. Rendered
 * either inside a workspace tab (the pane host) or, on the dashboard where there
 * is no tab strip, inside the modal wrapper [SettingsDialog](./SettingsDialog.tsx).
 * It owns no chrome (no backdrop / title bar) so it composes into either host.
 */
export function SettingsPanel() {
  const selectedHarnessReadiness = useHarnessStore((state) => state.selectedHarnessReadiness);
  const soundOnComplete = useUiStore((state) => state.soundOnComplete);
  const setSoundOnComplete = useUiStore((state) => state.setSoundOnComplete);
  const [view, setView] = useState<AgentView>({ kind: "list" });

  return (
    <Tabs>
      <TabList aria-label="Settings sections" contained>
        <Tab>AI agents</Tab>
        <Tab>About</Tab>
      </TabList>
      <TabPanels>
        {/* ----- AI agents tab ------------------------- */}
        <TabPanel>
          {view.kind === "detail" ? (
            <AgentDetail agentId={view.id} onBack={() => setView({ kind: "list" })} />
          ) : view.kind === "add" ? (
            <AddAgentForm
              onBack={() => setView({ kind: "list" })}
              onAdded={(id) => setView({ kind: "detail", id })}
            />
          ) : (
            <>
              <AgentList
                onOpenAgent={(id) => setView({ kind: "detail", id })}
                onAddAgent={() => setView({ kind: "add" })}
              />
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
                <p className="settings-helper">Play a subtle chime when the agent finishes a run.</p>
              </div>
            </>
          )}
        </TabPanel>

        {/* ----- About tab ------------------------------- */}
        <TabPanel>
          <div className="settings-section">
            <h3>About Compose</h3>
            <p className="settings-helper">Compose · version 0.1.0</p>
            <p className="settings-helper">
              A local-first AI writing workspace — your notes stay on your computer. AI for
              everyone.
            </p>
            {bobNodeVersion(selectedHarnessReadiness) ? (
              <p className="settings-helper">
                Runtime: Node.js {bobNodeVersion(selectedHarnessReadiness)}
              </p>
            ) : null}
          </div>
          {isTauriRuntime() ? (
            <div className="settings-section">
              <h3>Report a problem</h3>
              <p className="settings-helper">
                Compose keeps a local error log on your computer — it's never sent anywhere. If
                something goes wrong, open it and attach it to your report.
              </p>
              <Button size="sm" kind="tertiary" onClick={() => void revealErrorLog()}>
                Open error log
              </Button>
            </div>
          ) : null}
        </TabPanel>
      </TabPanels>
    </Tabs>
  );
}
