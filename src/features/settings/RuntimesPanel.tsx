import { useEffect, useState } from "react";
import { Button, SkeletonText } from "@carbon/react";

import { useHarnessStore } from "../../app/store/harnessStore";
import { harnessReadiness, type HarnessReadiness } from "../../lib/ipc/harnessClient";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { RuntimeRow } from "./RuntimeRow";

// Per-agent readiness, cached across mounts (like AgentList) so reopening the
// panel shows last-known runtimes instantly while a background re-probe refreshes.
let cachedReadiness: Record<string, HarnessReadiness | null> = {};

/**
 * The "Runtimes" panel: a cross-agent view of which binary each agent CLI
 * resolves to, its version, install kind, and whether it's current — with an
 * Update / Reinstall action. Distinct from "AI agents" (per-agent setup +
 * model/run config): this is the runtime-management surface (what's installed,
 * is it the self-updating native build, where does it live), the legible +
 * fixable view that keeps a stale npm copy from silently breaking a run.
 */
export function RuntimesPanel() {
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const loadHarnessCatalog = useHarnessStore((state) => state.loadHarnessCatalog);
  const [readiness, setReadiness] = useState<Record<string, HarnessReadiness | null>>(cachedReadiness);

  useEffect(() => {
    void loadHarnessCatalog();
  }, [loadHarnessCatalog]);

  // Probe each agent's readiness in parallel (capped), updating its row as the
  // probe resolves — the same worker-pool shape as AgentList, so a large registry
  // never fires dozens of `<cli> --version` subprocesses at once.
  useEffect(() => {
    let active = true;
    const ids = harnessCatalog.map((info) => info.id);
    let next = 0;
    const PROBE_LIMIT = 4;
    async function worker() {
      while (active && next < ids.length) {
        const id = ids[next++];
        const result = await harnessReadiness(id).catch(() => null);
        if (!active) return;
        cachedReadiness = { ...cachedReadiness, [id]: result };
        setReadiness((prev) => ({ ...prev, [id]: result }));
      }
    }
    for (let i = 0; i < Math.min(PROBE_LIMIT, ids.length); i++) {
      void worker();
    }
    return () => {
      active = false;
    };
  }, [harnessCatalog]);

  function applyReadiness(id: string, next: HarnessReadiness | null) {
    cachedReadiness = { ...cachedReadiness, [id]: next };
    setReadiness((prev) => ({ ...prev, [id]: next }));
  }

  async function recheckAll() {
    cachedReadiness = {};
    setReadiness({});
    await Promise.all(
      harnessCatalog.map(async (info) => {
        const result = await harnessReadiness(info.id).catch(() => null);
        applyReadiness(info.id, result);
      }),
    );
  }

  if (!isTauriRuntime()) {
    return (
      <div className="settings-section">
        <p className="settings-helper">Runtime management runs in the Compose desktop app.</p>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <p className="settings-helper">
        The CLI each agent runs — its version and where it’s installed. Prefer the native, self-updating
        build; update one here if it can go stale.
      </p>

      {harnessCatalog.length === 0 ? (
        <ul className="runtime-list" aria-hidden>
          {[0, 1, 2].map((i) => (
            <li key={i} className="runtime-row runtime-row--skeleton">
              <SkeletonText heading width="35%" />
              <SkeletonText width="60%" />
            </li>
          ))}
        </ul>
      ) : (
        <>
          <ul className="runtime-list">
            {harnessCatalog.map((info) => (
              <RuntimeRow
                key={info.id}
                info={info}
                readiness={readiness[info.id] ?? null}
                checking={!(info.id in readiness)}
                onReadiness={(next) => applyReadiness(info.id, next)}
              />
            ))}
          </ul>
          <div className="settings-actions">
            <Button size="sm" kind="ghost" onClick={() => void recheckAll()}>
              Re-check all
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
