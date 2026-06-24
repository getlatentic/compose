import { useEffect, useRef, useState } from "react";
import { Button, InlineNotification, Tag, Toggle } from "@carbon/react";
import { useHarnessStore } from "../../app/store/harnessStore";
import {
  harnessDiscover,
  harnessInstall,
  harnessList,
  harnessLogin,
  type HarnessInfo,
  type HarnessReadiness,
} from "../../lib/ipc/harnessClient";
import { agentStatus, statusTagType } from "./agentStatus";

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
 * The harness to recommend as the default, in catalog (registration) order: the
 * first that works *right now* (ready), else the first installed (needs sign-in /
 * a key), else the first registered. The registry's declared order *is* the
 * preference — reorder `compose_registry` to change it — so there's no separate
 * priority list to drift.
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
  // Re-probe driver: when the user saves an API key or (re)installs a CLI
  // elsewhere in Settings, the selected harness's stored readiness changes and
  // the badges must reflect it without reopening the panel.
  const selectedHarnessReadiness = useHarnessStore((state) => state.selectedHarnessReadiness);

  const [rows, setRows] = useState<HarnessRow[]>([]);
  // True while the readiness probe is in flight. The agent cards render
  // immediately from the catalog; this only gates the "Checking…" badges.
  const [probing, setProbing] = useState(true);
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

  async function refresh() {
    setError(null);
    setProbing(true);
    try {
      // Show the agents IMMEDIATELY from the catalog (fast — no shelling out), so
      // the picker never blocks on the readiness probe. Preserve any readiness
      // from a previous pass so a re-probe doesn't blank the badges.
      const list = await harnessList();
      setRows((prev) =>
        list.map((info) => ({
          info,
          readiness: prev.find((row) => row.info.id === info.id)?.readiness ?? null,
        })),
      );
      // The slower part: probe every harness's readiness, then fill the badges in.
      const discovered = await harnessDiscover();
      const withReadiness = list.map((info) => ({
        info,
        readiness: discovered.find((r) => r.harnessId === info.id) ?? null,
      }));
      setRows(withReadiness);
      // Onboarding only: land the first-time user on the discovery-suggested
      // default, so they can accept it with one click. Once.
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
      setProbing(false);
    }
  }

  // Probe on mount, then re-probe whenever the selected harness's stored
  // readiness changes — e.g. the moment the user saves an API key below, its
  // badge flips "Add a key" → "Ready" without reopening Settings. The cards stay
  // put (rendered from the catalog); only the badges refresh.
  useEffect(() => {
    void refresh();
  }, [selectedHarnessReadiness]);

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
        {probing
          ? "Checking your computer for the AI assistants you already have…"
          : "Choose which AI Compose works with. You can change this anytime."}
      </p>

      <ul className="harness-grid">
        {rows.map(({ info, readiness }) => {
          const selected = info.id === selectedHarnessId;
          // Until the probe lands, a card reads "Checking…" and isn't selectable —
          // agentStatus(null) would otherwise report a definite (wrong) status.
          const checking = probing && !readiness;
          const status = checking ? null : agentStatus(info, readiness);
          return (
            <li
              key={info.id}
              className={selected ? "harness-card harness-card--selected" : "harness-card"}
            >
              <button
                type="button"
                className="harness-card__pick"
                onClick={() => pickHarness(info.id)}
                aria-pressed={selected}
                disabled={checking}
              >
                <span className="harness-card__head">
                  <span aria-hidden className="harness-card__radio">
                    {selected ? "●" : "○"}
                  </span>
                  <strong className="harness-card__name">{info.displayName}</strong>
                </span>
                <span className="harness-card__badges">
                  {info.id === suggestedId && !checking ? (
                    <Tag size="sm" type="blue">
                      Recommended
                    </Tag>
                  ) : null}
                  {checking ? (
                    <Tag size="sm" type="warm-gray">
                      Checking…
                    </Tag>
                  ) : (
                    <Tag size="sm" type={statusTagType(status!.tone)}>
                      {status!.label}
                    </Tag>
                  )}
                </span>
                <span className="harness-card__desc">{info.description}</span>
                {readiness?.version ? (
                  <span className="harness-card__version">{readiness.version}</span>
                ) : null}
              </button>
              {status?.action === "install" ? (
                <Button
                  size="sm"
                  kind="tertiary"
                  disabled={installingId !== null}
                  onClick={() => void handleInstall(info.id)}
                >
                  {installingId === info.id ? "Installing…" : "Install"}
                </Button>
              ) : status?.action === "signIn" ? (
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
