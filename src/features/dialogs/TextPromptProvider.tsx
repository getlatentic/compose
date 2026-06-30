import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Modal, TextInput } from "@carbon/react";

/**
 * Options for a single text prompt — the in-app, Tauri-safe replacement for
 * `window.prompt`.
 *
 * WKWebView (via wry) never implements the JavaScript text-input panel, so
 * `window.prompt` silently returns `null` in the packaged `.app` while working
 * fine in the browser dev build — a file/conversation rename or a link/image
 * URL prompt just no-ops with no feedback. (`window.confirm` is likewise unusable
 * in the packaged app — it returns a rejecting Promise; see ConfirmProvider.) This
 * provider renders one real modal and hands back an imperative `promptText` so call
 * sites read almost identically to the old `window.prompt`.
 */
export interface TextPromptOptions {
  /** Modal heading, e.g. "Rename file". */
  title: string;
  /** Field label shown above the input. */
  label?: string;
  placeholder?: string;
  /** Pre-filled value, selected on open (mirrors `window.prompt`'s default). */
  defaultValue?: string;
  /** Primary button text; defaults to "OK". */
  submitLabel?: string;
  /**
   * Allow submitting an empty value (resolves to `""`, distinct from `null`
   * cancel). Default false — the primary action is disabled until the field is
   * non-empty. Set true where empty is meaningful, e.g. clearing a link URL.
   */
  allowEmpty?: boolean;
}

type PromptFn = (options: TextPromptOptions) => Promise<string | null>;

const TextPromptContext = createContext<PromptFn | null>(null);

/**
 * Returns `promptText(options) => Promise<string | null>` (`null` = cancelled,
 * a trimmed non-empty string otherwise). Must be used under a
 * {@link TextPromptProvider}.
 */
export function useTextPrompt(): PromptFn {
  const promptText = useContext(TextPromptContext);
  if (!promptText) {
    throw new Error("useTextPrompt must be used within a TextPromptProvider");
  }
  return promptText;
}

interface PendingPrompt extends TextPromptOptions {
  resolve: (value: string | null) => void;
}

const INPUT_ID = "text-prompt-input";

/**
 * Renders a single shared modal at the app root and exposes the imperative
 * `promptText`. One instance replaces every `window.prompt` call site; only one
 * prompt is shown at a time (a second `promptText` call while one is open just
 * queues behind it via React state — in practice these are user-driven and
 * serial).
 */
export function TextPromptProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [value, setValue] = useState("");

  const promptText = useCallback<PromptFn>((options) => {
    return new Promise<string | null>((resolve) => {
      setValue(options.defaultValue ?? "");
      setPending({ ...options, resolve });
    });
  }, []);

  const settle = useCallback((result: string | null) => {
    setPending((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  const trimmed = value.trim();
  const allowEmpty = pending?.allowEmpty ?? false;
  const submit = useCallback(() => {
    if (!allowEmpty && trimmed === "") {
      return;
    }
    settle(trimmed);
  }, [allowEmpty, settle, trimmed]);

  return (
    <TextPromptContext.Provider value={promptText}>
      {children}
      <Modal
        open={pending !== null}
        modalHeading={pending?.title ?? ""}
        primaryButtonText={pending?.submitLabel ?? "OK"}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={!allowEmpty && trimmed === ""}
        selectorPrimaryFocus={`#${INPUT_ID}`}
        size="sm"
        onRequestSubmit={submit}
        onRequestClose={() => settle(null)}
      >
        <TextInput
          id={INPUT_ID}
          labelText={pending?.label ?? ""}
          placeholder={pending?.placeholder}
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
      </Modal>
    </TextPromptContext.Provider>
  );
}
