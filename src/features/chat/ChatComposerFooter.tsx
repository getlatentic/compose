import {
  harnessCapabilitiesOf,
  useWorkspaceStore,
  type HarnessRunOptions,
} from "../../app/workspaceStore";
import { useHarnessStore } from "../../app/store/harnessStore";
import { sumChatThreadStats } from "../../app/workspaceModel";
import type { HarnessCapabilities, HarnessInfo } from "../../lib/ipc/harnessClient";
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
 * panel. Renders nothing without a catalog (the browser preview is only).
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
  showReviewToggle = false,
  reviewEdits = false,
  onToggleReviewEdits,
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
  /** Whether the inline review/auto-apply toggle applies to this harness
   * (only write-capable harnesses go through the edit-review gate). */
  showReviewToggle?: boolean;
  /** Mirror of the per-harness `reviewEdits` option Settings owns. */
  reviewEdits?: boolean;
  onToggleReviewEdits?: (next: boolean) => void;
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
    <div className="chat-footer">
      <div className="chat-footer__meta">
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
            <span className="chat-footer__sep" aria-hidden>
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
            <span className="chat-footer__dot" aria-hidden>
              ·
            </span>
            <span className="chat-footer__tokens">{tokenLabel}</span>
          </>
        ) : null}
      </div>
      <div className="chat-footer__end">
        {showReviewToggle ? (
          <button
            type="button"
            role="switch"
            aria-checked={reviewEdits}
            className={[
              "chat-footer__review",
              reviewEdits ? "chat-footer__review--on" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            disabled={disabled}
            title={
              reviewEdits
                ? "Edits land in a copy you approve before they touch your files"
                : "Edits apply to your files as the assistant works (undo from version history)"
            }
            onClick={() => onToggleReviewEdits?.(!reviewEdits)}
          >
            <span className="chat-footer__review-dot" aria-hidden />
            <span>{reviewEdits ? "Review edits" : "Auto-apply"}</span>
          </button>
        ) : null}
        <span className="chat-footer__hint">↵ to send</span>
      </div>
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
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const selectedHarnessId = useHarnessStore((state) => state.selectedHarnessId);
  const setSelectedHarness = useHarnessStore((state) => state.setSelectedHarness);
  const harnessOptions = useHarnessStore((state) => state.harnessOptions);
  const setHarnessOptions = useHarnessStore((state) => state.setHarnessOptions);
  const chatThread = useWorkspaceStore((state) => state.activeWorkspace()?.chatThread ?? null);

  const caps = harnessCapabilitiesOf(harnessCatalog, selectedHarnessId);
  const options: HarnessRunOptions = harnessOptions[selectedHarnessId] ?? {};
  const currentModel = options.model ?? "";
  const modelItems = modelItemsFor(caps, currentModel);
  const modelLabel =
    modelItems.find((item) => item.value === currentModel)?.label ?? (currentModel || "Default");

  const totalTokens = chatThread ? sumChatThreadStats(chatThread).totalTokens : undefined;
  const tokenLabel = totalTokens ? `${formatCompact(totalTokens)} tokens` : null;

  // The inline review/auto-apply toggle mirrors the *same* per-harness
  // `reviewEdits` option Settings owns (`setHarnessOptions`), so the two stay
  // in sync. It shows for write-capable harnesses — the ones that write files
  // directly (`previews_edits: false` — bob, Claude, Codex) and so run through
  // the edit-review gate. A harness that previewed its own edits in-stream
  // would skip the gate, hiding the toggle (none do today).
  const showReviewToggle = !caps.previewsEdits;
  const reviewEdits = options.reviewEdits ?? false;

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
      showReviewToggle={showReviewToggle}
      reviewEdits={reviewEdits}
      onToggleReviewEdits={(next) => setHarnessOptions(selectedHarnessId, { reviewEdits: next })}
      disabled={disabled}
    />
  );
}
