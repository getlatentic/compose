import { isTauriRuntime } from "./desktopRuntime";

/**
 * Real macOS menus for right-click and dropdown menus: the system draws them,
 * so they have the system's type, row height, highlight and material, as in
 * Finder or Arc. Outside Compose (the browser dev build, tests) there is no
 * native menu, and callers show their HTML menu instead.
 */

export interface NativeMenuItem {
  readonly id: string;
  readonly label: string;
  readonly enabled?: boolean;
  /** Shown at the row's end, e.g. "CmdOrCtrl+N". Display only while the menu is open. */
  readonly accelerator?: string;
}

export type NativeMenuEntry = NativeMenuItem | "separator";

export interface MenuPoint {
  readonly x: number;
  readonly y: number;
}

export function canShowNativeMenu(): boolean {
  return isTauriRuntime();
}

/** Something on the Rust side that holds a menu or an item alive. */
interface MenuResource {
  close(): Promise<void>;
}

/** The last menu shown and its items, kept until the next one replaces them. */
let shown: MenuResource[] = [];

/**
 * Shows the menu at `at` (CSS pixels from the window's top-left; the pointer
 * when omitted) and calls `onSelect` with the chosen item's id. Resolves when
 * the menu has closed.
 *
 * Each item is created as its own resource rather than inline in `Menu.new`:
 * Tauri builds inline items as temporaries and their drop unregisters the
 * click handler before the menu even opens, so a choice would go nowhere.
 * They stay alive after the menu closes, since the choice arrives after
 * `popup` resolves, and are released when the next menu is shown.
 */
export async function showNativeMenu(
  entries: readonly NativeMenuEntry[],
  onSelect: (id: string) => void,
  at?: MenuPoint,
): Promise<void> {
  const [{ Menu, MenuItem, PredefinedMenuItem }, { LogicalPosition }] = await Promise.all([
    import("@tauri-apps/api/menu"),
    import("@tauri-apps/api/dpi"),
  ]);
  await releaseShown();
  const items = await Promise.all(
    entries.map((entry) =>
      entry === "separator"
        ? PredefinedMenuItem.new({ item: "Separator" })
        : MenuItem.new({ id: entry.id, text: entry.label, enabled: entry.enabled ?? true, accelerator: entry.accelerator, action: onSelect }),
    ),
  );
  const menu = await Menu.new({ items });
  shown = [menu, ...items];
  await menu.popup(at ? new LogicalPosition(at.x, at.y) : undefined);
}

async function releaseShown(): Promise<void> {
  const previous = shown;
  shown = [];
  await Promise.all(previous.map((resource) => resource.close().catch(() => undefined)));
}
