import { useEffect } from "react";

import { AppRouter } from "./AppRouter";
import { ToastViewport } from "../features/toast/ToastViewport";
import { UpdateBanner } from "../features/updater/UpdateBanner";
import { useUpdaterStore } from "./store/updaterStore";
import { TextPromptProvider } from "../features/dialogs/TextPromptProvider";
import { LinkInsertProvider } from "../features/dialogs/LinkInsertProvider";
import { ConfirmProvider } from "../features/dialogs/ConfirmProvider";
import { RenameProvider } from "../features/dialogs/RenameProvider";
import { markBoot } from "../lib/perf";
import { useAppTheme } from "../features/shared/useAppTheme";
import { useAppZoom } from "../features/shared/useAppZoom";

export function App() {
  // At the root, not in MainApp: ⌘+ has to work on the setup screen too — the
  // person most likely to need it is the one who can't read the setup screen.
  // Same for the theme, which the setup screen should honour as well.
  useAppTheme();
  useAppZoom();
  useEffect(() => {
    markBoot("shell");
  }, []);
  return (
    <TextPromptProvider>
      <LinkInsertProvider>
        <ConfirmProvider>
          <RenameProvider>
            <UpdateChecker />
            <ToastViewport />
            <UpdateBanner />
            <AppRouter />
          </RenameProvider>
        </ConfirmProvider>
      </LinkInsertProvider>
    </TextPromptProvider>
  );
}

/** Quietly check for an update shortly after launch — off the launch path so it
 *  never delays first paint, and silent on failure (see `updaterStore.check`).
 *  A found update surfaces through {@link UpdateBanner}. */
function UpdateChecker() {
  const check = useUpdaterStore((state) => state.check);
  useEffect(() => {
    const timer = window.setTimeout(() => void check(), 4000);
    return () => window.clearTimeout(timer);
  }, [check]);
  return null;
}

