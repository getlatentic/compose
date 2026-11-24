// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

interface FakeResource {
  readonly kind: string;
  readonly opts: Record<string, unknown>;
  readonly close: ReturnType<typeof vi.fn>;
  readonly popup?: ReturnType<typeof vi.fn>;
}

const created: FakeResource[] = [];

function resource(kind: string, opts: Record<string, unknown>): FakeResource {
  const made: FakeResource = { kind, opts, close: vi.fn(async () => undefined), popup: vi.fn(async () => undefined) };
  created.push(made);
  return made;
}

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: vi.fn(async (opts: Record<string, unknown>) => resource("menu", opts)) },
  MenuItem: { new: vi.fn(async (opts: Record<string, unknown>) => resource("item", opts)) },
  PredefinedMenuItem: { new: vi.fn(async (opts: Record<string, unknown>) => resource("predefined", opts)) },
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class {
    constructor(
      readonly x: number,
      readonly y: number,
    ) {}
  },
}));

import { canShowNativeMenu, showNativeMenu } from "./nativeMenu";

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  created.length = 0;
});

describe("nativeMenu", () => {
  it("is available only inside Compose", () => {
    expect(canShowNativeMenu()).toBe(false);
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(canShowNativeMenu()).toBe(true);
  });

  it("creates each item as its own resource, sets a new group apart, shows it at the point, and runs the choice", async () => {
    const rename = vi.fn();
    const remove = vi.fn();
    await showNativeMenu(
      [
        { label: "Rename…", run: rename },
        { label: "Delete", run: remove, danger: true, startsGroup: true, enabled: false },
      ],
      { x: 10, y: 20 },
    );

    const [renameItem, separator, removeItem] = created.filter((made) => made.kind !== "menu");
    const menu = created.find((made) => made.kind === "menu")!;
    // Items handed to Menu.new as existing resources, never as inline options:
    // inline ones lose their click handler before the menu opens.
    expect(menu.opts.items).toEqual([renameItem, separator, removeItem]);
    expect(renameItem.opts).toMatchObject({ text: "Rename…", enabled: true });
    expect(separator.opts).toEqual({ item: "Separator" });
    expect(removeItem.opts.enabled).toBe(false);
    expect(menu.popup).toHaveBeenCalledWith(expect.objectContaining({ x: 10, y: 20 }));

    (renameItem.opts.action as (id: string) => void)(renameItem.opts.id as string);
    expect(rename).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("keeps a menu's items alive after it closes, and releases them when the next menu opens", async () => {
    await showNativeMenu([{ label: "A", run: vi.fn() }]);
    const first = [...created];
    expect(first.every((made) => made.close.mock.calls.length === 0)).toBe(true);

    await showNativeMenu([{ label: "B", run: vi.fn() }]);
    expect(first.every((made) => made.close.mock.calls.length === 1)).toBe(true);
    expect(created.slice(first.length).every((made) => made.close.mock.calls.length === 0)).toBe(true);
  });
});
