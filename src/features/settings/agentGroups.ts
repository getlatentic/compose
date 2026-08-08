import type { HarnessInfo } from "../../lib/ipc/harnessClient";

/**
 * Which agent runs the work, and which endpoint serves the model, are two
 * different questions. The catalog answers them in one flat list, so Ollama
 * and OpenRouter sit beside Claude Code as if choosing between them were the
 * same kind of decision.
 *
 * It isn't. Picking Claude Code changes who does the work. Picking OpenRouter
 * over Ollama changes only where the tokens come from — same agent loop, same
 * tools, same everything except a base URL and which key it reads.
 *
 * This groups the catalog for display. The ids are untouched: a provider's
 * `HarnessInfo.id` stays exactly what the backend registered, because that id
 * is what starts a run.
 */

/** The built-in agent's display name — the one Compose ships rather than wraps. */
export const BUILT_IN_AGENT_NAME = "Compose";

/** Providers of the built-in agent. Each is one `OpenHarness` differing only
 *  in configuration. `custom:openai:*` is a user-added endpoint, same story. */
const BUILT_IN_PROVIDER_IDS = new Set(["ollama", "openrouter"]);

export function isBuiltInProvider(harnessId: string): boolean {
  return BUILT_IN_PROVIDER_IDS.has(harnessId) || harnessId.startsWith("custom:openai:");
}

/**
 * Whether a provider serves models from this machine. It is the only thing
 * about a provider worth permanent screen space: local means free, private,
 * and offline; hosted means paid and networked. Which vendor it is can live
 * one click away.
 */
export function isLocalProvider(harnessId: string): boolean {
  return harnessId === "ollama";
}

export interface AgentGroup<T> {
  /** Heading for the group. */
  label: string;
  /** True for the built-in agent, whose entries are providers, not agents. */
  builtIn: boolean;
  entries: T[];
}

/**
 * Split the catalog into the built-in agent's providers and the standalone
 * agents, preserving the backend's order within each. Registration order is
 * the recommendation order, so it must survive the grouping.
 *
 * Generic over anything carrying an `id`, so the settings list and the chat
 * footer group identically from one implementation. Two groupings that could
 * drift apart would be worse than none — the footer saying "Ollama" while the
 * chip says "Compose" is the exact confusion this removes.
 *
 * An empty provider set yields no built-in group, so a build without the
 * `openai-compatible` feature renders a plain agent list.
 */
export function groupAgents<T extends { id: string }>(catalog: T[]): AgentGroup<T>[] {
  const providers = catalog.filter((entry) => isBuiltInProvider(entry.id));
  const standalone = catalog.filter((entry) => !isBuiltInProvider(entry.id));

  const groups: AgentGroup<T>[] = [];
  if (providers.length > 0) {
    groups.push({ label: BUILT_IN_AGENT_NAME, builtIn: true, entries: providers });
  }
  if (standalone.length > 0) {
    groups.push({ label: "Other agents", builtIn: false, entries: standalone });
  }
  return groups;
}

/**
 * What the chat footer shows for the current selection: the model leads
 * because it is what people switch, the agent trails because it is sticky but
 * must stay visible — a run's cost and file access depend on it.
 *
 * A provider's own name is deliberately absent. Showing
 * `Compose / OpenRouter / claude-sonnet-4` spends three slots on a two-slot
 * decision; `local` carries the part that matters.
 */
export function selectionLabel(
  info: HarnessInfo | undefined,
  model: string | undefined,
): { agent: string; model: string | null; local: boolean } {
  if (!info) {
    return { agent: "No agent", model: null, local: false };
  }
  const builtIn = isBuiltInProvider(info.id);
  return {
    agent: builtIn ? BUILT_IN_AGENT_NAME : info.displayName,
    model: model?.trim() ? model.trim() : null,
    local: builtIn && isLocalProvider(info.id),
  };
}
