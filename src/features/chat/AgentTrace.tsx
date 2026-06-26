import { CheckmarkFilled, ErrorFilled, InProgress } from "@carbon/react/icons";

import type { TraceEntry, WorkspaceToolCall } from "../../app/workspaceModel";
import { MarkdownMessage } from "./MarkdownMessage";
import { toolName } from "./toolLabels";

/** One icon per tool-call status. */
const STATUS_ICON = {
  running: InProgress,
  done: CheckmarkFilled,
  error: ErrorFilled,
} as const;

/**
 * What the assistant did to reach its answer, shown on demand behind the
 * "Show work" toggle: an ordered timeline of its thinking, the steps it
 * narrated, and the actions it took — interleaved exactly as they
 * happened. Thinking is a collapsed accordion so a long chain doesn't
 * bury the rest; actions expand to their detail. Written for a
 * non-technical reader (no session ids, no raw tool names).
 */
export function AgentTrace({ trace }: { trace: TraceEntry[] }) {
  return (
    <div className="agent-trace">
      <ol className="trace-timeline">
        {trace.map((entry, index) => (
          <li className="trace-step" key={index}>
            <TraceStep entry={entry} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function TraceStep({ entry }: { entry: TraceEntry }) {
  if (entry.kind === "thinking") {
    return (
      <details className="trace-thinking">
        <summary className="trace-thinking__summary">Thought it through</summary>
        {/* bob streams its reasoning as markdown — bullets, **bold**,
            `code spans` — so render it through the same pipeline as the
            final answer instead of dumping the raw source. */}
        <div className="trace-thinking__body">
          <MarkdownMessage content={entry.text} />
        </div>
      </details>
    );
  }
  if (entry.kind === "notice") {
    return <div className="trace-notice">{entry.text}</div>;
  }
  return <TraceTool tool={entry.tool} />;
}

function TraceTool({ tool }: { tool: WorkspaceToolCall }) {
  const Icon = STATUS_ICON[tool.status];
  const head = (
    <span className="trace-tool__head">
      <Icon size={14} className="trace-tool__icon" aria-hidden />
      <span className="trace-tool__name">{toolName(tool.name)}</span>
    </span>
  );
  // A bare head when there's nothing to expand; otherwise an accordion so
  // the input/output stays collapsed until asked for.
  if (!tool.input && !tool.output) {
    return <div className={`trace-tool trace-tool--${tool.status}`}>{head}</div>;
  }
  return (
    <details className={`trace-tool trace-tool--${tool.status}`}>
      <summary className="trace-tool__summary">{head}</summary>
      {tool.input ? <pre className="trace-tool__io">{tool.input}</pre> : null}
      {tool.output ? (
        <pre className="trace-tool__io trace-tool__io--out">{tool.output}</pre>
      ) : null}
    </details>
  );
}
