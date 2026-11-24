// @vitest-environment jsdom
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useUiStore } from "../../app/store/uiStore";
import { LinkInsertProvider } from "../dialogs/LinkInsertProvider";
import { TextPromptProvider } from "../dialogs/TextPromptProvider";
import { CodeMirrorToolbar } from "./CodeMirrorToolbar";
import { activeEditorView } from "./editorChrome";

afterEach(() => {
  if (useUiStore.getState().formatBarCollapsed) act(() => useUiStore.getState().toggleFormatBar());
});

function renderToolbar() {
  const view = new EditorView({ state: EditorState.create({ doc: "Hello", extensions: [markdown({ base: markdownLanguage })] }) });
  const result = render(
    <TextPromptProvider>
      <LinkInsertProvider>
        <CodeMirrorToolbar view={view} mode="wysiwyg" fileActions={<button type="button">History</button>} />
      </LinkInsertProvider>
    </TextPromptProvider>,
  );
  return { view, ...result };
}

describe("CodeMirrorToolbar", () => {
  it("folds the formatting buttons away and back, keeping the file actions, and remembers it", () => {
    renderToolbar();
    expect(screen.getByRole("button", { name: "Bold (⌘B)" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide formatting" }));
    expect(screen.queryByRole("button", { name: "Bold (⌘B)" })).toBeNull();
    expect(screen.getByRole("button", { name: "History" })).toBeTruthy();
    expect(useUiStore.getState().formatBarCollapsed).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Show formatting" }));
    expect(screen.getByRole("button", { name: "Bold (⌘B)" })).toBeTruthy();
  });

  it("publishes its editor for the selection's format bar while mounted", () => {
    const { view, unmount } = renderToolbar();
    expect(activeEditorView.get()).toBe(view);
    unmount();
    expect(activeEditorView.get()).toBeNull();
  });
});
