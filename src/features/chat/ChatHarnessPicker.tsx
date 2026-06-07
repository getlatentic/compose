import { Select, SelectItem } from "@carbon/react";

import { useWorkspaceStore } from "../../app/workspaceStore";
import type { HarnessInfo } from "../../lib/ipc/bobClient";

/**
 * Pure view for the in-composer harness switcher — props-driven so it's
 * trivially testable, with the store read isolated in the wrapper below.
 * Uses Carbon's inline `Select` so it matches the rest of the app's controls
 * (and the model/effort selects in Settings).
 *
 * Renders nothing when there's no catalog: the browser preview is bob-only
 * (`harness_list` is empty there), so there's nothing to switch between.
 */
export function ChatHarnessPickerView({
  harnesses,
  selectedId,
  onSelect,
  disabled = false,
}: {
  harnesses: HarnessInfo[];
  selectedId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  if (harnesses.length === 0) {
    return null;
  }

  return (
    <div className="bob-chat-toolbar">
      <Select
        id="chat-harness-picker"
        inline
        size="sm"
        labelText="Assistant"
        value={selectedId}
        // A run is bound to the harness that started it — can't switch mid-run.
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value)}
      >
        {harnesses.map((harness) => (
          <SelectItem key={harness.id} value={harness.id} text={harness.displayName} />
        ))}
      </Select>
    </div>
  );
}

/**
 * In-composer harness switcher — choose which AI assistant (harness) a run
 * uses, right from the chat, the way a chat UI lets you switch models. It
 * writes the *same* store state Settings does (`selectedHarnessId` via
 * `setSelectedHarness`), so the two stay in lockstep and the choice persists.
 *
 * Capability/readiness is deliberately not re-surfaced here: picking a
 * not-yet-set-up harness is allowed, and the composer's existing readiness
 * notice (for key-managed harnesses) or the first run's error (for
 * login-managed CLIs) guides setup — same as selecting it in Settings.
 */
export function ChatHarnessPicker({ disabled = false }: { disabled?: boolean }) {
  const harnessCatalog = useWorkspaceStore((state) => state.harnessCatalog);
  const selectedHarnessId = useWorkspaceStore((state) => state.selectedHarnessId);
  const setSelectedHarness = useWorkspaceStore((state) => state.setSelectedHarness);

  return (
    <ChatHarnessPickerView
      harnesses={harnessCatalog}
      selectedId={selectedHarnessId}
      onSelect={setSelectedHarness}
      disabled={disabled}
    />
  );
}
