import { reportClientError } from "../diagnostics/errorReporter";
import { isTauriRuntime } from "./desktopRuntime";

/**
 * Real macOS menus for right-click and dropdown menus: the system draws them,
 * so they have the system's type, row height, highlight and material, as in
 * Finder or Arc. Outside Compose (the browser dev build, tests) there is no
 * native menu, and callers show their HTML menu instead.
 */

/**
 * One row of a menu and what choosing it does. The same list draws the
 * native menu and the HTML one, so the two cannot drift apart.
 */
export interface MenuAction {
  readonly label: string;
  readonly run: () => void;
  readonly enabled?: boolean;
  /** Destructive: drawn in red in the HTML menu. */
  readonly danger?: boolean;
  /** Starts a new group, below a separator. */
  readonly startsGroup?: boolean;
  /** Shown at the row's end, e.g. "CmdOrCtrl+N". Display only while the menu is open. */
  readonly accelerator?: string;
}

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
 * Shows `actions` as a menu at `at` (CSS pixels from the window's top-left;
 * the pointer when omitted) and runs the one chosen. Resolves when the menu
 * has closed; a menu that cannot be shown is reported, never thrown.
 *
 * Each item is created as its own resource rather than inline in `Menu.new`:
 * Tauri builds inline items as temporaries and their drop unregisters the
 * click handler before the menu even opens, so a choice would go nowhere.
 * They stay alive after the menu closes, since the choice arrives after
 * `popup` resolves, and are released when the next menu is shown.
 */
export async function showNativeMenu(actions: readonly MenuAction[], at?: MenuPoint): Promise<void> {
  try {
    await popUp(actions, at);
  } catch (error) {
    await reportClientError("native-menu", "Could not show a menu", String(error));
  }
}

const ROW_ID = "context-menu-row-";

async function popUp(actions: readonly MenuAction[], at?: MenuPoint): Promise<void> {
  const [{ Menu, MenuItem, PredefinedMenuItem }, { LogicalPosition }] = await Promise.all([
    import("@tauri-apps/api/menu"),
    import("@tauri-apps/api/dpi"),
  ]);
  await releaseShown();
  const choose = (id: string) => actions[Number(id.slice(ROW_ID.length))]?.run();
  const rows = actions.flatMap((action, index) => [
    ...(index > 0 && action.startsGroup ? [PredefinedMenuItem.new({ item: "Separator" })] : []),
    MenuItem.new({
      id: `${ROW_ID}${index}`,
      text: action.label,
      enabled: action.enabled ?? true,
      accelerator: action.accelerator,
      action: choose,
    }),
  ]);
  const items = await Promise.all(rows);
  const menu = await Menu.new({ items });
  shown = [menu, ...items];
  await menu.popup(at ? new LogicalPosition(at.x, at.y) : undefined);
}

async function releaseShown(): Promise<void> {
  const previous = shown;
  shown = [];
  await Promise.all(previous.map((resource) => resource.close().catch(() => undefined)));
}
