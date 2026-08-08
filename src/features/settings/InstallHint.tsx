import { Button } from "@carbon/react";
import { useCallback, useState } from "react";

import type { InstallHint } from "../../lib/ipc/harnessClient";

/**
 * What to show for an agent that isn't on this machine.
 *
 * Compose discovers and runs agents; it never installs them. So a missing
 * agent is a hand-off, not a button: the agent declares where it comes from
 * (`installHint`) and this renders it — the copy-pasteable command when one
 * works on every platform, otherwise the download page. Without this, "Not
 * installed" would be a dead end.
 */

/** Compact one-liner for a list row: just the command, or the link. */
export function InstallHintInline({ hint }: { hint: InstallHint }) {
  return (
    <span className="agent-install-hint">
      {hint.command ? (
        <code className="agent-install-hint__command">{hint.command}</code>
      ) : (
        <a href={hint.url} target="_blank" rel="noreferrer noopener">
          Get it
        </a>
      )}
    </span>
  );
}

/** Full block for the agent detail screen: the command, a copy button, a link. */
export function InstallHintBlock({ name, hint }: { name: string; hint: InstallHint }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    if (!hint.command) return;
    void navigator.clipboard.writeText(hint.command).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }, [hint.command]);

  return (
    <div className="settings-section">
      <h3>{name}</h3>
      <p className="settings-helper">
        {name} isn&rsquo;t installed. Compose runs it once it&rsquo;s on your machine.
      </p>
      {hint.command ? (
        <div className="settings-install-hint">
          <code className="settings-install-hint__command">{hint.command}</code>
          <Button size="sm" kind="tertiary" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      ) : null}
      <p className="settings-helper">
        <a href={hint.url} target="_blank" rel="noreferrer noopener">
          Installation instructions for {name}
        </a>
      </p>
    </div>
  );
}
