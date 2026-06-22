import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Button,
  InlineLoading,
  InlineNotification,
  OperationalTag,
  ProgressBar,
  TextInput,
} from "@carbon/react";
import { Add, TrashCan } from "@carbon/react/icons";
import { useHarnessStore } from "../../app/store/harnessStore";
import { openExternalUrl } from "../../lib/links/openExternal";
import {
  harnessCancelPull,
  harnessDeleteModel,
  harnessInstalledModels,
  harnessPullModel,
  type InstalledModel,
  type PullEvent,
} from "../../lib/ipc/harnessClient";

/** How often to re-check for Ollama while it's down, so the section recovers on
 *  its own the moment the user starts it — no button to press. */
const OLLAMA_POLL_MS = 3500;

/** A few small, popular, currently-valid Ollama models as one-click pulls, so a
 * first-time user isn't staring at an empty text field. The free-text field
 * below pulls anything; "Browse all models" links to the full library. */
const QUICK_PICKS: ReadonlyArray<{ name: string; note: string }> = [
  { name: "llama3.2:3b", note: "3.2B · general" },
  { name: "qwen2.5:3b", note: "3B · general" },
  { name: "gemma3:1b", note: "1B · tiny" },
  { name: "granite4:micro", note: "3B · tools" },
  { name: "phi3.5:3.8b", note: "3.8B · reasoning" },
  { name: "smollm2:1.7b", note: "1.7B · tiny" },
  { name: "llama3.2:1b", note: "1B · tiny" },
  { name: "deepseek-r1:1.5b", note: "1.5B · reasoning" },
];

const OLLAMA_LIBRARY_URL = "https://ollama.com/library";

/** Bytes → a compact "x.y GB" / "xxx MB" label for a model's on-disk size. */
function formatModelSize(bytes: number): string {
  if (bytes <= 0) {
    return "—";
  }
  const gb = bytes / 1_000_000_000;
  if (gb >= 1) {
    return `${gb.toFixed(1)} GB`;
  }
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}

/** Live state of an in-progress pull, surfaced as a progress bar + status. */
interface PullState {
  model: string;
  percent: number | null;
  status: string;
}

/**
 * The "Manage models" section for a local-model harness (Ollama): the installed
 * list with sizes + delete, and a pull form (free-text + quick-picks) that
 * streams download progress with a Cancel button. Rendered by
 * [SettingsPanel](./SettingsPanel.tsx) only when the harness reports a
 * model-management capability, so it never appears for cloud/CLI harnesses.
 * Offline (the server isn't running) shows an inline hint and an empty list.
 */
