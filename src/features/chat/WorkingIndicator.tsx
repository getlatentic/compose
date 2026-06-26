import { useEffect, useMemo, useRef, useState } from "react";
import type { TraceEntry } from "../../app/workspaceModel";
import { toolActionLabel } from "./toolLabels";

/** Verbs cycled while the assistant works and there's no more specific step to
 * show — playful but on-brand for a writing app, à la Claude Code. */
const VERBS = [
  "Composing",
  "Thinking",
  "Pondering",
  "Drafting",
  "Considering",
  "Musing",
  "Reflecting",
  "Brewing",
  "Conjuring",
  "Percolating",
  "Noodling",
  "Wordsmithing",
];

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TICK_MS = 100;
const VERB_TICKS = 24; // ~2.4s per verb
const SECOND_TICKS = 10; // 1s

/**
 * The general "Compose is working" loader, shown from the moment a turn is sent
 * until the answer starts landing. A spinner + an elapsed timer + a label that
 * is the assistant's current concrete step ("Reading Notes.md…") when the trace
 * has one, otherwise a gently-cycling verb so the wait never feels stalled.
 */
export function WorkingIndicator({ trace }: { trace?: TraceEntry[] }) {
  const [tick, setTick] = useState(0);
  // A per-mount offset so two indicators on screen aren't lock-step and the
  // first verb varies between turns.
  const offset = useRef(Math.floor(Math.random() * VERBS.length));
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const specific = useMemo(() => specificStatus(trace), [trace]);
  const verb = VERBS[(offset.current + Math.floor(tick / VERB_TICKS)) % VERBS.length];
  const label = specific ?? `${verb}…`;
  const seconds = Math.floor(tick / SECOND_TICKS);
  const glyph = SPINNER[tick % SPINNER.length];

  return (
    <div className="working-indicator">
      <span className="working-indicator__spinner" aria-hidden>
        {glyph}
      </span>
      <span className="working-indicator__label" aria-live="polite">
        {label}
      </span>
      {seconds >= 1 ? (
        <span className="working-indicator__elapsed" aria-hidden>
          {seconds}s
        </span>
      ) : null}
    </div>
  );
}

/**
 * The assistant's current concrete step from the trace — a tool action or a
 * non-blank notice — or null when there's nothing specific yet (so the caller
 * falls back to a cycling verb). Thinking steps count as "nothing specific":
 * the verb reads livelier than a bare "Thinking…".
 */
function specificStatus(trace: TraceEntry[] | undefined): string | null {
  for (let i = (trace?.length ?? 0) - 1; i >= 0; i -= 1) {
    const entry = trace![i];
    if (entry.kind === "tool") {
      return `${toolActionLabel(entry.tool.name, entry.tool.input)}…`;
    }
    if (entry.kind === "thinking") {
      return null;
    }
    if (entry.text.trim()) {
      return entry.text.trim();
    }
  }
  return null;
}
