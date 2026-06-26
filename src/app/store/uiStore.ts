import { create } from "zustand";
import { persistUiPrefs } from "../../lib/prefs/uiPrefs";
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
  analyticsEnabled: boolean;
  setAnalyticsEnabled: (enabled: boolean) => void;
  composerFocusNonce: number;
  requestComposerFocus: () => void;
  /** Monotonic nonce; the chat pane replays a border-pulse on each change. */
  chatPulseSignal: number;
  /** Reveal the chat pane and pulse its border (sidebar → open conversation). */
  pulseChatPanel: () => void;
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
  setSoundOnComplete: (enabled) => {
    set({ soundOnComplete: enabled });
    persistUiPrefs({ soundOnComplete: enabled, analyticsEnabled: get().analyticsEnabled });
  },
  analyticsEnabled: INITIAL_UI_PREFS.analyticsEnabled,
  setAnalyticsEnabled: (enabled) => {
    set({ analyticsEnabled: enabled });
    persistUiPrefs({ soundOnComplete: get().soundOnComplete, analyticsEnabled: enabled });
  },
  composerFocusNonce: 0,
  requestComposerFocus: () => {
    set((state) => ({ composerFocusNonce: state.composerFocusNonce + 1 }));
  },
  chatPulseSignal: 0,
  pulseChatPanel: () => {
    set((state) => ({ chatOpen: true, chatPulseSignal: state.chatPulseSignal + 1 }));
  },
}));
