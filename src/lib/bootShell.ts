import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./runtime/desktopRuntime";

/**
 * Record the screen just drawn, for the next launch to open on.
 *
 * See `src-tauri/src/boot_shell.rs` and the inline script in `index.html`. The
 * markup is a picture, not state: nothing reads it back, and React replaces it
 * wholesale. So the only thing that matters is that it depicts the screen the
 * next launch will restore — which is why it is taken once the app has settled,
 * and again when what it shows has changed.
 */

/** Long enough that a burst of edits or a tab switch settles into one capture. */
const SETTLE_MS = 3000;

let timer: ReturnType<typeof setTimeout> | null = null;

/** Scroll offsets are DOM properties, not attributes, so serialising the markup
 *  loses them — and a tree or a document replayed at the top when it was left
 *  part-way down is exactly the jump this is meant to remove. Stamped just long
 *  enough to be serialised. */
function withScrollOffsets<T>(root: HTMLElement, take: () => T): T {
  const scrolled = Array.from(root.querySelectorAll<HTMLElement>("*")).filter(
    (element) => element.scrollTop > 0 || element.scrollLeft > 0,
  );
  for (const element of scrolled) {
    element.dataset.bootScroll = `${Math.round(element.scrollTop)},${Math.round(element.scrollLeft)}`;
  }
  try {
    return take();
  } finally {
    for (const element of scrolled) {
      delete element.dataset.bootScroll;
    }
  }
}

function captureNow(): void {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }
  const markup = withScrollOffsets(root, () => root.innerHTML);
  void invoke("boot_shell_store", { markup }).catch(() => {
    // A launch that cannot save its picture just takes the long way next time.
  });
}

/** Take a picture once things have been still for a moment. Safe to call often. */
export function scheduleBootShellCapture(): void {
  if (!isTauriRuntime()) {
    return;
  }
  if (timer) {
    clearTimeout(timer);
  }
  timer = setTimeout(captureNow, SETTLE_MS);
}
