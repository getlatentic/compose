import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";

export interface BobAuthStatus {
  configured: boolean;
  errorMessage?: string;
}

export interface BobInstallStatus {
  errorMessage?: string;
  installed: boolean;
  path?: string;
  requiresDesktopRuntime?: boolean;
  version?: string;
  /** Node.js version (when known). Surfaced so the setup UI can
   * tell the user *why* bob isn't installable yet (e.g. "Node
   * 22.15+ required"). Populated by the browser-dev path; the
   * Tauri IPC will grow the same field. */
  nodeVersion?: string;
  /** True iff the detected Node satisfies bob's minimum. Drives
   * the "Install Node first" branch of the setup UI. */
  nodeSatisfies?: boolean;
  /** Bob's documented Node floor (currently "22.15.0"). Sent so
   * the UI doesn't have to hard-code the version string. */
  nodeMinVersion?: string;
}

/**
 * Browser-dev wire shape returned by `GET /api/bob/check`. Keep
 * in sync with `vite-plugins/bobReadiness.ts::BobReadinessSnapshot`.
 */
interface BrowserReadinessSnapshot {
  bob: { installed: boolean; version: string | null; path: string | null; error: string | null };
  node: { installed: boolean; version: string | null; satisfiesMin: boolean; minVersion: string };
  npm: { installed: boolean; version: string | null };
  auth: { configured: boolean; source: "env" | "keychain" | null };
  ready: boolean;
}

/**
 * Fetch + decode the browser-dev readiness snapshot. Cached for the
 * call window (auth + install are queried in parallel from
 * AppShell on boot) so we don't fire two HTTP requests for one
 * snapshot read.
 *
 * The cache resets on every call window — successive boots / manual
 * re-checks always fetch fresh state.
 */
let pendingReadiness: Promise<BrowserReadinessSnapshot | null> | null = null;
async function fetchBrowserReadiness(): Promise<BrowserReadinessSnapshot | null> {
  if (pendingReadiness) return pendingReadiness;
  pendingReadiness = (async () => {
    try {
      const response = await fetch("/api/bob/check", { method: "GET" });
      if (!response.ok) return null;
      return (await response.json()) as BrowserReadinessSnapshot;
    } catch {
      return null;
    } finally {
      // Clear the in-flight cache on the next microtask so a
      // second "force re-check" call lands fresh.
      queueMicrotask(() => {
        pendingReadiness = null;
      });
    }
  })();
  return pendingReadiness;
}

export interface BobRuntimeVerification {
  authenticated: boolean;
  errorMessage?: string;
  exitCode?: number;
  installed: boolean;
  path?: string;
  requiresDesktopRuntime?: boolean;
  stderrPreview?: string;
  stdoutPreview?: string;
  version?: string;
}

const DESKTOP_SETTINGS_REQUIRED =
  "Bob credentials and CLI checks require the Tauri desktop runtime.";

export async function getBobAuthStatus(): Promise<BobAuthStatus> {
  if (!isTauriRuntime()) {
    // Browser-dev: probe the Vite proxy. `auth.configured` is true
    // when the .env or keychain has a key — we never surface the
    // value itself, only the bool.
    const snapshot = await fetchBrowserReadiness();
    if (!snapshot) {
      return {
        configured: false,
        errorMessage: "Could not reach the bob proxy.",
      };
    }
    return {
      configured: snapshot.auth.configured,
      ...(snapshot.auth.configured
        ? {}
        : { errorMessage: "Connect your Bob API key in Settings." }),
    };
  }

  return invoke<BobAuthStatus>("settings_get_bob_auth_status");
}

export async function setBobApiKey(apiKey: string): Promise<BobAuthStatus> {
  if (!isTauriRuntime()) {
    // Browser-dev: POST the key to the Vite proxy, which writes it
    // to the OS keychain (macOS Keychain / libsecret / Windows
    // Credential Vault). The proxy never returns the value back —
    // success is just `{ ok: true, configured: true }`.
    const response = await fetch("/api/bob/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}) as { error?: string });
      throw new Error(payload?.error ?? `Could not save key (HTTP ${response.status}).`);
    }
    return { configured: true };
  }

  return invoke<BobAuthStatus>("settings_set_bob_api_key", { apiKey });
}

export async function checkBobInstall(): Promise<BobInstallStatus> {
  if (!isTauriRuntime()) {
    // Browser-dev: hit the Vite proxy's readiness endpoint and
    // adapt to BobInstallStatus. The adaptor surfaces *why* bob
    // isn't installed (no Node, wrong Node version, missing CLI)
    // so the setup UI can present the right next step.
    const snapshot = await fetchBrowserReadiness();
    if (!snapshot) {
      return {
        errorMessage: "Could not reach the bob proxy.",
        installed: false,
      };
    }
    const { bob, node } = snapshot;
    const installStatus: BobInstallStatus = {
      installed: bob.installed,
      nodeVersion: node.version ?? undefined,
      nodeSatisfies: node.satisfiesMin,
      nodeMinVersion: node.minVersion,
    };
    if (bob.version) installStatus.version = bob.version;
    if (bob.path) installStatus.path = bob.path;
    if (!bob.installed) {
      installStatus.errorMessage = !node.installed
        ? `Node.js ${node.minVersion}+ is required.`
        : !node.satisfiesMin
          ? `Node.js ${node.minVersion}+ is required (found ${node.version ?? "unknown"}).`
          : (bob.error ?? "Bob CLI not installed.");
    }
    return installStatus;
  }

  return invoke<BobInstallStatus>("settings_check_bob_install");
}

export async function verifyBobRuntime(): Promise<BobRuntimeVerification> {
  if (!isTauriRuntime()) {
    return {
      authenticated: false,
      errorMessage: DESKTOP_SETTINGS_REQUIRED,
      installed: false,
      requiresDesktopRuntime: true,
    };
  }

  return invoke<BobRuntimeVerification>("settings_verify_bob_runtime");
}
