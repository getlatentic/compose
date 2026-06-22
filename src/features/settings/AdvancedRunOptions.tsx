import { Accordion, AccordionItem, Select, SelectItem } from "@carbon/react";

import {
  harnessCapabilitiesOf,
  supportsPermissionMode,
  type HarnessRunOptions,
} from "../../app/workspaceStore";
import { useHarnessStore } from "../../app/store/harnessStore";

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

/**
 * The collapsed "Advanced" run-tuning knobs (how-autonomous, max turns, reasoning
 * effort) for one agent. Capability-driven, so it renders nothing — not an empty
 * twisty — when the agent declares none, and a new agent needs no edits here. The
 * model itself is the main detail's {@link ModelPicker}; only these power-user
 * knobs live behind the accordion.
 */
export function AdvancedRunOptions({ harnessId }: { harnessId: string }) {
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const options =
    useHarnessStore((state) => state.harnessOptions[harnessId]) ?? ({} as HarnessRunOptions);
  const setHarnessOptions = useHarnessStore((state) => state.setHarnessOptions);
  const caps = harnessCapabilitiesOf(harnessCatalog, harnessId);

  if (!supportsPermissionMode(harnessId) && !caps.supportsMaxTurns && !caps.supportsEffort) {
    return null;
  }

  return (
    <div className="settings-section">
      <Accordion>
        <AccordionItem title="Advanced">
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
        </AccordionItem>
      </Accordion>
    </div>
  );
}
