import { useEffect, useRef, useState } from "react";
import { Button, InlineNotification, SkeletonText, Tag } from "@carbon/react";
import { useSystemStore } from "../../app/store/systemStore";
import { systemInstallDependency, type DependencyStatus } from "../../lib/ipc/systemClient";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";

/**
 * The "Get ready" doctor: detects and installs the *optional* tools for local AI
 * and advanced skills (Command Line Tools, Homebrew, Ollama). Node and uv ship
 * bundled, so they aren't here. Mirrors {@link HarnessPicker} — status badges, a
 * live install log, and a re-probe after each install. Settings only now.
 *
 * Installs run in dependency order: a row is gated until its prerequisites are
 * present, and "Get me set up" walks the chain. The one privileged step
 * (Homebrew) shows a native macOS password prompt on the backend; the user is
 * told to expect it. Agent readiness lives in the separate "AI agents" section,
 * so this panel is system tools only.
 */
export function SystemSetupPanel() {
  const statuses = useSystemStore((state) => state.statuses);
  const loaded = useSystemStore((state) => state.loaded);
  const installingId = useSystemStore((state) => state.installingId);
  const setInstallingId = useSystemStore((state) => state.setInstallingId);
  const loadSystemReadiness = useSystemStore((state) => state.loadSystemReadiness);

  const [installLog, setInstallLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    void loadSystemReadiness();
  }, [loadSystemReadiness]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [installLog.length]);

  const presentIds = new Set(statuses.filter((status) => status.present).map((status) => status.id));
  const prereqsMet = (status: DependencyStatus) => status.requires.every((id) => presentIds.has(id));
  const allReady = loaded && statuses.length > 0 && statuses.every((status) => status.present);

  // Stream one install, append its log lines, then re-probe. Returns whether the
  // dependency is present afterwards — false also covers Command Line Tools,
  // which finish asynchronously in Apple's own installer.
  async function installAndProbe(id: string): Promise<boolean> {
    setInstallingId(id);
    setError(null);
    try {
      for await (const event of systemInstallDependency(id)) {
        if (event.kind !== "done" && "text" in event && event.text) {
          setInstallLog((prev) => [...prev, event.text]);
        }
        if (event.kind === "done" && !event.ok) {
          setError(`Setup step exited with code ${event.exitCode ?? "?"}.`);
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Setup failed");
    } finally {
      setInstallingId(null);
    }
    await loadSystemReadiness();
    return useSystemStore.getState().statuses.find((status) => status.id === id)?.present ?? false;
  }

  // Install every missing dependency in order. The list is already in dependency
  // order, so each prerequisite lands before its dependent; stop if a step
  // doesn't take (a failure, or CLT still finishing in Apple's installer).
  async function handleSetupAll() {
    setInstallLog([]);
    for (const status of useSystemStore.getState().statuses) {
      if (useSystemStore.getState().statuses.find((s) => s.id === status.id)?.present) {
        continue;
      }
      const landed = await installAndProbe(status.id);
      if (!landed) break;
    }
  }

  if (!isTauriRuntime()) {
    return (
      <div className="settings-section">
        <InlineNotification
          hideCloseButton
          kind="info"
          lowContrast
          title="Desktop only"
          subtitle="Developer-tool setup runs in the Compose desktop app."
        />
      </div>
    );
  }

  return (
    <div className="settings-section">
      <p className="settings-helper">
        {allReady
          ? "Your Mac is set up for local AI and advanced skills."
          : "Optional extras — Ollama for private on-device AI, plus build tools a few advanced skills use. Compose works without them; add any you'd like."}
      </p>

      {!loaded ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.5rem" }} aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <li key={i} style={{ border: "1px solid #e0e0e0", borderRadius: 4, padding: "0.75rem" }}>
              <SkeletonText heading width="35%" />
              <SkeletonText width="80%" />
            </li>
          ))}
        </ul>
      ) : (
        <ul
          className="system-deps-list"
          style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.5rem" }}
        >
          {statuses.map((status) => {
            const blocked = !status.present && !prereqsMet(status);
            return (
              <li
                key={status.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.5rem",
                  border: "1px solid #e0e0e0",
                  borderRadius: 4,
                  padding: "0.625rem 0.75rem",
                }}
              >
                <div style={{ flex: 1, display: "grid", gap: "0.25rem" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: "0.8125rem" }}>{status.name}</strong>
                    {status.present ? (
                      <Tag size="sm" type="green">Installed</Tag>
                    ) : (
                      <Tag size="sm" type="warm-gray">Not installed</Tag>
                    )}
                    {status.requiresAdmin && !status.present ? (
                      <Tag size="sm" type="purple">Needs your Mac password</Tag>
                    ) : null}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "#6f6f6f" }}>{status.description}</span>
                  {status.version ? (
                    <span style={{ fontSize: "0.6875rem", color: "#8d8d8d" }}>{status.version}</span>
                  ) : null}
                  {blocked ? (
                    <span style={{ fontSize: "0.6875rem", color: "#8d8d8d" }}>
                      Install {status.requires.join(", ")} first.
                    </span>
                  ) : null}
                </div>
                {!status.present ? (
                  <Button
                    size="sm"
                    kind="tertiary"
                    disabled={installingId !== null || blocked}
                    onClick={() => void installAndProbe(status.id)}
                  >
                    {installingId === status.id ? "Installing…" : "Install"}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {loaded && !allReady ? (
        <div style={{ display: "flex", gap: "0.5rem", marginBlockStart: "0.25rem" }}>
          <Button
            size="sm"
            kind="primary"
            disabled={installingId !== null}
            onClick={() => void handleSetupAll()}
          >
            {installingId !== null ? "Setting up…" : "Get me set up"}
          </Button>
          <Button size="sm" kind="ghost" disabled={installingId !== null} onClick={() => void loadSystemReadiness()}>
            Re-check
          </Button>
        </div>
      ) : null}

      {installingId && statuses.find((status) => status.id === installingId)?.requiresAdmin ? (
        <InlineNotification
          hideCloseButton
          kind="info"
          lowContrast
          title="Your Mac will ask for permission"
          subtitle="A macOS password prompt will appear — approve it so Compose can finish installing."
        />
      ) : null}

      {installLog.length > 0 ? (
        <pre ref={logRef} className="settings-install-log" aria-label="Setup progress" aria-live="polite">
          {installLog.map((line, i) => (
            <div key={i} className="settings-install-log__line">
              {line}
            </div>
          ))}
        </pre>
      ) : null}

      {allReady ? (
        <InlineNotification
          hideCloseButton
          kind="success"
          lowContrast
          title="You're all set"
          subtitle="The optional local-AI and skill tools are installed."
        />
      ) : null}

      {error ? (
        <InlineNotification hideCloseButton kind="error" lowContrast subtitle={error} title="Setup" />
      ) : null}
    </div>
  );
}
