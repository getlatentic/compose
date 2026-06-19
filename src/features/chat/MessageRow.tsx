import { useState } from "react";
import { ChevronDown, Document } from "@carbon/react/icons";
import { Check, Copy, RefreshCw } from "lucide-react";

import type {
  ChatExcerptRef,
  WorkspaceChatMessage,
  WorkspaceRunStats,
} from "../../app/workspaceModel";
import { formatCoins, formatCompact } from "../../lib/format/numbers";
import { AgentTrace } from "./AgentTrace";
import { AppliedChanges } from "./AppliedChanges";
import { FileOpCard } from "./FileOpCard";
import { MarkdownMessage } from "./MarkdownMessage";
import { SuggestionList } from "./SuggestionList";
import { WorkingIndicator } from "./WorkingIndicator";
import { appliedChangeBasenames, fileOpsFromTrace } from "./traceFiles";

export interface MessageRowCallbacks {
  onAccept: (suggestionId: string) => void;
  onOpenDocument: (path: string) => void;
  onReject: (suggestionId: string) => void;
  /** Re-send the most recent user turn as a new run. Resolved in the store
   * (`regenerateLastTurn`). Per-message granularity isn't supported yet —
   * regenerate always re-runs the *last* user turn. */
  onRegenerate?: () => void;
}

/**
 * One chat message — single-column, no avatars, no left/right split. Modern
 * chat (Claude, ChatGPT) doesn't paint a bot-avatar bubble next to a
 * speech-bubble: every turn just flows in document order. We do the same.
 *
 *  - **User turns** render as a bordered block (Carbon `--cds-layer-02`,
 *    1px subtle border, rounded). No "You" eyebrow — the contained surface
 *    is what marks the turn as yours.
 *  - **Assistant turns** render the answer as open prose (markdown from
 *    `attempt_completion`) with no avatar / "Assistant" label / read-pills.
 *    The pills moved to the trace ("Show work"), which is where the
 *    context belongs.
 *  - While a turn runs with no answer yet, a transient **status indicator**
 *    takes the slot ("Thinking…", "Reading file…").
 *  - Hover an assistant turn → a small action row appears below it: Copy,
 *    Regenerate, Show work, with usage stats on the trailing edge. The row
 *    is `opacity: 0` at rest and `1` on hover/focus, so the panel stays
 *    quiet but the actions are one move away.
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
  // When an applied-diff card (snapshot mode) already covers a file, it owns
  // the create-vs-edit headline — so suppress the redundant per-tool card for
  // that same file (otherwise an overwrite shows a "Created" card beside an
  // "Edited" diff). See `fileOpsFromTrace`.
  const coveredFiles = appliedChangeBasenames(message.appliedChanges);
  const fileOps = isAssistant ? fileOpsFromTrace(trace, coveredFiles) : [];
  const opRunning = fileOps.some((tool) => tool.status === "running");
  const statsLabel = message.stats ? formatStats(message.stats) : "";
  const showMeta = isFinal && (hasTrace || Boolean(statsLabel));
  const [traceOpen, setTraceOpen] = useState(false);
  // Brief "copied" flash on the Copy button so the user sees that the click
  // landed (clipboard writes are otherwise invisible). 1.4s mirrors the same
  // pattern in Claude / ChatGPT.
  const [justCopied, setJustCopied] = useState(false);

  const handleCopy = () => {
    if (!message.content) {
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(message.content).then(() => {
        setJustCopied(true);
        setTimeout(() => setJustCopied(false), 1400);
      });
    }
  };

  return (
    <article
      className={[
        "message-row",
        isAssistant ? "message-row--assistant" : "message-row--user",
      ].join(" ")}
    >
      {isAssistant && message.activity ? (
        <div className="message-activity">{message.activity}</div>
      ) : null}

      {fileOps.length ? (
        <div className="message-fileops">
          {fileOps.map((tool) => (
            <FileOpCard key={tool.id} tool={tool} />
          ))}
        </div>
      ) : null}

      {message.content ? (
        isAssistant ? (
          <div className="message-body">
            <MarkdownMessage content={message.content} />
          </div>
        ) : message.excerpt ? (
          <div className="message-body message-body--user">
            <ExcerptChip excerpt={message.excerpt} />
          </div>
        ) : (
          <div className="message-body message-body--user">{message.content}</div>
        )
      ) : message.streaming && !opRunning ? (
        // No answer yet — the working loader takes the slot, unless a file-op
        // card is already running (its spinner IS the status). Replaced by the
        // answer when it lands.
        <WorkingIndicator trace={trace} />
      ) : null}

      {message.suggestions?.length ? (
        <SuggestionList
          suggestions={message.suggestions}
          onAccept={callbacks.onAccept}
          onOpenDocument={callbacks.onOpenDocument}
          onReject={callbacks.onReject}
        />
      ) : null}

      {message.appliedChanges?.length ? (
        <AppliedChanges
          changes={message.appliedChanges}
          onOpenDocument={callbacks.onOpenDocument}
        />
      ) : null}

      {showMeta && isAssistant ? (
        <div className="message-actions" data-hover-reveal>
          <div className="message-actions__left">
            {message.content ? (
              <button
                type="button"
                className="message-actions__btn"
                onClick={handleCopy}
                aria-label={justCopied ? "Copied" : "Copy message"}
                title={justCopied ? "Copied" : "Copy"}
              >
                {justCopied ? (
                  <Check size={14} aria-hidden />
                ) : (
                  <Copy size={14} aria-hidden />
                )}
              </button>
            ) : null}
            {callbacks.onRegenerate ? (
              <button
                type="button"
                className="message-actions__btn"
                onClick={() => callbacks.onRegenerate?.()}
                aria-label="Regenerate response"
                title="Regenerate"
              >
                <RefreshCw size={14} aria-hidden />
              </button>
            ) : null}
            {hasTrace ? (
              <button
                type="button"
                className="message-trace__toggle"
                aria-expanded={traceOpen}
                onClick={() => setTraceOpen((open) => !open)}
              >
                <ChevronDown size={14} className="message-trace__chevron" aria-hidden />
                <span>{traceOpen ? "Hide work" : "Show work"}</span>
              </button>
            ) : null}
          </div>
          {statsLabel ? <span className="message-stats">{statsLabel}</span> : null}
        </div>
      ) : null}

      {showMeta && hasTrace && traceOpen ? <AgentTrace trace={trace ?? []} /> : null}
    </article>
  );
}

/** A commented passage sent to chat — file + line:col + the excerpt + the note. */
function ExcerptChip({ excerpt }: { excerpt: ChatExcerptRef }) {
  return (
    <div className="excerpt-chip">
      <div className="excerpt-chip__head">
        <Document size={14} aria-hidden />
        <span className="excerpt-chip__file">{excerpt.filePath}</span>
        <span className="excerpt-chip__loc">
          L{excerpt.line}:C{excerpt.column}
        </span>
      </div>
      <blockquote className="excerpt-chip__text">{excerpt.text}</blockquote>
      {excerpt.note ? <p className="excerpt-chip__note">{excerpt.note}</p> : null}
    </div>
  );
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
