import { FormEvent, useEffect, useRef, useState } from "react";

import { useHarnessStore } from "../../app/store/harnessStore";
import {
  harnessCredentialStatus,
  harnessInstall,
  harnessLogin,
  harnessReadiness,
  harnessSetCredential,
  verifyHarnessRuntime,
  type HarnessInstallEvent,
  type HarnessReadiness,
  type HarnessRuntimeVerification,
} from "../../lib/ipc/harnessClient";
import type { InstallLogEntry } from "./agentConfigControls";

/**
 * Setup actions for one agent's detail screen — install, OAuth sign-in, a
 * managed key save, and the runtime smoke-test — each streaming its progress
 * and re-probing readiness on completion. Scoped to `harnessId` (the opened
 * agent, not necessarily the active one); when it *is* the active agent, a fresh
 * readiness probe is mirrored into the store so the chat send-gate stays in sync.
 */
export function useHarnessSetup(harnessId: string) {
  const selectedHarnessId = useHarnessStore((state) => state.selectedHarnessId);
  const setSelectedHarnessReadiness = useHarnessStore((state) => state.setSelectedHarnessReadiness);

  const [readiness, setReadiness] = useState<HarnessReadiness | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<InstallLogEntry[]>([]);
  const [installResult, setInstallResult] = useState<
    Extract<HarnessInstallEvent, { kind: "done" }> | null
  >(null);
  const [signingIn, setSigningIn] = useState(false);
  const [checkingRuntime, setCheckingRuntime] = useState(false);
  const [runtimeCheck, setRuntimeCheck] = useState<HarnessRuntimeVerification | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [managedKeyConfigured, setManagedKeyConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [installLog.length]);

  const applyReadiness = (next: HarnessReadiness | null) => {
    setReadiness(next);
    if (harnessId === selectedHarnessId) {
      setSelectedHarnessReadiness(next);
    }
  };
  const refreshReadiness = async () => {
    applyReadiness(await harnessReadiness(harnessId).catch(() => null));
  };

  // Probe readiness + managed-key status whenever the opened agent changes, and
  // clear any per-agent setup state left over from the previous one.
  useEffect(() => {
    let active = true;
    setReadiness(null);
    setInstallLog([]);
    setInstallResult(null);
    setRuntimeCheck(null);
    setApiKey("");
    setError(null);
    void harnessReadiness(harnessId)
      .then((next) => {
        if (!active) return;
        setReadiness(next);
        if (harnessId === selectedHarnessId) setSelectedHarnessReadiness(next);
      })
      .catch(() => {
        if (active) setReadiness(null);
      });
    void harnessCredentialStatus(harnessId)
      .then((status) => {
        if (active) setManagedKeyConfigured(status.configured);
      })
      .catch(() => {
        if (active) setManagedKeyConfigured(false);
      });
    return () => {
      active = false;
    };
  }, [harnessId, selectedHarnessId, setSelectedHarnessReadiness]);

  async function install() {
    setInstalling(true);
    setInstallLog([]);
    setInstallResult(null);
    setError(null);
    try {
      for await (const event of harnessInstall(harnessId)) {
        setInstallLog((prev) => [...prev, { kind: event.kind, text: "text" in event ? event.text : "" }]);
        if (event.kind === "done") {
          setInstallResult(event);
          await refreshReadiness();
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Install failed");
    } finally {
      setInstalling(false);
    }
  }

  // OAuth sign-in (Claude/Codex). The CLI opens the browser; we stream its
  // progress, then re-probe so the status flips "Needs sign-in" → "Ready".
  async function signIn() {
    setSigningIn(true);
    setInstallLog([]);
    setError(null);
    try {
      for await (const event of harnessLogin(harnessId)) {
        if (event.kind !== "done" && "text" in event && event.text) {
          setInstallLog((prev) => [...prev, { kind: event.kind, text: event.text }]);
        }
        if (event.kind === "done" && !event.ok) {
          setError("Sign-in didn't complete. Try again, or finish it in your browser.");
        }
      }
      await refreshReadiness();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed");
    } finally {
      setSigningIn(false);
    }
  }

  async function saveManagedKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaveSuccess(false);
    setSaving(true);
    try {
      await harnessSetCredential(harnessId, apiKey);
      await refreshReadiness();
      setManagedKeyConfigured((await harnessCredentialStatus(harnessId)).configured);
      setApiKey("");
      setRuntimeCheck(null);
      setSaveSuccess(true);
      window.setTimeout(() => setSaveSuccess(false), 4000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "API key could not be saved");
    } finally {
      setSaving(false);
    }
  }

  async function runRuntimeCheck() {
    setCheckingRuntime(true);
    setError(null);
    try {
      const result = await verifyHarnessRuntime(harnessId);
      setRuntimeCheck(result);
      await refreshReadiness();
    } catch (caught) {
      setRuntimeCheck(null);
      setError(caught instanceof Error ? caught.message : "Runtime check failed");
    } finally {
      setCheckingRuntime(false);
    }
  }

  return {
    readiness,
    refreshReadiness,
    installing,
    installLog,
    installResult,
    logRef,
    install,
    signingIn,
    signIn,
    checkingRuntime,
    runtimeCheck,
    runRuntimeCheck,
    apiKey,
    setApiKey,
    saving,
    saveSuccess,
    managedKeyConfigured,
    saveManagedKey,
    error,
  };
}
