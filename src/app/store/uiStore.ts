import { create } from "zustand";
import { persistUiPrefs, pickUiPrefs, readPref, type UiPrefs } from "../../lib/prefs/uiPrefs";
import type { ReadingFont, ReadingSize } from "../../lib/theme/reading";
import type { ExportFont } from "../../lib/theme/exportFont";
import type { NoteBackground } from "../../lib/theme/noteBackground";
import type { EditorScheme, ThemeChoice } from "../../lib/theme/theme";
import { INITIAL_UI_PREFS } from "./initialPrefs";
import { useWorkspaceStore } from "../workspaceStore";

/**
 * Pure view state — pane visibility, sidebar, editor mode, modals, and small UI
 * nonces. A **standalone store** so toggling a pane never re-renders document
 * subscribers (file tree / editor), and editing never re-renders toggle-only
 * components. Document/conversation actions reach in via `useUiStore.getState()`
 * to reveal the chat pane etc. (workspace store → ui store).
 *
 * The one read back into the workspace store is `openChat`'s "is there a
 * workspace" guard — a runtime reference (never touched at module-eval), so the
 * two stores' mutual imports don't form a load-time cycle.
 *
 * Nav history is deliberately NOT here: it's co-written atomically with
 * `workspaces` and its actions drive document selection, so it lives in the
 * workspace store (see navSlice.ts).
 */
export type ResizablePane = "sidebar" | "chat";

export interface UiState {
  chatOpen: boolean;
  editorOpen: boolean;
  toggleEditor: () => void;
  toggleChat: () => void;
  openChat: () => void;
  closeChat: () => void;
  sidebarTab: "files" | "chat";
  setSidebarTab: (tab: "files" | "chat") => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  commentsOpen: boolean;
  toggleComments: () => void;
  openComments: () => void;
  closeComments: () => void;
  editorMode: "wysiwyg" | "source";
  toggleEditorMode: () => void;
  settingsOpen: boolean;
  /** When set, Settings opens straight to this agent's detail (a deep link from
   *  the chat "Set up" action); cleared on close. */
  settingsAgentId: string | null;
  openSettings: (agentId?: string) => void;
  closeSettings: () => void;
  soundOnComplete: boolean;
  setSoundOnComplete: (enabled: boolean) => void;
  /** Focus mode: sidebar + chat hidden, document centered. Persisted. */
  focusMode: boolean;
  toggleFocusMode: () => void;
  /** Formatting buttons above the note folded away. Persisted. */
  formatBarCollapsed: boolean;
  toggleFormatBar: () => void;
  /** User-dragged pane widths; null = default. Committed on drag
   *  release, never per-move (the splitter writes the CSS var directly). */
  sidebarWidthPx: number | null;
  chatWidthPx: number | null;
  setPaneWidth: (pane: ResizablePane, widthPx: number | null) => void;
  analyticsEnabled: boolean;
  setAnalyticsEnabled: (enabled: boolean) => void;
  composerFocusNonce: number;
  requestComposerFocus: () => void;
  /** Monotonic nonce; the chat pane replays a border-pulse on each change. */
  chatPulseSignal: number;
  /** Reveal the chat pane and pulse its border (sidebar → open conversation). */
  pulseChatPanel: () => void;
  /** Interface scale (⌘+ / ⌘− / ⌘0); 1 leaves the system text size alone. */
  zoom: number;
  setZoom: (scale: number) => void;
  /** Light, dark, or follow the system. */
  theme: ThemeChoice;
  setTheme: (choice: ThemeChoice) => void;
  palette: string;
  setPalette: (id: string) => void;
  readingFont: ReadingFont;
  setReadingFont: (font: ReadingFont) => void;
  readingSize: ReadingSize;
  setReadingSize: (size: ReadingSize) => void;
  /** An installed font; choosing one also selects the "custom" reading font. */
  customFont: string | null;
  setCustomFont: (family: string) => void;
  exportFont: ExportFont;
  setExportFont: (font: ExportFont) => void;
  noteBackground: NoteBackground;
  setNoteBackground: (background: NoteBackground) => void;
  /** Hands the note's font and background back to the theme. */
  resetToTheme: () => void;
  editorScheme: EditorScheme;
  setEditorScheme: (scheme: EditorScheme) => void;
}

type StoreSet = (partial: Partial<UiState>) => void;

/**
 * Write preferences to the store and to disk. Each value is checked by its
 * reader on the way in; one that would not change anything writes nothing.
 */
function savePrefs(set: StoreSet, get: () => UiState, changes: Partial<UiPrefs>): void {
  const current = get();
  const next: Partial<UiPrefs> = {};
  let changed = false;
  for (const key of Object.keys(changes) as (keyof UiPrefs)[]) {
    const value = readPref(key, changes[key]);
    if (Object.is(value, current[key])) continue;
    (next as Record<keyof UiPrefs, unknown>)[key] = value;
    changed = true;
  }
  if (!changed) return;
  set(next);
  persistUiPrefs(pickUiPrefs(get()));
}

