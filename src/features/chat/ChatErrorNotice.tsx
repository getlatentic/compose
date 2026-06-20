import { useState } from "react";

import { friendlyHarnessError } from "./harnessErrorMessage";

/**
 * The composer's compact error banner: a one-line friendly summary on a
 * light-red strip, with `Retry` and a `Details` toggle that reveals the raw
 * technical text (collapsed by default) in a small scrollable monospace block.
 * Used for both a not-ready harness and a post-send run error — the raw text is
 * mapped to a short summary by {@link friendlyHarnessError}.
 */
export function ChatErrorNotice({
  raw,
  harnessName,
  onRetry,
  onOpenSettings,
}: {
  raw: string;
  harnessName: string;
  /** Re-probe readiness (and let the user resend). Omitted → no Retry button. */
  onRetry?: () => void;
  /** Open Settings to fix setup (the not-ready case). Omitted → no Set-up link. */
  onOpenSettings?: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const { summary, detail } = friendlyHarnessError(raw, harnessName);

  return (
    <div className="chat-notice chat-notice--error" role="alert">
      <div className="chat-notice__row">
        <span className="chat-notice__dot" aria-hidden />
        <span className="chat-notice__text">{summary}</span>
        <div className="chat-notice__actions">
          {onRetry ? (
            <button type="button" className="chat-notice__action" onClick={onRetry}>
              Retry
            </button>
          ) : null}
          {onOpenSettings ? (
            <button type="button" className="chat-notice__action" onClick={onOpenSettings}>
              Set up
            </button>
          ) : null}
          {detail ? (
            <button
              type="button"
              className="chat-notice__action"
              aria-expanded={showDetail}
              onClick={() => setShowDetail((open) => !open)}
            >
              Details
            </button>
          ) : null}
        </div>
      </div>
      {showDetail && detail ? <pre className="chat-notice__detail">{detail}</pre> : null}
    </div>
  );
}
