import {
  harnessCapabilitiesOf,
  useWorkspaceStore,
  type HarnessRunOptions,
} from "../../app/workspaceStore";
import { sumChatThreadStats } from "../../app/workspaceModel";
import type { HarnessCapabilities, HarnessInfo } from "../../lib/ipc/bobClient";
import { formatCompact } from "../../lib/format/numbers";
import { FooterMenu, type FooterMenuItem } from "./FooterMenu";

/**
 * The composer footer line, matching the design: a compact
 *
 *   {assistant} ▾  /  {model} ▾  ·  {N} tokens          ↵ to send
 *
 * row pinned under the input. The assistant + model selectors are
 * {@link FooterMenu} popovers (not Carbon form fields, which shifted the
 * layout). The model selector follows the harness's *capabilities* — shown
 * only when there's something to switch among — exactly like the Settings
 * panel. Renders nothing without a catalog (the browser preview is bob-only).
 *
 * Note: the keyboard hint reads "↵ to send" because the composer sends on
 * plain Enter (Shift+Enter = newline). The mockup's "⌘↵" would require
 * changing that binding.
 */
export function ChatComposerFooterView({
  harnesses,
  selectedHarnessId,
  onSelectHarness,
  modelItems,
  selectedModel,
  modelLabel,
  onSelectModel,
  tokenLabel,
  disabled = false,
}: {
  harnesses: HarnessInfo[];
  selectedHarnessId: string;
  onSelectHarness: (id: string) => void;
  /** Empty → the harness has no model to switch among, so no model selector. */
  modelItems: FooterMenuItem[];
  selectedModel: string;
  modelLabel: string;
  onSelectModel: (value: string) => void;
  tokenLabel: string | null;
  disabled?: boolean;
}) {
  if (harnesses.length === 0) {
    return null;
  }

  const harnessItems = harnesses.map((harness) => ({
    value: harness.id,
    label: harness.displayName,
  }));
  const selectedHarnessName =
    harnesses.find((harness) => harness.id === selectedHarnessId)?.displayName ?? selectedHarnessId;

  return (
    <div className="bob-chat-footer">
      <div className="bob-chat-footer__meta">
        <FooterMenu
          label={selectedHarnessName}
          ariaLabel="Assistant"
          items={harnessItems}
          selected={selectedHarnessId}
          onSelect={onSelectHarness}
          disabled={disabled}
        />
        {modelItems.length > 0 ? (
          <>
            <span className="bob-chat-footer__sep" aria-hidden>
              /
            </span>
            <FooterMenu
              label={modelLabel}
              ariaLabel="Model"
              items={modelItems}
              selected={selectedModel}
              onSelect={onSelectModel}
              disabled={disabled}
            />
          </>
        ) : null}
        {tokenLabel ? (
          <>
            <span className="bob-chat-footer__dot" aria-hidden>
              ·
            </span>
            <span className="bob-chat-footer__tokens">{tokenLabel}</span>
          </>
        ) : null}
      </div>
      <span className="bob-chat-footer__hint">↵ to send</span>
    </div>
  );
}

/** Build the model selector's options from a harness's capabilities — Default
 * plus any curated models, plus an active custom model not already listed.
 * Empty when there's nothing meaningful to switch among (no curated list and
 * no model set), so the selector hides rather than show a lone "Default". */
function modelItemsFor(caps: HarnessCapabilities, currentModel: string): FooterMenuItem[] {
  if (caps.models.length === 0 && !currentModel) {
    return [];
  }
  const items: FooterMenuItem[] = [{ value: "", label: "Default" }];
  for (const model of caps.models) {
    items.push({ value: model.value, label: model.label });
  }
  if (currentModel && !items.some((item) => item.value === currentModel)) {
    items.push({ value: currentModel, label: currentModel });
  }
  return items;
}

/**
 * Store-connected footer. Reads the catalog + selected harness + per-harness
 * model option + the conversation's token total, and writes the *same* store
 * state Settings does (`setSelectedHarness` / `setHarnessOptions`), so the two
 * stay in lockstep.
 */
export function ChatComposerFooter({ disabled = false }: { disabled?: boolean }) {
  const harnessCatalog = useWorkspaceStore((state) => state.harnessCatalog);
  const selectedHarnessId = useWorkspaceStore((state) => state.selectedHarnessId);
  const setSelectedHarness = useWorkspaceStore((state) => state.setSelectedHarness);
  const harnessOptions = useWorkspaceStore((state) => state.harnessOptions);
  const setHarnessOptions = useWorkspaceStore((state) => state.setHarnessOptions);
  const chatThread = useWorkspaceStore((state) => state.activeWorkspace()?.chatThread ?? null);

  const caps = harnessCapabilitiesOf(harnessCatalog, selectedHarnessId);
  const options: HarnessRunOptions = harnessOptions[selectedHarnessId] ?? {};
  const currentModel = options.model ?? "";
  const modelItems = modelItemsFor(caps, currentModel);
  const modelLabel =
    modelItems.find((item) => item.value === currentModel)?.label ?? (currentModel || "Default");

  const totalTokens = chatThread ? sumChatThreadStats(chatThread).totalTokens : undefined;
  const tokenLabel = totalTokens ? `${formatCompact(totalTokens)} tokens` : null;

  return (
    <ChatComposerFooterView
      harnesses={harnessCatalog}
      selectedHarnessId={selectedHarnessId}
      onSelectHarness={setSelectedHarness}
      modelItems={modelItems}
      selectedModel={currentModel}
      modelLabel={modelLabel}
      onSelectModel={(value) => setHarnessOptions(selectedHarnessId, { model: value || undefined })}
      tokenLabel={tokenLabel}
      disabled={disabled}
    />
  );
}
