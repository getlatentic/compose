import "katex/dist/katex.min.css";
import { useEffect } from "react";

import { AppRouter } from "./AppRouter";
import { ToastViewport } from "../features/toast/ToastViewport";
import { TextPromptProvider, useTextPrompt } from "../features/dialogs/TextPromptProvider";
import { LinkInsertProvider } from "../features/dialogs/LinkInsertProvider";
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
        <ImageEditAltListener />
        <ExternalFileOpenListener />
        <ToastViewport />
        <AppRouter />
      </LinkInsertProvider>
    </TextPromptProvider>
  );
}

function ExternalFileOpenListener() {
  useExternalFileOpen();
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
