/**
 * Tiny perf helper for User Timing marks + measures. See
 * `docs/perf-spec.md` §8 for the rule: only mark named code paths that
 * the Inspector labels generically; rely on Safari Web Inspector
 * Timelines for everything else.
 *
 * Gated by `__COMPOSE_PERF__` — a build-time constant injected via
 * `vite.config.ts > define` from the `COMPOSE_PERF=1` env var on
 * `pnpm tauri build`. In a normal release build this is `false`, the
 * `if` falls through, and the marks tree-shake away — zero bytes of
 * perf code reach the user. Symmetric with the Rust-side
 * `COMPOSE_DEVTOOLS=1` gate.
 *
 * A typical perf session uses both:
 *   COMPOSE_DEVTOOLS=1 COMPOSE_PERF=1 pnpm tauri build
 */

export function perfMark(label: string): void {
  if (!__COMPOSE_PERF__) return;
  performance.mark(label);
}

export function perfMeasure(label: string, start: string, end: string): number | null {
  if (!__COMPOSE_PERF__) return null;
  try {
    performance.measure(label, start, end);
    const entries = performance.getEntriesByName(label);
    const last = entries[entries.length - 1];
    return last ? last.duration : null;
  } catch {
    return null;
  }
}

/**
 * Boot-phase timeline. Each call logs `performance.now()` — ms since the
 * WebView document started — for one named phase, so a COMPOSE_PERF build
 * prints the JS-boot breakdown to the console:
 *
 *   entry  → time to fetch+parse+compile the boot bundle (everything before
 *            the first executed line: the shell entry + its static vendors).
 *   render → just before React mounts (delta from `entry` ≈ module-exec).
 *   shell  → the shell tree committed (delta ≈ React's first render); the
 *            lazy editor is still a Suspense fallback at this point.
 *   editor → the lazy EditorRegion chunk loaded + its EditorView mounted
 *            (delta from `shell` = the deferred editor cost).
 *
 * Tree-shakes to nothing in release (the `__COMPOSE_PERF__` guard).
 */
export function markBoot(phase: string): void {
  if (!__COMPOSE_PERF__) return;
  const now = performance.now();
  performance.mark(`boot:${phase}`);
  // eslint-disable-next-line no-console
  console.log(`[perf] boot:${phase} @ ${now.toFixed(0)}ms`);
}

/**
 * Tab-switch latency tracker. The two halves of the measurement live
 * in different components (the tab strip dispatches the click; the
 * editor commits the new value), so we coordinate via a counter
 * instead of passing context through React props.
 */
let tabSwitchSeq = 0;
let tabSwitchPending = 0;

export function markTabSwitchStart(): void {
  if (!__COMPOSE_PERF__) return;
  tabSwitchSeq += 1;
  tabSwitchPending = tabSwitchSeq;
  performance.mark(`tab-switch:start-${tabSwitchPending}`);
}

export function markTabSwitchEnd(): void {
  if (!__COMPOSE_PERF__) return;
  if (tabSwitchPending === 0) return;
  const seq = tabSwitchPending;
  tabSwitchPending = 0;
  performance.mark(`tab-switch:end-${seq}`);
  const ms = perfMeasure(
    `tab-switch-${seq}`,
    `tab-switch:start-${seq}`,
    `tab-switch:end-${seq}`,
  );
  if (ms !== null) {
    // eslint-disable-next-line no-console
    console.log(`[perf] tab-switch = ${ms.toFixed(1)}ms`);
  }
}
