import { create } from "zustand";
import { type WorkspaceState } from "./store/types";
import { createLifecycleSlice } from "./store/lifecycleSlice";
import { createFilesSlice } from "./store/filesSlice";
import { createLooseFilesSlice } from "./store/looseFilesSlice";
import { createFsEventsSlice } from "./store/fsEventsSlice";
import { createCommentsSlice } from "./store/commentsSlice";
import { createChatSlice } from "./store/chatSlice";
import { createConversationsSlice } from "./store/conversationsSlice";
import { createNavSlice } from "./store/navSlice";
import { createOnboardingSlice } from "./store/onboardingSlice";

// Public surface preserved for existing importers of this module.
export type { HarnessRunOptions, NavEntry } from "./store/types";
export {
  editGuardFor,
  harnessCapabilitiesOf,
  harnessExtraArgs,
  supportsPermissionMode,
} from "./store/harnessConfig";
export { reviewChangeToDraft } from "./store/reviewFlow";

/**
 * The window-local workspace store. Its state is split into focused slices
 * under ./store — each `create*Slice(set, get)` returns one concern's actions,
 * all sharing the same `set`/`get` so cross-slice calls (e.g. saveActiveFile →
 * rebuildWorkspaceIndex) work. See docs/workspace-store-split.md.
 */
export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...createLifecycleSlice(set, get),
  ...createFilesSlice(set, get),
  ...createLooseFilesSlice(set, get),
  ...createFsEventsSlice(set, get),
  ...createCommentsSlice(set, get),
  ...createChatSlice(set, get),
  ...createConversationsSlice(set, get),
  ...createNavSlice(set, get),
  ...createOnboardingSlice(set, get),
}));
