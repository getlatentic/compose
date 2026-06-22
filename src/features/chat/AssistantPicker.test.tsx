// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantPickerView, type AssistantPickerViewProps } from "./AssistantPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const assistants = [
  { id: "opencode", name: "OpenCode" },
  { id: "claude", name: "Claude" },
];
const models = [
  { value: "", label: "Default" },
  { value: "deepseek", label: "opencode/deepseek-v4-flash-free" },
];

function render(overrides: Partial<AssistantPickerViewProps> = {}) {
  const props: AssistantPickerViewProps = {
    label: "opencode/deepseek-v4-flash-free",
    assistants,
    selectedAssistantId: "opencode",
    onSelectAssistant: vi.fn(),
    models,
    selectedModel: "deepseek",
    onSelectModel: vi.fn(),
    ...overrides,
  };
  act(() => root.render(<AssistantPickerView {...props} />));
  return props;
}

function clickEl(el: Element | null | undefined) {
  act(() => {
    (el as HTMLElement).click();
  });
}

// The popup is portaled to <body>, so query the document, not `container`.
const popover = () => document.querySelector(".assistant-picker__popover");
const items = () => Array.from(document.querySelectorAll(".assistant-picker__item"));
const headings = () =>
  Array.from(document.querySelectorAll(".assistant-picker__heading")).map((h) => h.textContent);

describe("AssistantPickerView", () => {
  it("shows the combined label and stays closed initially", () => {
    render();
    expect(container.querySelector(".assistant-picker__label")?.textContent).toBe(
      "opencode/deepseek-v4-flash-free",
    );
    expect(popover()).toBeNull();
  });

  it("opens to an Assistant section and a Model section", () => {
    render();
    clickEl(container.querySelector(".assistant-picker__trigger"));
    expect(popover()).not.toBeNull();
    expect(headings()).toEqual(["Assistant", "Model"]);
    expect(items()).toHaveLength(4); // 2 assistants + 2 models
  });

  it("hides the Model section when there are no models", () => {
    render({ models: [] });
    clickEl(container.querySelector(".assistant-picker__trigger"));
    expect(headings()).toEqual(["Assistant"]);
  });

  it("switching assistant fires the callback and keeps the popup open for a model", () => {
    const props = render();
    clickEl(container.querySelector(".assistant-picker__trigger"));
    clickEl(items().find((b) => b.textContent?.includes("Claude")));
    expect(props.onSelectAssistant).toHaveBeenCalledWith("claude");
    expect(popover()).not.toBeNull();
  });

  it("choosing a model fires the callback and closes the popup", () => {
    const props = render();
    clickEl(container.querySelector(".assistant-picker__trigger"));
    clickEl(items().find((b) => b.textContent?.includes("deepseek")));
    expect(props.onSelectModel).toHaveBeenCalledWith("deepseek");
    expect(popover()).toBeNull();
  });
});
