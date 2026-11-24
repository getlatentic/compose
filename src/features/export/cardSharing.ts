import { copyCardImage, shareCardImage, type CardSpec, type ShareAnchor } from "../../lib/ipc/cardExportClient";
import { showToast } from "../toast/toastStore";

/**
 * What the image dialog's sharing buttons do, apart from the dialog: copy the
 * card, open the Mac's share sheet, or start a post on X with the card on the
 * clipboard (X's web composer takes a pasted image; a link cannot carry one).
 */

function failed(title: string, error: unknown): void {
  showToast({ kind: "error", title, message: error instanceof Error ? error.message : String(error) });
}

export async function copyCard(spec: CardSpec): Promise<boolean> {
  try {
    await copyCardImage(spec);
    showToast({ kind: "success", title: "Image copied", message: "Paste it into a post, a message or a document." });
    return true;
  } catch (error) {
    failed("Could not copy the image", error);
    return false;
  }
}

export async function shareCard(spec: CardSpec, fileName: string, anchor: ShareAnchor): Promise<void> {
  try {
    await shareCardImage(spec, fileName, anchor);
  } catch (error) {
    failed("Could not share the image", error);
  }
}

/**
 * X's composer, empty: the writer adds their own words, and a note's title
 * never lands in the browser's history.
 */
export const X_COMPOSE_URL = "https://x.com/intent/post";

export async function postCardOnX(spec: CardSpec): Promise<void> {
  try {
    await copyCardImage(spec);
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(X_COMPOSE_URL);
    showToast({ kind: "info", title: "Image copied", message: "Paste it into your post with ⌘V.", timeoutMs: 10000 });
  } catch (error) {
    failed("Could not start the post", error);
  }
}
