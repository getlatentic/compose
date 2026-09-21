/**
 * Shortcuts in the form the Rust side registers — `Control+Alt+KeyN`: modifiers,
 * then a key named as `KeyboardEvent.code` names it.
 */

interface KeyPress {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Keys a global shortcut may end in: the ones the system can register, less
 *  those that already mean something everywhere (Esc, Tab, Return, Delete). */
const KEY = /^(Key[A-Z]|Digit\d|F\d{1,2}|Space|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|Arrow(Up|Down|Left|Right))$/;

/** macOS writes modifiers in this order, whatever order they were pressed in. */
const MODIFIERS = [
  { flag: "ctrlKey", name: "Control", symbol: "⌃" },
  { flag: "altKey", name: "Alt", symbol: "⌥" },
  { flag: "shiftKey", name: "Shift", symbol: "⇧" },
  { flag: "metaKey", name: "Super", symbol: "⌘" },
] as const;

const KEY_LABELS: Record<string, string> = {
  Space: "Space",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/**
 * The shortcut a key press makes, or `null` when it cannot be one: a global
 * shortcut needs ⌘, ⌃ or ⌥, since a bare key or ⇧-key would take over typing.
 */
export function shortcutFromKeyPress(press: KeyPress): string | null {
  if (!KEY.test(press.code)) return null;
  if (!press.metaKey && !press.ctrlKey && !press.altKey) return null;
  const modifiers = MODIFIERS.filter((modifier) => press[modifier.flag]).map((modifier) => modifier.name);
  return [...modifiers, press.code].join("+");
}

/** A shortcut as the menus write it: `Control+Alt+KeyN` → `⌃⌥N`. */
export function shortcutLabel(shortcut: string): string {
  const parts = shortcut.split("+");
  const key = parts[parts.length - 1] ?? "";
  const held = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));
  const symbols = MODIFIERS.filter((modifier) =>
    modifier.name === "Alt"
      ? held.has("alt") || held.has("option")
      : modifier.name === "Super"
        ? held.has("super") || held.has("cmd") || held.has("command")
        : held.has(modifier.name.toLowerCase()),
  ).map((modifier) => modifier.symbol);
  return symbols.join("") + keyLabel(key);
}

function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return KEY_LABELS[code] ?? code;
}
