import { useState } from "react";
import { ChevronDown, Document } from "@carbon/react/icons";

import type {
  ChatExcerptRef,
  TraceEntry,
  WorkspaceChatMessage,
  WorkspaceRunStats,
} from "../../app/workspaceModel";
import { formatCoins, formatCompact } from "../../lib/format/numbers";
import { AgentTrace } from "./AgentTrace";
import { FileOpCard } from "./FileOpCard";
import { MarkdownMessage } from "./MarkdownMessage";
import { MessageAuthor } from "./MessageAuthor";
import { SuggestionList } from "./SuggestionList";
import { toolActionLabel } from "./toolLabels";
import { fileOpsFromTrace } from "./traceFiles";
import { useDwellValue } from "./useDwellValue";

export interface MessageRowCallbacks {
  onAccept: (suggestionId: string) => void;
  onOpenDocument: (path: string) => void;
  onReject: (suggestionId: string) => void;
}

/**
 * One chat message across three surfaces:
 *  - the **bubble** is only the answer (assistant: markdown from
 *    `attempt_completion`; user: the plain text they typed);
 *  - while a turn runs with no answer yet, a transient **status
 *    indicator** (styled unlike the bubble) takes the slot, derived from
 *    the trace's latest step ("Thinking…", the live narration, "Reading
 *    file…"); and
 *  - the agent's process (session + the ordered reasoning / narration /
 *    tool timeline) lives behind the **"Agent trace"** toggle, with usage
 *    stats floated beside it.
 */
export function MessageRow({
  callbacks,
  message,
}: {
  callbacks: MessageRowCallbacks;
  message: WorkspaceChatMessage;
}) {
  const isAssistant = message.role === "assistant";
  const trace = message.trace;
  // The agent trace + stats appear only once the answer is final (the
  // answer landed, or the run ended) — never while it's still working.
  const isFinal = Boolean(message.content) || !message.streaming;
  const hasTrace = isAssistant && Boolean(trace?.length);
  // File create/edit ops surface as prominent cards. A running op's spinner
  // is itself the live status, so it suppresses the generic status line.
  const fileOps = isAssistant ? fileOpsFromTrace(trace) : [];
  const opRunning = fileOps.some((tool) => tool.status === "running");
  const statsLabel = message.stats ? formatStats(message.stats) : "";
  const showMeta = isFinal && (hasTrace || Boolean(statsLabel));
  const [traceOpen, setTraceOpen] = useState(false);

  return (
    <article
      className={[
        "bob-message-row",
        isAssistant ? "bob-message-row--assistant" : "bob-message-row--user",
      ].join(" ")}
    >
      {isAssistant ? <MessageAuthor trace={trace} /> : null}

      {isAssistant && message.activity ? (
        <div className="bob-message-activity">{message.activity}</div>
      ) : null}

      {fileOps.length ? (
        <div className="bob-message-fileops">
          {fileOps.map((tool) => (
            <FileOpCard key={tool.id} tool={tool} />
          ))}
        </div>
      ) : null}

      {message.content ? (
        isAssistant ? (
          <div className="bob-message-bubble">
            <MarkdownMessage content={message.content} />
          </div>
        ) : message.excerpt ? (
          <div className="bob-message-bubble bob-message-bubble--plain">
            <ExcerptChip excerpt={message.excerpt} />
          </div>
        ) : (
          <div className="bob-message-bubble bob-message-bubble--plain">{message.content}</div>
        )
      ) : message.streaming && !opRunning ? (
        // No answer yet — the transient status (derived from the trace) takes
        // the slot, unless a file-op card is already running (its spinner IS
        // the status). Replaced by the answer when it lands.
        <StatusIndicator trace={trace} />
      ) : null}

      {message.suggestions?.length ? (
        <SuggestionList
          suggestions={message.suggestions}
          onAccept={callbacks.onAccept}
          onOpenDocument={callbacks.onOpenDocument}
          onReject={callbacks.onReject}
        />
      ) : null}

      {showMeta ? (
        <div className="bob-message-meta">
          {hasTrace ? (
            <button
              type="button"
              className="bob-message-trace__toggle"
              aria-expanded={traceOpen}
              onClick={() => setTraceOpen((open) => !open)}
            >
              <ChevronDown size={14} className="bob-message-trace__chevron" aria-hidden />
              <span>{traceOpen ? "Hide work" : "Show work"}</span>
            </button>
          ) : (
            <span />
          )}
          {statsLabel ? <span className="bob-message-stats">{statsLabel}</span> : null}
        </div>
      ) : null}

      {showMeta && hasTrace && traceOpen ? <AgentTrace trace={trace ?? []} /> : null}
    </article>
  );
}

/** A commented passage sent to chat — file + line:col + the excerpt + the note. */
function ExcerptChip({ excerpt }: { excerpt: ChatExcerptRef }) {
  return (
    <div className="bob-excerpt-chip">
      <div className="bob-excerpt-chip__head">
        <Document size={14} aria-hidden />
        <span className="bob-excerpt-chip__file">{excerpt.filePath}</span>
        <span className="bob-excerpt-chip__loc">
          L{excerpt.line}:C{excerpt.column}
        </span>
      </div>
      <blockquote className="bob-excerpt-chip__text">{excerpt.text}</blockquote>
      {excerpt.note ? <p className="bob-excerpt-chip__note">{excerpt.note}</p> : null}
    </div>
  );
}

/**
 * The transient "what I'm doing" line shown in place of the bubble while
 * a turn runs. Its text is derived from the trace (see `liveStatus`) and
 * then run through `useDwellValue` so a fast-streaming run can't flip it
 * before it's been read — each status holds for at least STATUS_DWELL_MS.
 */
const STATUS_DWELL_MS = 450;

function StatusIndicator({ trace }: { trace: TraceEntry[] | undefined }) {
  const status = useDwellValue(liveStatus(trace), STATUS_DWELL_MS);
  return (
    <div className="bob-message-status" aria-live="polite">
      <span className="bob-message-status__dot" aria-hidden />
      <span>{status}</span>
    </div>
  );
}

/**
 * The live status text from the trace's latest *meaningful* step:
 *  - a thinking step → "Thinking…" (we never show the reasoning text);
 *  - a tool step → its action label ("Reading Notes.md…");
 *  - a notice step → its text, but only if non-blank (bob emits a
 *    whitespace-only message after a tool — that must not blank the line;
 *    we fall through to the previous meaningful step instead).
 * "Getting started…" only before the first such step.
 */
function liveStatus(trace: TraceEntry[] | undefined): string {
  for (let i = (trace?.length ?? 0) - 1; i >= 0; i -= 1) {
    const entry = trace![i];
    if (entry.kind === "thinking") {
      return "Thinking…";
    }
    if (entry.kind === "tool") {
      return `${toolActionLabel(entry.tool.name, entry.tool.input)}…`;
    }
    // notice: skip whitespace-only entries (keep looking back).
    if (entry.text.trim()) {
      return entry.text.trim();
    }
  }
  return "Getting started…";
}

/** "25.7k tokens · 0.05 coins" — compact + human-readable, only the
 * parts present. No tool count (the steps are visible in the trace). */
function formatStats(stats: WorkspaceRunStats): string {
  const parts: string[] = [];
  if (stats.totalTokens != null) {
    parts.push(`${formatCompact(stats.totalTokens)} tokens`);
  }
  if (stats.coins != null) {
    parts.push(`${formatCoins(stats.coins)} coins`);
  }
  return parts.join(" · ");
}
