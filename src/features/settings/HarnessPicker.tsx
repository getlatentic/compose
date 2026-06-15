import { useEffect, useRef, useState } from "react";
import { Button, InlineNotification, SkeletonText, Tag, Toggle } from "@carbon/react";
import { useHarnessStore } from "../../app/store/harnessStore";
import {
  harnessInstall,
  harnessList,
  harnessLogin,
  harnessReadiness,
  type HarnessInfo,
  type HarnessReadiness,
} from "../../lib/ipc/harnessClient";

/**
 * The AI-assistant ("harness") picker.
 *
 * Detection-driven, per the onboarding design: on mount it lists the
 * registered harnesses (`harness_list`) and probes each one's
 * readiness, so the user sees what's already on their machine as
 * "Ready ✓" versus "Not installed" — i.e. "bring your existing AI
 * agent," surfaced for them. Selecting a harness persists it (every
 * run is then routed there); a single edit-permission toggle maps to
 * the run's Ask vs Edit mode, scoped to the workspace folder.
 *
 * Lives in Settings (the canonical, change-anytime home) and is
 * reused by the onboarding flow, which passes `autoSuggestDefault` so a
 * first-time user lands on a sensible pick they can just accept.
 */
interface HarnessRow {
  info: HarnessInfo;
  readiness: HarnessReadiness | null;
}

/**
 * The harness to recommend as the default, chosen from what discovery
 * actually found — the agent that works *right now* (ready, zero setup),
 * else one that's installed (just needs sign-in / a key), else the first
 * registered harness (which has an install path). No hardcoded id, so a
 * machine with Claude ready isn't told to use bob.
 */
function suggestedDefaultId(rows: HarnessRow[]): string | null {
  return (
    rows.find((row) => row.readiness?.ready)?.info.id ??
    rows.find((row) => row.readiness?.installed)?.info.id ??
    rows[0]?.info.id ??
    null
  );
}

