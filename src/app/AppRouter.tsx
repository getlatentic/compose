import { useEffect, useState } from "react";
import { checkBobInstall, getBobAuthStatus } from "../lib/ipc/settingsClient";
import { getOnboarding, listWorkspaces } from "../lib/ipc/workspaceClient";
import { SetupScreen } from "../features/setup/SetupScreen";
import { SplashScreen } from "./SplashScreen";
import { MainApp } from "./MainApp";
import { useWorkspaceStore } from "./workspaceStore";
import { useHarnessStore } from "./store/harnessStore";

/**
 * Top-level screen router. Owns boot hydration and picks exactly one screen:
 * splash while the initial IPC fan-out resolves, the onboarding flow until
 * setup completes, otherwise the main app.
 *
 * It subscribes to only two things — `bootHydrated` (local) and
 * `onboardingComplete` — so document churn (every keystroke / chat token / fs
 * event) never re-renders it. And because `MainApp` only mounts once those two
 * settle, the main app's document subscriptions and effects don't exist during
 * splash/onboarding.
 */
export function AppRouter() {
  // Boot-time hydration gate. `loadSetupState` fans out 4 IPC calls (bob auth,
  // install probe, workspace list, onboarding flag) that take ~1s. Holding the
  // splash until they settle stops the cold-launch flash (SetupScreen → empty
  // workspace → real workspace) — the user sees the correct view first.
  const [bootHydrated, setBootHydrated] = useState(false);
  // Read the field, not `onboardingComplete()` — calling the method inside a
  // selector re-runs its body on every store mutation and masks future logic
  // changes behind a no-op re-render. Reading the boolean lets the store bail
  // cleanly when it doesn't change.
  const onboardingComplete = useWorkspaceStore((state) => Boolean(state.onboarding.completedAt));
  const hydrateWorkspaces = useWorkspaceStore((state) => state.hydrateWorkspaces);
  const setOnboarding = useWorkspaceStore((state) => state.setOnboarding);

  useEffect(() => {
    let cancelled = false;

    async function loadSetupState() {
      try {
        const [authStatus, installStatus, workspaceList, onboarding] = await Promise.all([
          getBobAuthStatus(),
          checkBobInstall(),
          listWorkspaces(),
          getOnboarding(),
        ]);
        if (cancelled) {
          return;
        }

        useHarnessStore.getState().setBobAuthStatus(authStatus);
        useHarnessStore.getState().setBobInstallStatus(installStatus);
        hydrateWorkspaces(workspaceList);
        setOnboarding(onboarding);
        // Flip the boot gate LAST, after every store hydration above has
        // committed — React batches the setters into one commit, then this
        // final setter is the trigger that releases the splash.
        setBootHydrated(true);
      } catch (error) {
        if (!cancelled) {
          useHarnessStore.getState().setBobAuthStatus({
            configured: false,
            errorMessage: error instanceof Error ? error.message : "Setup state could not be loaded",
          });
          // Release the gate even on error — otherwise an offline first launch
          // (IPC fails) would hang on the blank splash forever. The error banner
          // inside SetupScreen / SettingsPanel surfaces the failure.
          setBootHydrated(true);
        }
      }
    }

    void loadSetupState();
    // Load the harness capability catalog once — drives credential gating and
    // the per-harness options UI declaratively.
    void useHarnessStore.getState().loadHarnessCatalog();

    return () => {
      cancelled = true;
    };
  }, [hydrateWorkspaces, setOnboarding]);

  if (!bootHydrated) {
    return <SplashScreen />;
  }
  if (!onboardingComplete) {
    return <SetupScreen />;
  }
  return <MainApp />;
}
