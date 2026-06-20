// @vitest-environment jsdom
//
// The model manager lists installed models, streams a pull's progress, and
// refreshes after pull/delete. The IPC client is mocked so the test drives the
// pull callback directly (no Tauri), asserting the list → progress → refresh
// wiring and on-disk size formatting.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InstalledModel, PullEvent } from "../../lib/ipc/harnessClient";

const installedModels = vi.fn<() => Promise<InstalledModel[]>>();
const pullModel = vi.fn<(h: string, m: string, on: (event: PullEvent) => void) => Promise<void>>();
const cancelPull = vi.fn<(h: string, m: string) => Promise<void>>(() => Promise.resolve());
const deleteModel = vi.fn<(h: string, m: string) => Promise<void>>(() => Promise.resolve());

vi.mock("../../lib/ipc/harnessClient", () => ({
  harnessInstalledModels: () => installedModels(),
  harnessPullModel: (harnessId: string, model: string, onEvent: (e: PullEvent) => void) =>
    pullModel(harnessId, model, onEvent),
  harnessCancelPull: (harnessId: string, model: string) => cancelPull(harnessId, model),
  harnessDeleteModel: (harnessId: string, model: string) => deleteModel(harnessId, model),
}));

// The component reads `loadHarnessModels` from the store to refresh the picker
// list; stub the store to a no-op so the test stays about the manager itself.
const loadHarnessModels = vi.fn(() => Promise.resolve());
vi.mock("../../app/store/harnessStore", () => ({
  useHarnessStore: (selector: (s: { loadHarnessModels: () => Promise<void> }) => unknown) =>
    selector({ loadHarnessModels }),
}));

import { OllamaModelManager } from "./OllamaModelManager";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

const management = { baseUrl: "http://localhost:11434" };

async function renderManager(): Promise<void> {
  await act(async () => {
    root.render(<OllamaModelManager harnessId="ollama" management={management} />);
  });
}

beforeEach(() => {
  installedModels.mockReset();
  pullModel.mockReset();
  loadHarnessModels.mockClear();
  installedModels.mockResolvedValue([]);
  pullModel.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("OllamaModelManager", () => {
  it("lists installed models with a GB size and details", async () => {
    installedModels.mockResolvedValue([
      {
        name: "llama3.2:3b",
        size: 2_000_000_000,
        parameterSize: "3.2B",
        quantizationLevel: "Q4_K_M",
      },
    ]);
    await renderManager();
    const text = container.textContent ?? "";
    expect(text).toContain("llama3.2:3b");
    expect(text).toContain("2.0 GB");
    expect(text).toContain("3.2B");
    expect(text).toContain("Q4_K_M");
  });

  it("shows streamed progress then refreshes the list on success", async () => {
    installedModels.mockResolvedValue([]);
    let emit: (event: PullEvent) => void = () => {};
    pullModel.mockImplementation(async (_h, _m, onEvent) => {
      emit = onEvent;
    });
    await renderManager();
    expect(installedModels).toHaveBeenCalledTimes(1);

    // Trigger a pull via the first quick-pick chip.
    const chip = container.querySelector<HTMLButtonElement>(".model-manager__pick");
    expect(chip).not.toBeNull();
    await act(async () => {
      chip!.click();
    });
    expect(pullModel).toHaveBeenCalledTimes(1);

    // A progress event renders the bar + status text.
    await act(async () => {
      emit({ kind: "progress", status: "pulling manifest", percent: 42 });
    });
    expect(container.querySelector(".model-manager__pull")).not.toBeNull();
    expect(container.textContent).toContain("pulling manifest");

    // Success clears progress and re-lists installed models + refreshes picker.
    await act(async () => {
      emit({ kind: "done" });
    });
    expect(container.querySelector(".model-manager__pull")).toBeNull();
    expect(installedModels).toHaveBeenCalledTimes(2);
    expect(loadHarnessModels).toHaveBeenCalledWith("ollama");
  });

  it("surfaces a pull error inline without refreshing", async () => {
    let emit: (event: PullEvent) => void = () => {};
    pullModel.mockImplementation(async (_h, _m, onEvent) => {
      emit = onEvent;
    });
    await renderManager();
    const chip = container.querySelector<HTMLButtonElement>(".model-manager__pick");
    await act(async () => {
      chip!.click();
    });
    await act(async () => {
      emit({ kind: "error", message: "file does not exist" });
    });
    expect(container.textContent).toContain("file does not exist");
    // No success refresh happened (only the initial load).
    expect(installedModels).toHaveBeenCalledTimes(1);
  });
});