export function HarnessPicker({ autoSuggestDefault = false }: { autoSuggestDefault?: boolean } = {}) {
  const selectedHarnessId = useHarnessStore((state) => state.selectedHarnessId);
  const setSelectedHarness = useHarnessStore((state) => state.setSelectedHarness);
  const allowEdits = useHarnessStore((state) => state.allowEdits);
  const setAllowEdits = useHarnessStore((state) => state.setAllowEdits);
  // Re-probe drivers: when the user saves a Bob API key or (re)installs
  // a CLI elsewhere in Settings, the stored status changes and the
  // badges must reflect it without reopening the panel.
  const bobAuthStatus = useHarnessStore((state) => state.bobAuthStatus);
  const bobInstallStatus = useHarnessStore((state) => state.bobInstallStatus);

  const [rows, setRows] = useState<HarnessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [signingInId, setSigningInId] = useState<string | null>(null);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement | null>(null);
  // One-time onboarding auto-pick: fires after the first probe, and never
  // once the user has chosen for themselves (so a re-probe — e.g. after a key
  // save — can't yank their selection back to the suggested default).
  const autoSuggestedRef = useRef(false);
  const userPickedRef = useRef(false);

  const pickHarness = (id: string) => {
    userPickedRef.current = true;
    setSelectedHarness(id);
  };

  async function refresh(options?: { quiet?: boolean }) {
    // A re-probe after a key save shouldn't flash skeletons over an
    // already-populated list — only the first load shows the spinner.
    if (!options?.quiet) {
      setLoading(true);
    }
    setError(null);
    try {
      const list = await harnessList();
      // Probe readiness in parallel — each is an async (off-thread)
      // command, and one failing shouldn't sink the rest.
      const withReadiness = await Promise.all(
        list.map(async (info) => ({
          info,
          readiness: await harnessReadiness(info.id).catch(() => null),
        })),
      );
      setRows(withReadiness);
      // Onboarding only: land the first-time user on the agent discovery
      // suggests, so they can accept it with one click. Once.
      if (autoSuggestDefault && !autoSuggestedRef.current && !userPickedRef.current) {
        const suggested = suggestedDefaultId(withReadiness);
        if (suggested) {
          setSelectedHarness(suggested);
        }
        autoSuggestedRef.current = true;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load AI assistants");
    } finally {
      setLoading(false);
    }
  }

  // Probe on mount (with the skeleton), then re-probe quietly whenever
  // Bob's stored auth or install status changes — e.g. the moment the
  // user saves an API key below, Bob flips "Needs sign-in" → "Ready"
  // without having to close and reopen Settings.
  const probedOnce = useRef(false);
  useEffect(() => {
    void refresh({ quiet: probedOnce.current });
    probedOnce.current = true;
  }, [bobAuthStatus, bobInstallStatus]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [installLog.length]);

  async function handleInstall(id: string) {
    setInstallingId(id);
    setInstallLog([]);
    setError(null);
    try {
      for await (const event of harnessInstall(id)) {
        if (event.kind !== "done" && "text" in event && event.text) {
          setInstallLog((prev) => [...prev, event.text]);
        }
        if (event.kind === "done" && !event.ok) {
          setError(`Install exited with code ${event.exitCode ?? "?"}.`);
        }
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Install failed");
    } finally {
      setInstallingId(null);
    }
  }

  // Trigger the harness's own OAuth sign-in (claude/codex). The CLI opens
  // the browser; we stream its progress, then re-probe so the badge flips
  // "Needs sign-in" → "Ready" without reopening Settings.
  async function handleSignIn(id: string) {
    setSigningInId(id);
    setInstallLog([]);
    setError(null);
    try {
      for await (const event of harnessLogin(id)) {
        if (event.kind !== "done" && "text" in event && event.text) {
          setInstallLog((prev) => [...prev, event.text]);
        }
        if (event.kind === "done" && !event.ok) {
          setError("Sign-in didn't complete. Try again, or finish it in your browser.");
        }
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed");
    } finally {
      setSigningInId(null);
    }
  }

  // Capability-driven, not an id check: the edit-permission helper copy
  // depends on whether the selected harness *previews* edits (approve
  // before apply) vs writes directly — a declared capability.
  const selectedPreviewsEdits =
    rows.find((row) => row.info.id === selectedHarnessId)?.info.capabilities.previewsEdits ?? false;
  // Discovery-driven recommendation (not a hardcoded id) — tags the agent
  // that's the best ready-to-use pick on *this* machine.
  const suggestedId = suggestedDefaultId(rows);

  return (
    <div className="settings-section">
      <p className="settings-helper">
        {loading
          ? "Checking your computer for AI assistants you already have…"
          : "Choose which AI Compose works with. You can change this anytime."}
      </p>

      {loading ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.5rem" }} aria-hidden>
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              style={{ border: "1px solid #e0e0e0", borderRadius: 4, padding: "0.75rem" }}
            >
              <SkeletonText heading width="35%" />
              <SkeletonText width="80%" />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="harness-list" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.5rem" }}>
          {rows.map(({ info, readiness }) => {
            const selected = info.id === selectedHarnessId;
            const ready = readiness?.ready ?? false;
            const installed = readiness?.installed ?? false;
            return (
              <li
                key={info.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.5rem",
                  border: `1px solid ${selected ? "#0f62fe" : "#e0e0e0"}`,
                  borderRadius: 4,
                  padding: "0.625rem 0.75rem",
                  background: selected ? "#edf5ff" : "transparent",
                }}
              >
                <button
                  type="button"
                  onClick={() => pickHarness(info.id)}
                  aria-pressed={selected}
                  style={{
                    flex: 1,
                    display: "grid",
                    gap: "0.25rem",
                    textAlign: "start",
                    background: "transparent",
                    border: 0,
                    cursor: "pointer",
                    font: "inherit",
                    color: "inherit",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span aria-hidden style={{ fontSize: "0.9rem" }}>{selected ? "●" : "○"}</span>
                    <strong style={{ fontSize: "0.8125rem" }}>{info.displayName}</strong>
                    {info.id === suggestedId ? (
                      <Tag size="sm" type="blue">Recommended</Tag>
                    ) : null}
                    {ready ? (
                      <Tag size="sm" type="green">Ready</Tag>
                    ) : installed ? (
                      <Tag size="sm" type="warm-gray">Needs sign-in</Tag>
                    ) : info.requiresInstall ? (
                      <Tag size="sm" type="warm-gray">Not installed</Tag>
                    ) : (
                      <Tag size="sm" type="warm-gray">Add a key</Tag>
                    )}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "#6f6f6f" }}>{info.description}</span>
                  {readiness?.version ? (
                    <span style={{ fontSize: "0.6875rem", color: "#8d8d8d" }}>{readiness.version}</span>
                  ) : null}
                </button>
                {info.requiresInstall && !installed ? (
                  <Button
                    size="sm"
                    kind="tertiary"
                    disabled={installingId !== null}
                    onClick={() => void handleInstall(info.id)}
                  >
                    {installingId === info.id ? "Installing…" : "Install"}
                  </Button>
                ) : installed && !ready && info.capabilities.supportsLogin ? (
                  <Button
                    size="sm"
                    kind="tertiary"
                    disabled={signingInId !== null}
                    onClick={() => void handleSignIn(info.id)}
                  >
                    {signingInId === info.id ? "Signing in…" : "Sign in"}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {installLog.length > 0 ? (
        <pre
          ref={logRef}
          className="settings-install-log"
          aria-label="Setup progress"
          aria-live="polite"
        >
          {installLog.map((line, i) => (
            <div key={i} className="settings-install-log__line">
              {line}
            </div>
          ))}
        </pre>
      ) : null}

      {signingInId ? (
        <InlineNotification
          hideCloseButton
          kind="info"
          lowContrast
          title="Signing in"
          subtitle="Your browser should open — finish signing in there, then this updates automatically."
        />
      ) : null}

      {error ? (
        <InlineNotification hideCloseButton kind="error" lowContrast subtitle={error} title="AI setup" />
      ) : null}

      {/* The single permission toggle. Scoped to the workspace; the
          note explains the suggest-vs-direct difference per harness. */}
      <div style={{ marginBlockStart: "0.75rem" }}>
        <Toggle
          id="harness-allow-edits"
          size="sm"
          labelText="Let the AI edit files in this folder"
          labelA="Read & suggest only"
          labelB="Can edit my files"
          toggled={allowEdits}
          onToggle={(checked) => setAllowEdits(checked)}
        />
        <p className="settings-helper">
          Only in your workspace folder — never anywhere else on your computer.{" "}
          {selectedPreviewsEdits
            ? "Proposed edits wait for your approval before they apply."
            : "Changes apply directly; Compose keeps a history so you can undo."}
        </p>
      </div>
    </div>
  );
}
