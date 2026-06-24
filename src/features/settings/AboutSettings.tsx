import { Button } from "@carbon/react";

import { useHarnessStore } from "../../app/store/harnessStore";
import { type HarnessReadiness } from "../../lib/ipc/harnessClient";
import { revealErrorLog } from "../../lib/diagnostics/errorReporter";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { ResetDataSection } from "./ResetDataSection";

/** bob's `readiness().details` payload (a JSON object on the wire). Read for the
 * Node.js diagnostics the About pane surfaces ("Runtime: Node …"). */
interface BobReadinessDetails {
  node?: { version?: string | null };
}

/** Narrow a readiness's opaque `details` to bob's node diagnostics. */
function bobNodeVersion(readiness: HarnessReadiness | null): string | null {
  const details = readiness?.details as BobReadinessDetails | null | undefined;
  return details?.node?.version ?? null;
}

/** The "About" settings pane: version, blurb, and the local error-log shortcut. */
export function AboutSettings() {
  const selectedHarnessReadiness = useHarnessStore((state) => state.selectedHarnessReadiness);

  return (
    <>
      <div className="settings-section">
        <h3>About Compose</h3>
        <p className="settings-helper">Compose · version 0.1.0</p>
        <p className="settings-helper">
          A local-first AI writing workspace — your notes stay on your computer. AI for everyone.
        </p>
        {bobNodeVersion(selectedHarnessReadiness) ? (
          <p className="settings-helper">
            Runtime: Node.js {bobNodeVersion(selectedHarnessReadiness)}
          </p>
        ) : null}
      </div>
      {isTauriRuntime() ? (
        <>
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
          <ResetDataSection />
        </>
      ) : null}
    </>
  );
}
