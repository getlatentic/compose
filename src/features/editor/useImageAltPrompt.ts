import { useEffect } from "react";
import {
  IMAGE_EDIT_ALT_EVENT,
  type ImageEditAltEventDetail,
} from "@latentic/live-markdown";

import { useTextPrompt } from "../dialogs/TextPromptProvider";

/**
 * "Edit alt text" on an image: the editor dispatches the event, this asks for
 * the new text and writes it back through the same view.
 *
 * Bound from the document surface rather than the app root so the launch bundle
 * doesn't carry the editor package for one event name — nothing can dispatch
 * this until an editor is mounted anyway.
 */
export function useImageAltPrompt(): void {
  const promptText = useTextPrompt();
  useEffect(
    function bindImageEditAltListener() {
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
          detail.view.dispatch({
            changes: {
              from: detail.sourceFrom,
              to: detail.sourceTo,
              insert: `![${newAlt}](${detail.rawSrc})`,
            },
            userEvent: "input.edit.image-alt",
          });
        })();
      }
      window.addEventListener(IMAGE_EDIT_ALT_EVENT, onEdit);
      return function unbind() {
        window.removeEventListener(IMAGE_EDIT_ALT_EVENT, onEdit);
      };
    },
    [promptText],
  );
}
