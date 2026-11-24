// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { CodeMirrorMarkdownEditor } from "@latentic/live-markdown";
import { act, render } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => ({
  createFile: vi.fn(async () => ({ lastModifiedMs: 50 })),
  writeFile: vi.fn(async () => ({ lastModifiedMs: 60 })),
  readFile: vi.fn(),
  renameFile: vi.fn(async () => {}),
}));
vi.mock("../../lib/ipc/filesClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/ipc/filesClient")>();
  return { ...original, ...files };
});
vi.mock("../../lib/ipc/workspaceClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/ipc/workspaceClient")>();
  return { ...original, saveWorkspaceTabs: vi.fn(async () => {}) };
});
vi.mock("../../lib/runtime/desktopRuntime", () => ({ isTauriRuntime: () => true }));

import { registerActiveEditorFlush } from "../../lib/editor/editorFlush";
import { useShownFileUpdate } from "../../features/editor/useShownFileUpdate";
import { applyFileBuffer } from "../workspace/files";
import { createWorkspaceFromPath } from "../workspace/workspaces";
import { openWorkspaceFile } from "../workspace/tabs";
import type { Workspace } from "../workspace/types";
import { useWorkspaceStore } from "../workspaceStore";

beforeAll(() => {
  // jsdom lays nothing out: CodeMirror's measure of the caret's text finds
  // no boxes.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

function Host() {
  const workspace = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === "ws"));
  const path = workspace?.activeFilePath ?? "";
  const update = useShownFileUpdate("ws", path);
  return (
    <CodeMirrorMarkdownEditor
      mode="wysiwyg"
      value={workspace?.fileContents[path]?.content ?? ""}
      filePath={path}
      onChange={update}
      onFlushReady={registerActiveEditorFlush}
    />
  );
}

const ws = () => useWorkspaceStore.getState().workspaces.find((w) => w.id === "ws")!;

beforeEach(() => {
  for (const mock of Object.values(files)) mock.mockClear();
  let workspace: Workspace = {
    ...createWorkspaceFromPath("/tmp/notes"),
    id: "ws",
    scanState: "ready",
    files: [
      { relativePath: "a.md", lastModifiedMs: 1, sizeBytes: 1 },
      { relativePath: "b.md", lastModifiedMs: 1, sizeBytes: 1 },
    ],
  };
  workspace = applyFileBuffer(workspace, "a.md", { content: "alpha\n", lastModifiedMs: 1 });
  workspace = applyFileBuffer(workspace, "b.md", { content: "beta\n", lastModifiedMs: 1 });
  workspace = openWorkspaceFile(openWorkspaceFile(workspace, "b.md"), "a.md");
  useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: "ws", focusedArea: "workspace", navHistory: [], navIndex: -1, newNoteDir: "" });
});

function typeInEditor(container: HTMLElement, text: string) {
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
  act(() => view.dispatch({ changes: { from: 0, insert: text }, userEvent: "input.type" }));
}

describe("typing the editor has not handed over yet, when the active file changes", () => {
  it("is saved to its own note when a new note takes the editor", async () => {
    const { container } = render(<Host />);
    typeInEditor(container, "typed ");
    await act(async () => {
      await useWorkspaceStore.getState().createNote();
    });
    expect(ws().activeFilePath).toBe("untitled-1.md");
    expect(ws().fileContents["untitled-1.md"]).toMatchObject({ content: "# Untitled\n\n", dirty: false });
    expect(files.writeFile).toHaveBeenCalledWith("ws", "a.md", "typed alpha\n", 1, expect.anything());
  });

  it("keeps the tab of a file removed outside the app, and leaves the next tab's text alone", async () => {
    const { container } = render(<Host />);
    typeInEditor(container, "typed ");
    await act(async () => {
      await useWorkspaceStore.getState().handleFsEvent("ws", { kind: "removed", relativePath: "a.md" } as never);
    });
    expect(ws().openFilePaths).toContain("a.md");
    expect(ws().fileContents["a.md"]).toMatchObject({ content: "typed alpha\n", dirty: true });
    expect(ws().fileContents["b.md"]).toMatchObject({ content: "beta\n", dirty: false });
  });

  it("goes with the note to its new name", async () => {
    const { container } = render(<Host />);
    typeInEditor(container, "typed ");
    await act(async () => {
      await useWorkspaceStore.getState().renameActiveFile("c.md");
    });
    expect(ws().fileContents["c.md"]).toMatchObject({ content: "typed alpha\n", dirty: true });
    expect(ws().fileContents["a.md"]).toBeUndefined();
  });

  it("stays in its note when another tab is selected", async () => {
    const { container } = render(<Host />);
    typeInEditor(container, "typed ");
    await act(async () => {
      await useWorkspaceStore.getState().selectFile("b.md");
    });
    expect(ws().fileContents["b.md"]).toMatchObject({ content: "beta\n", dirty: false });
    expect(files.writeFile).toHaveBeenCalledWith("ws", "a.md", "typed alpha\n", 1, expect.anything());
  });
});

describe("two new notes asked for at once", () => {
  it("get two names", async () => {
    await act(async () => {
      await Promise.all([useWorkspaceStore.getState().createNote(), useWorkspaceStore.getState().createNote()]);
    });
    expect(files.createFile.mock.calls.map((call) => (call as unknown[])[1])).toEqual(["untitled-1.md", "untitled-2.md"]);
  });
});
