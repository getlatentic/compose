import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Checkmark, ChevronDown, WarningAltFilled } from "@carbon/react/icons";

import { useAnchoredPopover } from "../shared/useAnchoredPopover";

/**
 * The composer's combined assistant + model selector. The footer shows a single
 * plain-text "assistant/model" label; clicking opens ONE popup that picks the
 * assistant and the model together (two sections). The popup is portaled and
 * fixed-positioned, clamped into the viewport and anchored above the trigger, so
 * a long model id can't run off the screen edge the way the old right-hand model
 * dropdown could.
 */
export interface AssistantOption {
  id: string;
  name: string;
  /** Per-agent readiness dot shown in the picker. */
  status?: "online" | "offline" | "connecting";
}

export interface ModelOption {
  value: string;
  label: string;
}

export interface AssistantPickerViewProps {
  /** The collapsed footer text, e.g. `opencode/deepseek-v4-flash-free`. */
  label: string;
  assistants: AssistantOption[];
  selectedAssistantId: string;
  onSelectAssistant: (id: string) => void;
  /** Models for the selected assistant; empty hides the Model section. */
  models: ModelOption[];
  selectedModel: string;
  onSelectModel: (value: string) => void;
  /** The selected assistant probed not-ready → a ⚠️ marker on the trigger. */
  unavailable?: boolean;
  /** Called when the popup opens — the host lazily probes per-agent statuses. */
  onOpen?: () => void;
  disabled?: boolean;
}

export function AssistantPickerView({
  label,
  assistants,
  selectedAssistantId,
  onSelectAssistant,
  models,
  selectedModel,
  onSelectModel,
  unavailable = false,
  onOpen,
  disabled = false,
}: AssistantPickerViewProps) {
  const { open, setOpen, coords, triggerRef, popoverRef } = useAnchoredPopover<
    HTMLButtonElement,
    HTMLDivElement
  >({
    placement: "above",
    maxWidth: 300,
    gap: 6,
    // Move focus to the selected item, else the first, once the popup mounts.
    getInitialFocus: (pop) =>
      pop.querySelector<HTMLButtonElement>('.assistant-picker__item[aria-checked="true"]') ??
      pop.querySelector<HTMLButtonElement>(".assistant-picker__item"),
  });

  // Probe per-agent statuses when the popup opens (cached + capped in the host).
  useEffect(() => {
    if (open) {
      onOpen?.();
    }
  }, [open, onOpen]);

  return (
    <div className="assistant-picker">
      <button
        ref={triggerRef}
        type="button"
        className="assistant-picker__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Assistant and model"
        title={label}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="assistant-picker__label">{label}</span>
        {unavailable ? (
          <WarningAltFilled size={12} className="assistant-picker__offline" aria-label="Offline" />
        ) : null}
        <ChevronDown size={12} className="assistant-picker__chevron" aria-hidden />
      </button>

      {open && coords
        ? createPortal(
            <div
              ref={popoverRef}
              className="assistant-picker__popover"
              role="menu"
              aria-label="Assistant and model"
              style={{ bottom: coords.bottom, left: coords.left, inlineSize: coords.width }}
            >
              <div className="assistant-picker__section">
                <p className="assistant-picker__heading">Assistant</p>
                {assistants.map((assistant) => (
                  <button
                    key={assistant.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={assistant.id === selectedAssistantId}
                    className="assistant-picker__item"
                    // Switching assistant keeps the popup open so a model can be
                    // picked next; the Model section re-renders for it.
                    onClick={() => onSelectAssistant(assistant.id)}
                  >
                    {assistant.status ? (
                      <span
                        className={`assistant-picker__status assistant-picker__status--${assistant.status}`}
                        title={assistant.status}
                        aria-label={assistant.status}
                      />
                    ) : null}
                    <span className="assistant-picker__item-label">{assistant.name}</span>
                    {assistant.id === selectedAssistantId ? <Checkmark size={16} aria-hidden /> : null}
                  </button>
                ))}
              </div>

              {models.length > 0 ? (
                <div className="assistant-picker__section">
                  <p className="assistant-picker__heading">Model</p>
                  {models.map((model) => (
                    <button
                      key={model.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={model.value === selectedModel}
                      className="assistant-picker__item"
                      onClick={() => {
                        onSelectModel(model.value);
                        setOpen(false);
                      }}
                    >
                      <span className="assistant-picker__item-label">{model.label}</span>
                      {model.value === selectedModel ? <Checkmark size={16} aria-hidden /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
