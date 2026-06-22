import { useEffect, useState } from "react";
import { InlineNotification, SkeletonText, Tag, Toggle } from "@carbon/react";
import { Add, ChevronRight } from "@carbon/react/icons";

import { useHarnessStore } from "../../app/store/harnessStore";
import {
  harnessDiscover,
  harnessList,
  type HarnessInfo,
  type HarnessReadiness,
} from "../../lib/ipc/harnessClient";
import { agentStatus, statusTagType } from "./agentStatus";

interface AgentRow {
  info: HarnessInfo;
  readiness: HarnessReadiness | null;
}

// Cached across mounts so returning from a detail screen renders the list
// instantly instead of re-flashing skeletons; the probe still refreshes it.
let cachedRows: AgentRow[] = [];

/** Recommended default, in catalog order: the first ready, else the first
 *  installed, else the first registered. */
function suggestedDefaultId(rows: AgentRow[]): string | null {
  return (
    rows.find((row) => row.readiness?.ready)?.info.id ??
    rows.find((row) => row.readiness?.installed)?.info.id ??
    rows[0]?.info.id ??
    null
  );
}

/**
 * The registry of AI agents. Lists every registered agent with its
 * capability-accurate {@link agentStatus} and marks the current default;
 * clicking a row opens its setup/detail screen — it does not switch the active
 * agent, which is the chat footer's job. "Add agent" registers a custom ACP /
 * OpenAI-compatible endpoint.
 */
export function AgentList({
  onOpenAgent,
  onAddAgent,
}: {
  onOpenAgent: (id: string) => void;
  onAddAgent: () => void;
}) {
  const selectedHarnessId = useHarnessStore((state) => state.selectedHarnessId);
  const selectedHarnessReadiness = useHarnessStore((state) => state.selectedHarnessReadiness);
  const allowEdits = useHarnessStore((state) => state.allowEdits);
  const setAllowEdits = useHarnessStore((state) => state.setAllowEdits);

  const [rows, setRows] = useState<AgentRow[]>(cachedRows);
  const [loading, setLoading] = useState(cachedRows.length === 0);
  const [error, setError] = useState<string | null>(null);

  // Probe on mount, then re-probe quietly when the active agent's readiness
  // changes (e.g. a key saved in a detail screen), so a status flips on return
  // to the list. Seeds from the cross-mount cache, so only the first-ever open
  // shows skeletons.
  useEffect(() => {
    let active = true;
    async function refresh() {
      setError(null);
      try {
        const [list, discovered] = await Promise.all([harnessList(), harnessDiscover()]);
        if (!active) return;
        cachedRows = list.map((info) => ({
          info,
          readiness: discovered.find((readiness) => readiness.harnessId === info.id) ?? null,
        }));
        setRows(cachedRows);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load AI agents");
      } finally {
        if (active) setLoading(false);
      }
    }
    void refresh();
    return () => {
      active = false;
    };
  }, [selectedHarnessReadiness]);

  const suggestedId = suggestedDefaultId(rows);

  return (
    <div className="settings-section">
      <p className="settings-helper">
        {loading
          ? "Checking your computer for AI agents you already have…"
          : "Your AI agents. Open one to set it up or configure it; pick which to use from the chat footer."}
      </p>

      {loading ? (
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
          {rows.map(({ info, readiness }) => {
            const status = agentStatus(info, readiness);
            const isDefault = info.id === selectedHarnessId;
            return (
              <li key={info.id}>
                <button
                  type="button"
                  className="agent-row"
                  onClick={() => onOpenAgent(info.id)}
                >
                  <span className="agent-row__body">
                    <span className="agent-row__head">
                      <strong>{info.displayName}</strong>
                      {isDefault ? (
                        <Tag size="sm" type="blue">
                          Default
                        </Tag>
                      ) : info.id === suggestedId ? (
                        <Tag size="sm" type="outline">
                          Recommended
                        </Tag>
                      ) : null}
                      <Tag size="sm" type={statusTagType(status.tone)}>
                        {status.label}
                      </Tag>
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

      {error ? (
        <InlineNotification hideCloseButton kind="error" lowContrast subtitle={error} title="AI setup" />
      ) : null}

      {/* The single edit-permission toggle. Workspace-scoped, so it sits with the
          list rather than any one agent's detail. */}
      <div style={{ marginBlockStart: "0.75rem" }}>
        <Toggle
          id="agents-allow-edits"
          size="sm"
          labelText="Let the AI edit files in this folder"
          labelA="Read & suggest only"
          labelB="Can edit my files"
          toggled={allowEdits}
          onToggle={(checked) => setAllowEdits(checked)}
        />
        <p className="settings-helper">
          Only in your workspace folder — never anywhere else on your computer.
        </p>
      </div>
    </div>
  );
}
