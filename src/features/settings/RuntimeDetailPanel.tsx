import { useEffect, useRef, useState } from "react";
import { Button, InlineNotification, SkeletonText, Tag, TextInput } from "@carbon/react";
import { CheckmarkFilled } from "@carbon/react/icons";

import { useHarnessStore } from "../../app/store/harnessStore";
import {
  harnessReadiness,
  runtimeDetailsOf,
  startOllama,
  type HarnessReadiness,
} from "../../lib/ipc/harnessClient";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { agentStatus, statusTagType } from "./agentStatus";
import { installKindBadge } from "./installKind";
import { useRuntimeInstall } from "./useRuntimeInstall";

/**
 * One agent's runtime detail: which binary its CLI resolves to, the version,
 * install kind, and whether it's current — with an Update / switch-to-native
 * action, the resolved path, and an explicit-path override. Rendered inside the
 * detail's collapsible "Runtime" section, so it only mounts (and only probes the
 * live runtime facts) when the user expands it — never on detail open, which is
 * what caused the status to flash. It seeds from the readiness the list already
 * loaded (`initialReadiness`) so it shows facts at once, then refreshes quietly.
 */
export function RuntimeDetailPanel({
  harnessId,
  initialReadiness,
}: {
  harnessId: string;
  initialReadiness?: HarnessReadiness | null;
}) {
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const setHarnessOptions = useHarnessStore((state) => state.setHarnessOptions);
  const binaryPath = useHarnessStore(
    (state) => state.harnessOptions[harnessId]?.binaryPath ?? "",
  );
  const info = harnessCatalog.find((entry) => entry.id === harnessId);

  const [readiness, setReadiness] = useState<HarnessReadiness | null>(initialReadiness ?? null);
  // Skeleton only when we have nothing to show yet; a seed lets us render facts
  // immediately and refresh in the background, so expanding doesn't flash.
  const [checking, setChecking] = useState(initialReadiness == null);

  // Refresh the live runtime facts (version, install kind, resolved path) once
  // expanded — this is the deferred probe; it runs on first mount of the section.
  useEffect(() => {
    let active = true;
    void harnessReadiness(harnessId)
      .catch(() => null)
      .then((result) => {
        if (!active) return;
        setReadiness(result);
        setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [harnessId]);

  const install = useRuntimeInstall(harnessId, (next) => setReadiness(next));

  if (!isTauriRuntime()) {
    return (
      <div className="settings-section">
        <p className="settings-helper">Runtime management runs in the Compose desktop app.</p>
      </div>
    );
  }

  if (!info) {
    return null;
  }

  const status = checking ? null : agentStatus(info, readiness);
  const { resolvedPath, installKind } = runtimeDetailsOf(readiness);
  const badge = installKind ? installKindBadge(installKind) : null;
  const installed = readiness?.installed ?? false;
  const actionLabel = !installed
    ? `Install ${info.displayName}`
    : installKind === "npm-global"
      ? "Switch to native build"
      : "Update";

  // Only a CLI that Compose can install/update gets an action, and only when
  // there's a real one: an Install when it's missing, or a switch-to-native when
  // it's a stale npm copy. The native build updates itself, so it shows no
  // button. A harness with no managed install path (Ollama) shows status only.
  const canManage = info.requiresInstall && (!installed || installKind === "npm-global");
  const isOllama = harnessId === "ollama";
  const ollamaNotReady = isOllama && !checking && !(readiness?.ready ?? false);

  return (
    <div className="runtime-detail-panel">
      <div className="runtime-detail__status">
        {checking ? (
          <SkeletonText width="40%" />
        ) : (
          <>
            {readiness?.version ? (
              <span className="runtime-row__version">{readiness.version}</span>
            ) : null}
            {status?.kind === "ready" ? (
              <Tag size="sm" type="green">
                Ready
              </Tag>
            ) : status ? (
              <Tag size="sm" type={statusTagType(status.tone)}>
                {status.label}
              </Tag>
            ) : null}
            {badge ? (
              <Tag size="sm" type={badge.tone} title={badge.note}>
                {badge.label}
              </Tag>
            ) : null}
          </>
        )}
      </div>
      {badge ? <p className="settings-helper">{badge.note}</p> : null}

      <OllamaStart show={ollamaNotReady} onReadiness={setReadiness} />

      {canManage ? (
        <div className="settings-actions">
          <Button
            size="sm"
            kind={installed ? "tertiary" : "primary"}
            disabled={install.running}
            onClick={() => void install.run()}
          >
            {install.running ? "Working…" : actionLabel}
          </Button>
        </div>
      ) : null}

      <dl className="runtime-detail">
        <dt>Resolved path</dt>
        <dd className="runtime-detail__path">
          {resolvedPath ?? <span className="runtime-detail__muted">Not reported yet</span>}
        </dd>
      </dl>

      <TextInput
        id={`${harnessId}-explicit-path`}
        size="sm"
        labelText="Explicit path (override)"
        helperText="Pin this agent to a specific binary instead of resolving its name on PATH. Leave blank to use PATH."
        placeholder={resolvedPath ?? "/path/to/binary"}
        value={binaryPath}
        onChange={(event) =>
          setHarnessOptions(harnessId, { binaryPath: event.target.value.trim() || undefined })
        }
      />
      <SavedHint value={binaryPath} />

      {install.log.length > 0 ? (
        <pre
          className="settings-install-log"
          aria-label={`${info.displayName} update progress`}
          aria-live="polite"
        >
          {install.log.map((entry, i) => (
            <div
              key={i}
              className={`settings-install-log__line settings-install-log__line--${entry.kind}`}
            >
              {entry.kind === "step" ? "› " : entry.kind === "stderr" ? "! " : "  "}
              {entry.text}
            </div>
          ))}
        </pre>
      ) : null}

      {install.result ? (
        <InlineNotification
          hideCloseButton
          kind={install.result.ok ? "success" : "error"}
          lowContrast
          title={install.result.ok ? `${info.displayName} updated` : "Update failed"}
          subtitle={
            install.result.ok
              ? `${info.displayName} is up to date.`
              : `Exited with code ${install.result.exitCode ?? "?"}. Check the log above.`
          }
        />
      ) : null}
      {install.error ? (
        <InlineNotification
          hideCloseButton
          kind="error"
          lowContrast
          subtitle={install.error}
          title="Update error"
        />
      ) : null}
    </div>
  );
}

/** A transient "Saved" confirmation beside the explicit-path override: the
 *  override applies on the next run (not live), so a brief check after an edit
 *  confirms it stuck without a persistent banner. Skips the initial mount so it
 *  doesn't flash on a pre-filled value. */
function SavedHint({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setShown(true);
    const timer = window.setTimeout(() => setShown(false), 2000);
    return () => window.clearTimeout(timer);
  }, [value]);

  if (!shown) {
    return null;
  }
  return (
    <p className="runtime-detail__saved" aria-live="polite">
      <CheckmarkFilled aria-hidden />
      Saved · applies on next run
    </p>
  );
}

/** Ollama's one-click "isn't running" fix: start its local server (headless via
 *  `ollama serve`, falling back to launching the app), wait briefly for it to
 *  come up, then re-probe readiness so the tab reflects it. Only rendered when
 *  Ollama is installed-but-not-ready. */
function OllamaStart({
  show,
  onReadiness,
}: {
  show: boolean;
  onReadiness: (readiness: HarnessReadiness | null) => void;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      await startOllama();
      // Ollama's server takes a few seconds to load model metadata before it
      // answers on :11434, so poll readiness rather than probing once — a single
      // early probe reads "not running" even though the server is coming up.
      for (let attempt = 0; attempt < 15 && mounted.current; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const probed = await harnessReadiness("ollama").catch(() => null);
        if (!mounted.current) return;
        if (probed?.ready || attempt === 14) {
          onReadiness(probed);
          if (probed?.ready) return;
        }
      }
    } catch (caught) {
      if (mounted.current) {
        setError(caught instanceof Error ? caught.message : "Could not start Ollama");
      }
    } finally {
      if (mounted.current) setStarting(false);
    }
  }

  if (!show) {
    return null;
  }
  return (
    <div className="settings-section">
      <p className="settings-helper">Ollama is installed but its server isn’t running.</p>
      <div className="settings-actions">
        <Button size="sm" kind="primary" disabled={starting} onClick={() => void start()}>
          {starting ? "Starting…" : "Start Ollama"}
        </Button>
      </div>
      {error ? (
        <InlineNotification
          hideCloseButton
          kind="error"
          lowContrast
          subtitle={error}
          title="Couldn’t start Ollama"
        />
      ) : null}
    </div>
  );
}
