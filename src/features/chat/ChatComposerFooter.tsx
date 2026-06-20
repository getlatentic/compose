import { useEffect } from "react";
import { WarningAltFilled } from "@carbon/react/icons";
import { harnessCapabilitiesOf, type HarnessRunOptions } from "../../app/workspaceStore";
import { useHarnessStore } from "../../app/store/harnessStore";
import type { HarnessInfo, HarnessModel } from "../../lib/ipc/harnessClient";
import { FooterMenu, type FooterMenuItem } from "./FooterMenu";

/**
 * The composer footer line, a compact
 *
 *   {assistant} ▾  /  {model} ▾                       [Auto-apply]
 *
 * row pinned under the input. The assistant + model selectors are
 * {@link FooterMenu} popovers (not Carbon form fields, which shifted the
 * layout). The model selector follows the harness's *capabilities* — shown
 * only when there's something to switch among — exactly like the Settings
 * panel. Renders nothing without a catalog (the browser preview only).
 */
export function ChatComposerFooterView({
  harnesses,
  selectedHarnessId,
  onSelectHarness,
  modelItems,
  selectedModel,
  modelLabel,
  onSelectModel,
  showReviewToggle = false,
  reviewEdits = false,
  onToggleReviewEdits,
  unavailable = false,
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
  /** The selected harness probed as not-ready → a ⚠️ Offline marker by the model. */
  unavailable?: boolean;
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
        {unavailable ? (
          <span className="chat-footer__status" title="This assistant isn't available right now">
            <WarningAltFilled size={14} aria-hidden />
            Offline
          </span>
        ) : null}
      </div>
      {showReviewToggle ? (
        <div className="chat-footer__end">
          <button
            type="button"
            role="switch"
            aria-checked={reviewEdits}
            className={["chat-footer__review", reviewEdits ? "chat-footer__review--on" : ""]
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
        </div>
      ) : null}
    </div>
  );
}

/** Build the model selector's options — Default plus the harness's models, plus
 * an active custom model not already listed. Empty when there's nothing to switch
 * among (no models and no model set), so the selector hides. */
function modelItemsFor(models: HarnessModel[], currentModel: string): FooterMenuItem[] {
  if (models.length === 0 && !currentModel) {
    return [];
  }
  const items: FooterMenuItem[] = [{ value: "", label: "Default" }];
  for (const model of models) {
    items.push({ value: model.value, label: model.label });
  }
  if (currentModel && !items.some((item) => item.value === currentModel)) {
    items.push({ value: currentModel, label: currentModel });
  }
  return items;
}

/**
 * Store-connected footer. Reads the catalog + selected harness + per-harness
 * model option, and writes the *same* store state Settings does
 * (`setSelectedHarness` / `setHarnessOptions`), so the two stay in lockstep.
 */
export function ChatComposerFooter({ disabled = false }: { disabled?: boolean }) {
  const harnessCatalog = useHarnessStore((state) => state.harnessCatalog);
  const selectedHarnessId = useHarnessStore((state) => state.selectedHarnessId);
  const setSelectedHarness = useHarnessStore((state) => state.setSelectedHarness);
  const harnessOptions = useHarnessStore((state) => state.harnessOptions);
  const setHarnessOptions = useHarnessStore((state) => state.setHarnessOptions);
  const harnessModels = useHarnessStore((state) => state.harnessModels);
  const loadHarnessModels = useHarnessStore((state) => state.loadHarnessModels);
  const selectedHarnessReadiness = useHarnessStore((state) => state.selectedHarnessReadiness);

  const caps = harnessCapabilitiesOf(harnessCatalog, selectedHarnessId);
  // Only a *definitive* not-ready probe marks Offline; a not-yet-probed (null)
  // selection stays unmarked — mirrors the composer's send-gate conservatism so
  // a slow/failed probe never wrongly flags an available harness.
  const unavailable = Boolean(selectedHarnessReadiness && !selectedHarnessReadiness.ready);
  // Harnesses with no curated list discover models live (Ollama/OpenCode/OpenRouter).
  useEffect(() => {
    if (caps.models.length === 0) {
      void loadHarnessModels(selectedHarnessId);
    }
  }, [selectedHarnessId, caps.models.length, loadHarnessModels]);
  const options: HarnessRunOptions = harnessOptions[selectedHarnessId] ?? {};
  const currentModel = options.model ?? "";
  const models = caps.models.length > 0 ? caps.models : harnessModels[selectedHarnessId] ?? [];
  const modelItems = modelItemsFor(models, currentModel);
  const modelLabel =
    modelItems.find((item) => item.value === currentModel)?.label ?? (currentModel || "Default");

  // The inline review/auto-apply toggle mirrors the *same* per-harness
  // `reviewEdits` option Settings owns. It shows for write-capable harnesses —
  // the ones that write files directly (`previewsEdits: false`) and so run
  // through the edit-review gate.
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
      showReviewToggle={showReviewToggle}
      reviewEdits={reviewEdits}
      onToggleReviewEdits={(next) => setHarnessOptions(selectedHarnessId, { reviewEdits: next })}
      unavailable={unavailable}
      disabled={disabled}
    />
  );
}
