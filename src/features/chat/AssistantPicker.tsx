import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Checkmark, ChevronDown, WarningAltFilled } from "@carbon/react/icons";

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
}

export interface ModelOption {
  value: string;
  label: string;
}

interface Coords {
  bottom: number;
  left: number;
  width: number;
}

/** Anchor the popup just above the trigger, clamped into the viewport. */
function anchorAbove(trigger: HTMLElement): Coords {
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(300, window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  return { bottom: window.innerHeight - rect.top + 6, left, width };
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
  disabled = false,
}: AssistantPickerViewProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const focused = useRef(false);

  // Position above the trigger once open, and keep anchored on resize. (The
  // popup is gated on `coords`, so it never paints before it's placed.)
  useEffect(() => {
    const trigger = triggerRef.current;
    if (!open || !trigger) {
      setCoords(null);
      return;
    }
    const reposition = () => setCoords(anchorAbove(trigger));
    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [open]);

  // Dismiss on outside pointer-down (trigger + portaled popup count as inside)
  // or Escape — Escape returns focus to the trigger.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Move focus into the popup once it's mounted (once per open).
  useEffect(() => {
    if (!open) {
      focused.current = false;
      return;
    }
    if (focused.current || !coords) return;
    focused.current = true;
    const pop = popoverRef.current;
    (
      pop?.querySelector<HTMLButtonElement>('.assistant-picker__item[aria-checked="true"]') ??
      pop?.querySelector<HTMLButtonElement>(".assistant-picker__item")
    )?.focus();
  }, [open, coords]);

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