export const useUiStore = create<UiState>((set, get) => ({
  chatOpen: true,
  editorOpen: true,
  toggleEditor: () => {
    set((state) => {
      // At least one of editor/chat must stay visible — hiding the editor
      // while chat is also closed would leave an empty workspace, so that
      // toggle is a no-op (the button is disabled in this state too).
      if (state.editorOpen && !state.chatOpen) {
        return {};
      }
      return { editorOpen: !state.editorOpen };
    });
  },
  toggleChat: () => {
    if (get().chatOpen) {
      // Symmetric to toggleEditor: never hide the last visible pane. With the
      // editor also closed, closing chat would empty the workspace — no-op.
      if (!get().editorOpen) {
        return;
      }
      set({ chatOpen: false });
      return;
    }
    get().openChat();
  },
  openChat: () => {
    // Only meaningful with an active workspace — preserves the prior guard.
    if (!useWorkspaceStore.getState().activeWorkspace()) {
      return;
    }
    set({ chatOpen: true });
  },
  closeChat: () => {
    set({ chatOpen: false });
  },
  sidebarTab: "files",
  setSidebarTab: (tab) => {
    set({ sidebarTab: tab });
  },
  sidebarCollapsed: false,
  toggleSidebar: () => {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
  },
  searchOpen: false,
  openSearch: () => set({ searchOpen: true }),
  closeSearch: () => set({ searchOpen: false }),
  // Comments panel starts hidden — opens on demand via the header toggle.
  commentsOpen: false,
  toggleComments: () => {
    set((state) => ({ commentsOpen: !state.commentsOpen }));
  },
  openComments: () => {
    set({ commentsOpen: true });
  },
  closeComments: () => {
    set({ commentsOpen: false });
  },
  editorMode: "wysiwyg",
  toggleEditorMode: () => {
    set((state) => ({
      editorMode: state.editorMode === "wysiwyg" ? "source" : "wysiwyg",
    }));
  },
  settingsOpen: false,
  settingsAgentId: null,
  // Settings always opens as a modal (the SettingsDialog), reachable from any
  // state — there is no longer a Settings-as-a-tab path. An optional agent id
  // deep-links to that agent's detail (the chat "Set up" action).
  openSettings: (agentId) => set({ settingsOpen: true, settingsAgentId: agentId ?? null }),
  closeSettings: () => set({ settingsOpen: false, settingsAgentId: null }),
  soundOnComplete: INITIAL_UI_PREFS.soundOnComplete,
  setSoundOnComplete: (enabled) => savePrefs(set, get, { soundOnComplete: enabled }),
  analyticsEnabled: INITIAL_UI_PREFS.analyticsEnabled,
  setAnalyticsEnabled: (enabled) => savePrefs(set, get, { analyticsEnabled: enabled }),
  focusMode: INITIAL_UI_PREFS.focusMode,
  toggleFocusMode: () => savePrefs(set, get, { focusMode: !get().focusMode }),
  formatBarCollapsed: INITIAL_UI_PREFS.formatBarCollapsed,
  toggleFormatBar: () => savePrefs(set, get, { formatBarCollapsed: !get().formatBarCollapsed }),
  sidebarWidthPx: INITIAL_UI_PREFS.sidebarWidthPx,
  chatWidthPx: INITIAL_UI_PREFS.chatWidthPx,
  setPaneWidth: (pane, widthPx) =>
    savePrefs(set, get, pane === "sidebar" ? { sidebarWidthPx: widthPx } : { chatWidthPx: widthPx }),
  composerFocusNonce: 0,
  requestComposerFocus: () => {
    set((state) => ({ composerFocusNonce: state.composerFocusNonce + 1 }));
  },
  chatPulseSignal: 0,
  pulseChatPanel: () => {
    set((state) => ({ chatOpen: true, chatPulseSignal: state.chatPulseSignal + 1 }));
  },
  theme: INITIAL_UI_PREFS.theme,
  setTheme: (choice) => savePrefs(set, get, { theme: choice }),
  palette: INITIAL_UI_PREFS.palette,
  setPalette: (id) => savePrefs(set, get, { palette: id }),
  readingFont: INITIAL_UI_PREFS.readingFont,
  setReadingFont: (font) => savePrefs(set, get, { readingFont: font }),
  readingSize: INITIAL_UI_PREFS.readingSize,
  setReadingSize: (size) => savePrefs(set, get, { readingSize: size }),
  customFont: INITIAL_UI_PREFS.customFont,
  setCustomFont: (family) => {
    if (readPref("customFont", family) === null) return;
    savePrefs(set, get, { customFont: family, readingFont: "custom" });
  },
  exportFont: INITIAL_UI_PREFS.exportFont,
  setExportFont: (font) => savePrefs(set, get, { exportFont: font }),
  noteBackground: INITIAL_UI_PREFS.noteBackground,
  setNoteBackground: (background) => savePrefs(set, get, { noteBackground: background }),
  resetToTheme: () => savePrefs(set, get, { readingFont: "theme", noteBackground: { kind: "theme" }, editorScheme: "app" }),
  editorScheme: INITIAL_UI_PREFS.editorScheme,
  setEditorScheme: (scheme) => savePrefs(set, get, { editorScheme: scheme }),
  zoom: INITIAL_UI_PREFS.zoom,
  setZoom: (scale) => savePrefs(set, get, { zoom: scale }),
}));
