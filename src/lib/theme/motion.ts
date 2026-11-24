/**
 * Enter animations (a menu opening, a message arriving, a tab appearing) are
 * for things that change while someone watches. At launch everything mounts at
 * once, so `_motion.scss` gives them no duration until `data-motion="on"`,
 * set here once the first screen has been drawn.
 *
 * "Drawn" means frames, not time: the window stays hidden until the app is
 * ready and may open on another Space, and until a frame is drawn even a
 * zero-length animation has not run, so turning motion on then would start
 * every one of them. Animation frames only arrive once the window draws; two
 * of them, then a short settle, cover the first paint.
 */

const SETTLE_MS = 400;

export function enableMotionAfterLaunch(root: HTMLElement, win: Window = window): void {
  win.requestAnimationFrame(() =>
    win.requestAnimationFrame(() => win.setTimeout(() => root.setAttribute("data-motion", "on"), SETTLE_MS)),
  );
}
