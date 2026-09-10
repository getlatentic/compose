/**
 * When the document surface has drawn.
 *
 * The launch holds the window until the app is complete, and the surface is the
 * last part of it to arrive — CodeMirror constructs its view and then measures
 * on an animation frame. This is how the launch knows that has happened.
 *
 * Deferring the surface was tried and reverted: halving the eager bundle (3MB
 * to 1.4MB) did not move the launch at all, and it put a `React.lazy` second
 * commit back on the path for nothing.
 */

let announceMounted: () => void = () => {};
const mounted = new Promise<void>((resolve) => {
  announceMounted = resolve;
});

/** Never resolves in a launch with no document to draw, which is why callers
 *  race it against their own deadline. */
export function documentSurfaceReady(): Promise<void> {
  return mounted;
}

/** Called by the surface itself, before the paint that would show it. */
export function markDocumentSurfaceMounted(): void {
  announceMounted();
}
