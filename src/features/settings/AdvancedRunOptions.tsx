import { Select, SelectItem } from "@carbon/react";

import {
  harnessCapabilitiesOf,
  supportsPermissionMode,
  type HarnessRunOptions,
} from "../../app/workspaceStore";
import { useHarnessStore } from "../../app/store/harnessStore";
import type { HarnessInfo } from "../../lib/ipc/harnessClient";

/** Reasoning-effort levels (Codex's `model_reasoning_effort`). Neutral presets —
 *  whether an agent honors them is decided by its `supportsEffort` capability. */
const EFFORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Default" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

/** Preset turn caps for Claude (`--max-turns`). */
const MAX_TURNS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Default (no cap)" },
  { value: "3", label: "3 turns" },
  { value: "5", label: "5 turns" },
  { value: "10", label: "10 turns" },
  { value: "20", label: "20 turns" },
];

/** Whether an agent exposes any advanced run-tuning knobs, so the detail screen
 *  can omit the whole "Advanced" section (not show an empty twisty) for agents
 *  that declare none. */
export function hasAdvancedRunOptions(catalog: HarnessInfo[], harnessId: string): boolean {
  const caps = harnessCapabilitiesOf(catalog, harnessId);
  return supportsPermissionMode(harnessId) || caps.supportsMaxTurns || caps.supportsEffort;
}

/**
 * The agent-specific run-tuning knobs (how-autonomous, max turns, reasoning
 * effort). Capability-driven: each field renders only when the agent honors it,
 * so a new agent needs no edits here. Rendered inside the detail's collapsible
 * "Advanced" section (the section itself is owned by {@link AgentDetail}); the
 * model is the main detail's {@link ModelPicker}, kept out front.
 */
export function AdvancedRunOptions({ harnessId }: { harnessId: string }) {
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const options =
    useHarnessStore((state) => state.harnessOptions[harnessId]) ?? ({} as HarnessRunOptions);
  const setHarnessOptions = useHarnessStore((state) => state.setHarnessOptions);
  const caps = harnessCapabilitiesOf(harnessCatalog, harnessId);

  return (
    <div className="agent-advanced">
      {supportsPermissionMode(harnessId) ? (
        <Select
          id={`${harnessId}-permission-mode`}
          labelText="How much it can do on its own"
          helperText="Default runs autonomously in your folder; every change is undoable from a file's “Previous versions”."
          value={options.permissionMode ?? ""}
          onChange={(event) =>
            setHarnessOptions(harnessId, { permissionMode: event.target.value || undefined })
          }
        >
          {/* Only headless-safe modes: "" (Compose's bypass default) and auto
              both run without an unanswerable prompt. acceptEdits/default
              would deadlock a headless run on the first Bash call. */}
          <SelectItem value="" text="Autonomous — no prompts (recommended)" />
          <SelectItem value="auto" text="Guarded — vet risky actions (Sonnet/Opus 4.6+)" />
        </Select>
      ) : null}

      {caps.supportsMaxTurns ? (
        <Select
          id={`${harnessId}-max-turns`}
          labelText="Max turns"
          helperText="Stop the agent after this many turns."
          value={options.maxTurns != null ? String(options.maxTurns) : ""}
          onChange={(event) =>
            setHarnessOptions(harnessId, {
              maxTurns: event.target.value ? Number(event.target.value) : undefined,
            })
          }
        >
          {MAX_TURNS_OPTIONS.map((turns) => (
            <SelectItem key={turns.value} value={turns.value} text={turns.label} />
          ))}
        </Select>
      ) : null}

      {caps.supportsEffort ? (
        <Select
          id={`${harnessId}-effort`}
          labelText="Reasoning effort"
          helperText="How hard the model thinks before acting."
          value={options.effort ?? ""}
          onChange={(event) =>
            setHarnessOptions(harnessId, {
              effort: (event.target.value || undefined) as HarnessRunOptions["effort"],
            })
          }
        >
          {EFFORT_OPTIONS.map((effort) => (
            <SelectItem key={effort.value} value={effort.value} text={effort.label} />
          ))}
        </Select>
      ) : null}
    </div>
  );
}
