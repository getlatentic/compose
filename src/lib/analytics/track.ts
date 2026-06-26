/**
 * Anonymous active-user analytics via Aptabase (privacy-first, Tauri-native).
 * Fires one `app_launched` event per launch so active users can be counted — the
 * downloads number comes free from GitHub release stats, not from here.
 *
 * The event is fired here but SENT by the Rust `tauri-plugin-aptabase` (registered
 * in lib.rs only when COMPOSE_APTABASE_KEY is built in), so the network call
 * leaves from Rust — no WebView CORS / custom-scheme issues. Two gates: the user's
 * opt-out toggle, and `__APTABASE_CONFIGURED__` (false in dev / unconfigured builds
 * → no IPC at all). Aptabase manages the anonymous session id and enriches with OS
 * + app version; we never send note content, file names, paths, or workspace names.
 */
import { trackEvent } from "@aptabase/tauri";

export function shouldTrack(input: { enabled: boolean; configured: boolean }): boolean {
  return input.enabled && input.configured;
}

let launchTracked = false;

/** Fire the once-per-launch active-user signal. Idempotent within a session;
 *  a no-op when the user opted out or no Aptabase key was built in. */
export function trackAppLaunch(enabled: boolean): void {
  if (launchTracked || !shouldTrack({ enabled, configured: __APTABASE_CONFIGURED__ })) {
    return;
  }
  // Skip when clearly offline: nothing is enqueued, so the plugin's own blocking
  // flush-on-exit stays a no-op (empty queue) and can never delay quit. Online
  // sends — including the plugin's exit flush for short sessions — go via Rust.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return;
  }
  launchTracked = true;
  // Fire-and-forget: the Rust plugin owns the send + retries, so a rejection here
  // (transient error, unconfigured build) is safe to swallow.
  void trackEvent("app_launched").catch(() => {});
}
