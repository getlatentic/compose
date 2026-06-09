import { ChatBot, View } from "@carbon/react/icons";

import type { TraceEntry } from "../../app/workspaceModel";
import { readFilesFromTrace } from "./traceFiles";

/** Beyond this many read pills, collapse the rest into a "+N" count so the
 * header can't wrap into a wall of chips. */
const MAX_READ_PILLS = 3;

/**
 * The header above an assistant turn: a small assistant mark + "Assistant",
 * then a compact pill per file the turn read. The read pills make the
 * answer's *context* legible at a glance ("this came from Q3 field
 * notes.md") without opening the agent trace. Files the turn *changed* are
 * shown separately as file-op cards (they're actions, not context).
 */
export function MessageAuthor({ trace }: { trace: TraceEntry[] | undefined }) {
  const reads = readFilesFromTrace(trace);
  const shown = reads.slice(0, MAX_READ_PILLS);
  const overflow = reads.length - shown.length;

  return (
    <div className="bob-message-author">
      <span className="bob-message-author__mark" aria-hidden>
        <ChatBot size={12} />
      </span>
      <span className="bob-message-author__name">Assistant</span>
      {shown.map((file) => (
        <span className="bob-message-author__pill" key={file} title={`Read ${file}`}>
          <View size={11} aria-hidden />
          <span className="bob-message-author__pill-file">{file}</span>
        </span>
      ))}
      {overflow > 0 ? (
        <span className="bob-message-author__more" title={`Read ${reads.length} files`}>
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
