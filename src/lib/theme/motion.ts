/**
 * Enter animations (a menu opening, a message arriving, a tab appearing) are
 * for things that change while someone watches. At launch everything mounts at
 * once, so `_motion.scss` gives them no duration until `data-motion="on"`,
 * set here once the first screen has had time to paint.
 */

const SETTLE_MS = 600;

export function enableMotionAfterLaunch(root: HTMLElement, win: Window = window): void {
  const enable = () => win.setTimeout(() => root.setAttribute("data-motion", "on"), SETTLE_MS);
  if (win.document.readyState === "complete") {
    enable();
  } else {
    win.addEventListener("load", enable, { once: true });
  }
}
