import { useEffect, useState } from "react";
import { SkeletonText, Tag } from "@carbon/react";
import { Add, CheckmarkFilled, ChevronRight } from "@carbon/react/icons";

import { useHarnessStore } from "../../app/store/harnessStore";
import { harnessReadiness, type HarnessReadiness } from "../../lib/ipc/harnessClient";
import { agentStatus, statusTagType } from "./agentStatus";

// Per-agent readiness, cached across mounts so returning from a detail screen
// shows last-known statuses instantly while a background re-probe refreshes them.
let cachedReadiness: Record<string, HarnessReadiness | null> = {};

/**
 * The registry of AI agents. The catalog (names + descriptions) comes from the
 * store and renders immediately; each agent's readiness is then probed *in
 * parallel* (`harness_readiness` per id), so a row appears at once with a
 * "Checking…" status that resolves on its own — rather than blocking the whole
 * list on the serial `harness_discover` (one `<cli> --version` / Ollama ping per
 * agent, summed). Clicking a row opens its setup/detail; it does not switch the
 * active agent (the chat footer's job). A ready agent shows just a check; only a
 * state that needs action gets a labelled pill.
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
    harnessCatalog.forEach((info) => {
      harnessReadiness(info.id)
        .then((result) => {
          if (!active) return;
          cachedReadiness = { ...cachedReadiness, [info.id]: result };
          setReadiness((prev) => ({ ...prev, [info.id]: result }));
        })
        .catch(() => {
          if (!active) return;
          cachedReadiness = { ...cachedReadiness, [info.id]: null };
          setReadiness((prev) => ({ ...prev, [info.id]: null }));
        });
    });
    return () => {
      active = false;
    };
  }, [harnessCatalog]);

  return (
    <div className="settings-section">
      <p className="settings-helper">
        Your AI agents. Open one to set it up or configure it; pick which to use from the chat footer.
      </p>

      {harnessCatalog.length === 0 ? (
        <ul className="agent-list" aria-hidden>
          {[0, 1, 2].map((i) => (
            <li key={i} className="agent-row agent-row--skeleton">
              <SkeletonText heading width="35%" />
              <SkeletonText width="80%" />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="agent-list">
          {harnessCatalog.map((info) => {
            const checking = !(info.id in readiness);
            const status = checking ? null : agentStatus(info, readiness[info.id]);
            const isDefault = info.id === selectedHarnessId;
            return (
              <li key={info.id}>
                <button type="button" className="agent-row" onClick={() => onOpenAgent(info.id)}>
                  <span className="agent-row__body">
                    <span className="agent-row__head">
                      <strong>{info.displayName}</strong>
                      {isDefault ? (
                        <Tag size="sm" type="blue">
                          Default
                        </Tag>
                      ) : null}
                      {checking ? (
                        <span className="agent-row__checking">Checking…</span>
                      ) : status?.kind === "ready" ? (
                        <CheckmarkFilled className="agent-row__ready" aria-label="Ready" />
                      ) : status ? (
                        <Tag size="sm" type={statusTagType(status.tone)}>
                          {status.label}
                        </Tag>
                      ) : null}
                    </span>
                    <span className="agent-row__desc">{info.description}</span>
                  </span>
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
