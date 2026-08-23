// @vitest-environment jsdom
//
// The floating composer measures its own height and reports it up (so the
// transcript can reserve matching space) and publishes it as the
// `--chat-composer-block` var (the undo toast offsets above it). jsdom has no
// layout or ResizeObserver, so `offsetHeight` and the observer are stubbed;
// the test asserts the measurement is wired to both outputs.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessageComposer } from "./MessageComposer";

// The footer is store-/IPC-connected and irrelevant to height reporting; stub
// it so this test stays about the composer's own measurement wiring.
vi.mock("./ChatComposerFooter", () => ({ ChatComposerFooter: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let panel: HTMLElement;
let root: Root;
let observerCallback: ResizeObserverCallback | null;

class StubResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    observerCallback = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const baseProps = {
  assistantReady: { ready: true, message: null },
  canSend: false,
  contextItems: [],
  missingContextPaths: new Set<string>(),
  activeFilePath: "",
  harnessName: "Bob",
  onAddFileContext: () => {},
  onOpenSettings: () => {},
  onPromptChange: () => {},
  onRemoveContextItem: () => {},
  onRetry: () => {},
  onSend: () => {},
  onStop: () => {},
  prompt: "",
  runError: null,
  running: false,
  tokenLabel: null,
  workspaceId: "workspace-1",
};

function stubComposerHeight(height: number): void {
  const composer = panel.querySelector<HTMLElement>(".chat-composer")!;
  Object.defineProperty(composer, "offsetHeight", { value: height, configurable: true });
}

function render(onHeightChange: (h: number) => void): void {
  act(() => {
    root.render(<MessageComposer {...baseProps} onHeightChange={onHeightChange} />);
  });
}

beforeEach(() => {
  observerCallback = null;
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  // The composer locates its panel via `closest(".chat-panel")`, so mount it
  // inside one (the height var is written there).
  panel = document.createElement("section");
  panel.className = "chat-panel";
  document.body.appendChild(panel);
  root = createRoot(panel);
});

afterEach(() => {
  act(() => root.unmount());
  panel.remove();
  vi.unstubAllGlobals();
});

describe("MessageComposer height reporting", () => {
  it("reports the measured height and sets --chat-composer-block on mount", () => {
    const onHeightChange = vi.fn();
    // The layout effect measures during the act() commit; the height must be
    // defined before the effect runs, so stub it on a pre-rendered element.
    act(() => {
      root.render(<MessageComposer {...baseProps} onHeightChange={onHeightChange} />);
    });
    // Re-measure now that the element exists, then trigger the observer.
    stubComposerHeight(176);
    act(() => observerCallback?.([], {} as ResizeObserver));
    expect(onHeightChange).toHaveBeenLastCalledWith(176);
    expect(panel.style.getPropertyValue("--chat-composer-block")).toBe("176px");
  });

  it("re-reports when the composer resizes (observer fires)", () => {
    const onHeightChange = vi.fn();
    render(onHeightChange);
    stubComposerHeight(140);
    act(() => observerCallback?.([], {} as ResizeObserver));
    expect(onHeightChange).toHaveBeenLastCalledWith(140);
    stubComposerHeight(300);
    act(() => observerCallback?.([], {} as ResizeObserver));
    expect(onHeightChange).toHaveBeenLastCalledWith(300);
    expect(panel.style.getPropertyValue("--chat-composer-block")).toBe("300px");
  });
});

describe("MessageComposer context chips", () => {
  const fileItem = {
    id: "ctx-1",
    kind: "file" as const,
    label: "Others/Writing/note.md",
    path: "Others/Writing/note.md",
    workspaceId: "workspace-1",
  };

  it("marks a missing context file instead of hiding it (mark-not-remove)", () => {
    act(() => {
      root.render(
        <MessageComposer
          {...baseProps}
          contextItems={[fileItem]}
          missingContextPaths={new Set([fileItem.path])}
          onHeightChange={() => {}}
        />,
      );
    });
    const chip = panel.querySelector(".chat-context-chip--missing");
    expect(chip).not.toBeNull();
    // The tooltip explains the state; the label stays the file name.
    expect(chip?.getAttribute("title")).toContain("isn't on disk right now");
    expect(chip?.textContent).toContain("note.md");
    // Still deliberately removable — marking never takes the choice away.
    expect(chip?.querySelector(".chat-context-chip__remove")).not.toBeNull();
  });

  it("renders a plain chip while the file exists on disk", () => {
    act(() => {
      root.render(
        <MessageComposer
          {...baseProps}
          contextItems={[fileItem]}
          missingContextPaths={new Set<string>()}
          onHeightChange={() => {}}
        />,
      );
    });
    expect(panel.querySelector(".chat-context-chip--missing")).toBeNull();
    expect(panel.querySelector(".chat-context-chip")?.getAttribute("title")).toBe(fileItem.label);
  });
});

describe("what the composer offers when the assistant isn't ready", () => {
  const notReady = {
    ...baseProps,
    assistantReady: { ready: false, message: "Ollama isn't running." },
    harnessName: "Ollama",
    onHeightChange: () => {},
  };

  function renderComposer(props: Record<string, unknown>): void {
    act(() => {
      root.render(<MessageComposer {...notReady} {...props} />);
    });
  }

  it("hands off to the install instructions when the agent isn't on the machine", () => {
    // The reported dead end: with Ollama uninstalled the composer offered
    // "Start Ollama", the start failed, and the notice became "Couldn't start
    // Ollama. / Try again" — with no way to reach the download. An agent that
    // isn't installed must never be offered a start.
    renderComposer({
      installHint: { url: "https://ollama.com/download", command: null },
      onStartOllama: undefined,
    });

    expect(panel.textContent).toContain("Ollama isn\u2019t installed");
    expect(panel.textContent).toContain("How to install");
    expect(panel.textContent).not.toContain("Start Ollama");
    expect(panel.textContent).not.toContain("Try again");
  });

  it("offers the one-click start when it is installed and merely stopped", () => {
    renderComposer({ installHint: null, onStartOllama: () => {} });

    expect(panel.textContent).toContain("Start Ollama");
    expect(panel.textContent).not.toContain("How to install");
  });
});
