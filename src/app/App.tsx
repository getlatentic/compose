import "katex/dist/katex.min.css";
import { useEffect } from "react";

import { AppRouter } from "./AppRouter";
import { ToastViewport } from "../features/toast/ToastViewport";
import { UpdateBanner } from "../features/updater/UpdateBanner";
import { useUpdaterStore } from "./store/updaterStore";
import { TextPromptProvider, useTextPrompt } from "../features/dialogs/TextPromptProvider";
import { LinkInsertProvider } from "../features/dialogs/LinkInsertProvider";
import { ConfirmProvider } from "../features/dialogs/ConfirmProvider";
import { RenameProvider } from "../features/dialogs/RenameProvider";
import {
  IMAGE_EDIT_ALT_EVENT,
  type ImageEditAltEventDetail,
} from "ai-editor";
import { useExternalFileOpen } from "../features/workspace/useExternalFileOpen";
import { markBoot } from "../lib/perf";

export function App() {
  useEffect(() => {
    markBoot("shell");
  }, []);
  return (
    <TextPromptProvider>
      <LinkInsertProvider>
        <ConfirmProvider>
          <RenameProvider>
            <ImageEditAltListener />
            <ExternalFileOpenListener />
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

function ExternalFileOpenListener() {
  useExternalFileOpen();
  return null;
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

function ImageEditAltListener() {
  const promptText = useTextPrompt();
  useEffect(function bindImageEditAltListener() {
    function onEdit(event: Event) {
      const detail = (event as CustomEvent<ImageEditAltEventDetail>).detail;
      void (async () => {
        const newAlt = await promptText({
          title: "Edit image alt text",
          label: "Alt text",
          defaultValue: detail.currentAlt,
          allowEmpty: true,
        });
        if (newAlt === null) return;
        const next = `![${newAlt}](${detail.rawSrc})`;
        detail.view.dispatch({
          changes: { from: detail.sourceFrom, to: detail.sourceTo, insert: next },
          userEvent: "input.edit.image-alt",
        });
      })();
    }
    window.addEventListener(IMAGE_EDIT_ALT_EVENT, onEdit);
    return function unbind() {
      window.removeEventListener(IMAGE_EDIT_ALT_EVENT, onEdit);
    };
  }, [promptText]);
  return null;
}
