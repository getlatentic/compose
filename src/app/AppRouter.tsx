import { useEffect, useState } from "react";
import { harnessReadiness } from "../lib/ipc/harnessClient";
import { getOnboarding, listWorkspaces } from "../lib/ipc/workspaceClient";
import { SetupScreen } from "../features/setup/SetupScreen";
import { SplashScreen } from "./SplashScreen";
import { MainApp } from "./MainApp";
import { useWorkspaceStore } from "./workspaceStore";
import { useHarnessStore } from "./store/harnessStore";
import { useUiStore } from "./store/uiStore";
import { trackAppLaunch } from "../lib/analytics/track";
import { markBoot } from "../lib/perf";

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
  // Boot-time hydration gate. `loadSetupState` fans out IPC calls (the selected
  // harness's readiness, workspace list, onboarding flag) that take ~1s. Holding
  // the splash until they settle stops the cold-launch flash (SetupScreen →
  // empty workspace → real workspace) — the user sees the correct view first.
  const [bootHydrated, setBootHydrated] = useState(false);
  // Read the field, not `onboardingComplete()` — calling the method inside a
  // selector re-runs its body on every store mutation and masks future logic
  // changes behind a no-op re-render. Reading the boolean lets the store bail
  // cleanly when it doesn't change.
  const onboardingComplete = useWorkspaceStore((state) => Boolean(state.onboarding.completedAt));
  const hydrateWorkspaces = useWorkspaceStore((state) => state.hydrateWorkspaces);
  const setOnboarding = useWorkspaceStore((state) => state.setOnboarding);
  const selectedHarnessId = useHarnessStore((state) => state.selectedHarnessId);
  const setSelectedHarnessReadiness = useHarnessStore((state) => state.setSelectedHarnessReadiness);

  useEffect(() => {
    let cancelled = false;

    async function loadSetupState() {
      try {
        // Don't block the splash on the harness readiness probe — the
        // [selectedHarnessId] effect below already runs it on mount, and the
        // editor doesn't need it to render. Gate only on the fast local reads
        // (workspaces + onboarding, both from app-support JSON).
        const [workspaceList, onboarding] = await Promise.all([
          listWorkspaces(),
          getOnboarding(),
        ]);
        if (cancelled) {
          return;
        }

        hydrateWorkspaces(workspaceList);
        setOnboarding(onboarding);
        // Flip the boot gate LAST, after every store hydration above has
        // committed — React batches the setters into one commit, then this
        // final setter is the trigger that releases the splash.
        markBoot("hydrated");
        setBootHydrated(true);
      } catch {
        if (!cancelled) {
          setSelectedHarnessReadiness(null);
          // Release the gate even on error — otherwise an offline first launch
          // (IPC fails) would hang on the blank splash forever. The error banner
          // inside SetupScreen / SettingsPanel surfaces the failure.
          setBootHydrated(true);
        }
      }
    }

    void loadSetupState();
    // Load the harness capability catalog once — drives credential gating and
    // the per-harness options UI declaratively — then, on a first run with no
    // agent chosen yet, derive the default from the first ready agent.
    void useHarnessStore
      .getState()
      .loadHarnessCatalog()
      .then(() => useHarnessStore.getState().resolveDefaultHarness());

    return () => {
      cancelled = true;
    };
  }, [hydrateWorkspaces, setOnboarding, setSelectedHarnessReadiness]);

  // Re-probe when the selected harness changes, so the send gate + setup state
  // track the new selection after a switch. The boot effect seeds the first
  // probe; this fires on every subsequent change.
  useEffect(() => {
    // No agent selected (first run, nothing ready) → nothing to probe; the
    // composer handles the "set up an agent" state.
    if (!selectedHarnessId) {
      setSelectedHarnessReadiness(null);
      return;
    }
    harnessReadiness(selectedHarnessId)
      .then(setSelectedHarnessReadiness)
      .catch(() => setSelectedHarnessReadiness(null));
  }, [selectedHarnessId, setSelectedHarnessReadiness]);

  // Once the boot gate releases, fire a single anonymous active-user signal — a
  // no-op unless the user left the analytics toggle on. Called directly from this
  // post-paint effect: requestIdleCallback proved unreliable in the macOS
  // WKWebView when the window isn't frontmost (it never fired, suppressing the
  // event). The work here is microseconds; the Rust plugin does the actual send.
  // getState() (not a selector) keeps it a one-shot read.
  useEffect(() => {
    if (!bootHydrated) {
      return;
    }
    trackAppLaunch(useUiStore.getState().analyticsEnabled);
  }, [bootHydrated]);

  if (!bootHydrated) {
    return <SplashScreen />;
  }
  if (!onboardingComplete) {
    return <SetupScreen />;
  }
  return <MainApp />;
}
