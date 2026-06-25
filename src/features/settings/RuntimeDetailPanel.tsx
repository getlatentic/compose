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
 * One agent's runtime tab: which binary its CLI resolves to, the version,
 * install kind, and whether it's current — with an Update / Reinstall action,
 * the resolved path, and an explicit-path override. The runtime-management
 * surface (what's installed, is it the self-updating native build, where it
 * lives) that keeps a stale npm copy from silently breaking a run, folded into
 * the agent's detail rather than a separate top-level panel.
 */
export function RuntimeDetailPanel({ harnessId }: { harnessId: string }) {
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const setHarnessOptions = useHarnessStore((state) => state.setHarnessOptions);
  const binaryPath = useHarnessStore(
    (state) => state.harnessOptions[harnessId]?.binaryPath ?? "",
  );
  const info = harnessCatalog.find((entry) => entry.id === harnessId);

  const [readiness, setReadiness] = useState<HarnessReadiness | null>(null);
  const [checking, setChecking] = useState(true);

  // Probe readiness on mount so the tab shows the live runtime facts (version,
  // install kind, resolved path) without depending on a sibling panel.
  useEffect(() => {
    let active = true;
    setChecking(true);
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
      ? "Update to native"
      : "Update";

  // Only a CLI that Compose can install/update gets an action. A harness with no
  // managed install path (e.g. a local server like Ollama) shows status only.
  const canManage = info.requiresInstall;
  const isOllama = harnessId === "ollama";
  const ollamaNotReady = isOllama && !checking && !(readiness?.ready ?? false);

  return (
    <div className="settings-section">
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
