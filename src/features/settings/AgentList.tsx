import { useEffect, useState } from "react";
import { SkeletonText, Tag } from "@carbon/react";
import { Add, ChevronRight } from "@carbon/react/icons";

import { useHarnessStore } from "../../app/store/harnessStore";
import { harnessReadiness, type HarnessReadiness } from "../../lib/ipc/harnessClient";
import { agentStatus } from "./agentStatus";

// Per-agent readiness, cached across mounts so returning from a detail screen
// shows last-known statuses instantly while a background re-probe refreshes them.
let cachedReadiness: Record<string, HarnessReadiness | null> = {};

/**
 * The registry of AI agents — a list of uniform navigation rows (name + chevron)
 * that open each agent's detail. The catalog (names) comes from the store and
 * renders immediately; each agent's readiness is then probed *in parallel*
 * (`harness_readiness` per id) so the list never blocks on the serial discover.
 * A row carries only identity/attention pills: a "Default" tag for the current
 * default agent, and "Add a key" when an agent still needs one — readiness
 * otherwise stays out of the way until you open the agent. Setting the default
 * happens in the agent's detail, so a row only ever navigates.
 */
export function AgentList({
  onOpenAgent,
  onAddAgent,
}: {
  onOpenAgent: (id: string) => void;
  onAddAgent: () => void;
}) {
  const selectedHarnessId = useHarnessStore((state) => state.selectedHarnessId);
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const loadHarnessCatalog = useHarnessStore((state) => state.loadHarnessCatalog);
  const [readiness, setReadiness] = useState<Record<string, HarnessReadiness | null>>(cachedReadiness);

  // Keep the catalog fresh (cheap — static info, no probes) and re-probe each
  // agent's readiness in parallel, updating its row as the probe resolves.
  useEffect(() => {
    void loadHarnessCatalog();
  }, [loadHarnessCatalog]);

  useEffect(() => {
    let active = true;
    const ids = harnessCatalog.map((info) => info.id);
    let next = 0;
    // A small worker pool: at most PROBE_LIMIT readiness probes run at once
    // (each spawns a `<cli> --version` / Ollama ping), so a large registry
    // doesn't fire dozens of subprocesses simultaneously. Rows still update
    // independently as each probe resolves.
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

  return (
    <div className="settings-section">
      <p className="settings-helper">
        Your AI agents. Open one to set it up or change its model. The one marked Default runs new
        chats unless you switch it from the chat footer.
      </p>

      {harnessCatalog.length === 0 ? (
        <ul className="agent-list" aria-hidden>
          {[0, 1, 2].map((i) => (
            <li key={i} className="agent-row agent-row--skeleton">
              <SkeletonText width="35%" />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="agent-list">
          {harnessCatalog.map((info) => {
            const status = info.id in readiness ? agentStatus(info, readiness[info.id]) : null;
            const needsKey = status?.action === "addKey";
            const isDefault = info.id === selectedHarnessId;
            return (
              <li key={info.id}>
                <button
                  type="button"
                  className="agent-row agent-row--nav"
                  onClick={() => onOpenAgent(info.id)}
                >
                  <span className="agent-row__name">{info.displayName}</span>
                  {isDefault ? (
                    <Tag size="sm" type="blue">
                      Default
                    </Tag>
                  ) : null}
                  {needsKey ? (
                    <Tag size="sm" type="blue">
                      Add a key
                    </Tag>
                  ) : null}
                  <ChevronRight className="agent-row__chevron" aria-hidden />
                </button>
              </li>
            );
          })}
          <li>
            <button type="button" className="agent-row agent-row--add" onClick={onAddAgent}>
              <Add aria-hidden />
              <span>Add an agent…</span>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