export function OllamaModelManager({ harnessId }: { harnessId: string }) {
  const loadHarnessModels = useHarnessStore((state) => state.loadHarnessModels);
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [pullName, setPullName] = useState("");
  const [pull, setPull] = useState<PullState | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const refreshInstalled = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      setInstalled(await harnessInstalledModels(harnessId));
    } catch (error) {
      setListError(errorText(error, "Couldn't list models — is the model server running?"));
      setInstalled([]);
    } finally {
      setLoading(false);
    }
  }, [harnessId]);

  useEffect(() => {
    void refreshInstalled();
  }, [refreshInstalled]);

  // While Ollama is unreachable, poll quietly so the list fills in the moment
  // the user starts it — this replaces a manual "check again" button.
  useEffect(() => {
    if (!listError) {
      return;
    }
    const timer = window.setInterval(() => void refreshInstalled(), OLLAMA_POLL_MS);
    return () => window.clearInterval(timer);
  }, [listError, refreshInstalled]);

  async function handlePull(model: string) {
    const name = model.trim();
    if (!name || pull) {
      return;
    }
    setPullError(null);
    setPull({ model: name, percent: null, status: "Starting…" });
    await harnessPullModel(harnessId, name, (event: PullEvent) => onPullEvent(name, event));
  }

  function onPullEvent(model: string, event: PullEvent) {
    if (event.kind === "progress") {
      setPull({ model, percent: event.percent ?? null, status: event.status });
      return;
    }
    setPull(null);
    if (event.kind === "error") {
      setPullError(event.message);
      return;
    }
    // Success: clear the field and refresh both this list and the picker's.
    setPullName("");
    void refreshInstalled();
    void loadHarnessModels(harnessId);
  }

  async function handleCancelPull() {
    if (pull) {
      await harnessCancelPull(harnessId, pull.model);
    }
  }

  async function handleDelete(model: string) {
    setDeleting(model);
    setListError(null);
    try {
      await harnessDeleteModel(harnessId, model);
      await refreshInstalled();
      void loadHarnessModels(harnessId);
    } catch (error) {
      setListError(errorText(error, `Couldn't delete ${model}.`));
    } finally {
      setDeleting(null);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handlePull(pullName);
  }

  const installedNames = new Set(installed.map((model) => model.name));

  return (
    <div className="settings-section">
      {listError ? (
        // Ollama is unreachable: nothing here works until it's running, so guide
        // the user to start it. We poll in the background, so this recovers on
        // its own — no dead download form, no button to press.
        <>
          <p className="settings-helper">
            Ollama isn't running. Start the Ollama app on your computer — your models show up here
            on their own.
          </p>
          <InlineLoading description="Looking for Ollama…" status="active" />
        </>
      ) : (
        <>
          {loading ? (
            <InlineLoading description="Loading models…" />
          ) : installed.length > 0 ? (
            <ul className="model-manager__list">
              {installed.map((model) => (
                <li key={model.name} className="model-manager__item">
                  <div className="model-manager__meta">
                    <span className="model-manager__name">{model.name}</span>
                    <span className="model-manager__detail">
                      {formatModelSize(model.size)}
                      {model.parameterSize ? ` · ${model.parameterSize}` : ""}
                      {model.quantizationLevel ? ` · ${model.quantizationLevel}` : ""}
                    </span>
                  </div>
                  <Button
                    kind="ghost"
                    size="sm"
                    hasIconOnly
                    iconDescription={`Delete ${model.name}`}
                    renderIcon={TrashCan}
                    disabled={deleting === model.name || pull !== null}
                    onClick={() => void handleDelete(model.name)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="settings-helper">No models yet — tap one below to download.</p>
          )}

          {pull ? (
            <div className="model-manager__pull" aria-live="polite">
              <ProgressBar
                label={`Downloading ${pull.model}`}
                helperText={pull.status}
                value={pull.percent ?? undefined}
                max={100}
                size="small"
              />
              <Button kind="ghost" size="sm" onClick={() => void handleCancelPull()}>
                Cancel download
              </Button>
            </div>
          ) : (
            <>
              {QUICK_PICKS.some((pick) => !installedNames.has(pick.name)) ? (
                <div className="model-manager__suggest">
                  <span className="model-manager__picks-label">Popular — tap to download:</span>
                  <div className="model-manager__picks">
                    {QUICK_PICKS.filter((pick) => !installedNames.has(pick.name)).map((pick) => (
                      // Native title for the hover hint; OperationalTag's own
                      // `title` prop is deprecated and isn't a tooltip anyway.
                      <span key={pick.name} title={`Download ${pick.name} (${pick.note})`}>
                        <OperationalTag
                          size="sm"
                          text={pick.name}
                          renderIcon={Add}
                          onClick={() => void handlePull(pick.name)}
                        />
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <form className="model-manager__form" onSubmit={onSubmit}>
                <TextInput
                  id={`${harnessId}-pull-model`}
                  labelText="Add another by name"
                  placeholder="e.g. mistral:7b"
                  value={pullName}
                  onChange={(event) => setPullName(event.target.value)}
                />
                <div className="model-manager__actions">
                  <Button size="sm" type="submit" disabled={!pullName.trim()}>
                    Download
                  </Button>
                  <Button
                    kind="ghost"
                    size="sm"
                    onClick={() => void openExternalUrl(OLLAMA_LIBRARY_URL)}
                  >
                    Browse the library
                  </Button>
                </div>
              </form>
            </>
          )}

          {pullError ? (
            <InlineNotification
              hideCloseButton
              kind="error"
              lowContrast
              title="Download failed"
              subtitle={pullError}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
