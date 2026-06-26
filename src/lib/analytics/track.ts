/**
 * Anonymous active-user analytics via Aptabase (privacy-first, Tauri-native).
 * Fires one `app_launched` event per launch so active users can be counted — the
 * downloads number comes free from GitHub release stats, not from here.
 *
 * We call the Rust `tauri-plugin-aptabase` command directly with Tauri v2's
 * `invoke` rather than the `@aptabase/tauri` SDK: every published version of that
 * SDK targets Tauri v1 (it bundles `@tauri-apps/api@^1`, whose invoke is a no-op
 * under v2), so trackEvent silently failed. The plugin is registered ONLY when a
 * key is built in (COMPOSE_APTABASE_KEY) — that single Rust-side gate is the
 * source of truth: in an unconfigured build the command is absent, so the invoke
 * rejects and is swallowed. Routing the send through Rust also avoids any WebView
 * CORS / custom-scheme issues. The plugin manages the anonymous session id and
 * enriches with OS + app version; we never send note content, file names, paths,
 * or workspace names.
 */
import { invoke } from "@tauri-apps/api/core";

let launchTracked = false;

/** Fire the once-per-launch active-user signal. Idempotent within a session. */
export function trackAppLaunch(enabled: boolean): void {
  if (launchTracked || !enabled) {
    return;
  }
  launchTracked = true;
  // Fire-and-forget: swallow errors so no internet / no plugin (unconfigured
  // build) never breaks the app. The Rust plugin owns the send + retries.
  void invoke("plugin:aptabase|track_event", { name: "app_launched", props: null }).catch(
    () => {},
  );
}
