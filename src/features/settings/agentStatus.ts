import type { HarnessInfo, HarnessReadiness } from "../../lib/ipc/harnessClient";

export type AgentStatusKind =
  | "ready"
  | "notInstalled"
  | "needsSignIn"
  | "needsKey"
  | "notRunning";

/**
 * The setup the status invites, if any — drives the inline action button.
 * Installing is not among them: Compose runs agents, it does not install them,
 * so a missing agent shows its `installHint` instead of a button.
 */
export type AgentStatusAction = "signIn" | "addKey";

/** Semantic colour, mapped to a concrete Tag type by the view. */
export type AgentStatusTone = "success" | "info" | "warning" | "neutral";

export interface AgentStatus {
  kind: AgentStatusKind;
  label: string;
  tone: AgentStatusTone;
  action?: AgentStatusAction;
}

/**
 * An agent's display status, from its declared capabilities and a readiness
 * probe. Capability-driven so each "not ready" reason maps to the setup it
 * actually needs: an OAuth sign-in (Claude/Codex), an API key (OpenRouter), a
 * missing agent the user installs themselves, or just a local server that isn't
 * up (Ollama, a custom ACP command). A local agent has no account, so it is
 * never told to "sign in" — the bug this replaces, where any
 * installed-but-not-ready agent showed "Needs sign-in" regardless of how it
 * authenticates.
 */
export function agentStatus(info: HarnessInfo, readiness: HarnessReadiness | null): AgentStatus {
  if (readiness?.ready) {
    return { kind: "ready", label: "Ready", tone: "success" };
  }
  const installed = readiness?.installed ?? false;
  // A missing agent outranks its auth state: telling someone to sign in to
  // something they don't have yet is the wrong next step.
  if (!installed && info.installHint) {
    return { kind: "notInstalled", label: "Not installed", tone: "neutral" };
  }
  if (info.capabilities.supportsLogin) {
    return { kind: "needsSignIn", label: "Needs sign-in", tone: "info", action: "signIn" };
  }
  if (info.capabilities.credentialRequired) {
    return { kind: "needsKey", label: "Add a key", tone: "info", action: "addKey" };
  }
  return { kind: "notRunning", label: "Not running", tone: "warning" };
}

/** Map a status tone to a Carbon `Tag` colour. Ready reads green, an actionable
 *  setup (sign-in / key) blue, everything else neutral. */
export function statusTagType(tone: AgentStatusTone): "green" | "blue" | "warm-gray" {
  return tone === "success" ? "green" : tone === "info" ? "blue" : "warm-gray";
}
