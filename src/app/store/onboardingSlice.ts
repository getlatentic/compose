import type { WorkspaceState, WorkspaceStoreGet, WorkspaceStoreSet } from "./types";
import {
  type OnboardingState,
} from "../workspaceModel";

export const createOnboardingSlice = (
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
): Pick<WorkspaceState, "onboarding" | "onboardingComplete" | "setOnboarding"> => ({
  onboarding: {},
  onboardingComplete: () => Boolean(get().onboarding.completedAt),
  setOnboarding: (onboarding: OnboardingState) => {
    set({ onboarding });
  },
});
