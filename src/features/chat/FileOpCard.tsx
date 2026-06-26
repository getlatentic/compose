import { CheckmarkFilled, ErrorFilled, InProgress } from "@carbon/react/icons";

import type { WorkspaceToolCall } from "../../app/workspaceModel";
import { fileOpVerb, toolFile } from "./toolLabels";

/** One status → one icon. A spinning `InProgress` while it runs, a green
 * check when done, a red error glyph if it failed. */
const STATUS_ICON = {
  running: InProgress,
  done: CheckmarkFilled,
  error: ErrorFilled,
} as const;

const STATUS_SUBTITLE = {
  running: "Working on it — it'll appear in your files when ready.",
  done: "Saved to your workspace.",
  error: "This change didn't go through.",
} as const;

/**
 * A prominent card for a file the assistant created or edited — the chat's
 * way of saying "I'm changing your workspace", surfaced in the message flow
 * rather than hidden in the agent trace. Its status tracks the underlying
 * tool call live: spinner while running, check when saved, error on failure.
 */
export function FileOpCard({ tool }: { tool: WorkspaceToolCall }) {
  const Icon = STATUS_ICON[tool.status];
  // `fileOpsFromTrace` only yields write/edit kinds, so `kind` is set here;
  // the `?? "edit"` is a type-level fallback for the optional field.
  const verb = fileOpVerb(tool.kind ?? "edit", tool.status);
  const file = toolFile(tool.input);

  return (
    <div className={`fileop fileop--${tool.status}`}>
      <Icon size={16} className="fileop__icon" aria-hidden />
      <span className="fileop__body">
        <span className="fileop__title">
          {verb}
          {file ? (
            <>
              {" "}
              <code className="fileop__file">{file}</code>
            </>
          ) : (
            " a file"
          )}
        </span>
        <span className="fileop__sub">{STATUS_SUBTITLE[tool.status]}</span>
      </span>
    </div>
  );
}
