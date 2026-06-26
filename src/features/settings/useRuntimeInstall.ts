import { useState } from "react";

import {
  harnessInstall,
  harnessReadiness,
  type HarnessInstallEvent,
  type HarnessReadiness,
} from "../../lib/ipc/harnessClient";
import type { InstallLogEntry } from "./agentConfigControls";

/**
 * Drive a runtime Update / Reinstall for one agent from the Runtimes panel:
 * stream the install (the same `harness_install` path the detail screen uses —
 * the claude adapter migrates an npm copy to the native build or bootstraps the
 * native installer), collect its log, and report the refreshed readiness so the
 * row's version + install-kind badge update in place. Scoped to one `harnessId`.
 */
export function useRuntimeInstall(
  harnessId: string,
  onReadiness: (readiness: HarnessReadiness | null) => void,
) {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<InstallLogEntry[]>([]);
  const [result, setResult] = useState<Extract<HarnessInstallEvent, { kind: "done" }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setLog([]);
    setResult(null);
    setError(null);
    try {
      for await (const event of harnessInstall(harnessId)) {
        setLog((prev) => [...prev, { kind: event.kind, text: "text" in event ? event.text : "" }]);
        if (event.kind === "done") {
          setResult(event);
          onReadiness(await harnessReadiness(harnessId).catch(() => null));
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed");
    } finally {
      setRunning(false);
    }
  }

  return { running, log, result, error, run };
}
