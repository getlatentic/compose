import { memo, useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { defaultKeymap, history, historyKeymap, indentLess, insertTab } from "@codemirror/commands";
import { Annotation, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { editorBaseTheme } from "@latentic/live-markdown";

/** The Markdown editor's buffer debounce, so autosave and flush behave the same. */
export const PLAIN_TEXT_BUFFER_DEBOUNCE_MS = 500;

const replacedFromOutside = Annotation.define<boolean>();

/** Monospace, so text laid out in columns keeps its columns. */
const plainTextTheme = EditorView.theme({
  ".cm-content": {
    fontFamily: '"SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace',
    fontSize: "0.9375rem",
  },
});

export interface PlainTextEditorProps {
  value: string;
  onChange: (text: string) => void;
  /** Receives the flush the store calls before it reads the buffer; `null` on unmount. */
  onFlushReady?: (flush: (() => void) | null) => void;
  onAfterContentSwap?: () => void;
  toolbar?: ReactNode;
}

/**
 * A plain-text file, shown and saved exactly as written. Nothing here parses
 * Markdown — no shortcuts, no front matter, no pairing of `**` — so no keystroke
 * or save can change a character the user did not type. Mounted once per file.
 */
function PlainTextEditorInner({
  value,
  onChange,
  onFlushReady,
  onAfterContentSwap,
  toolbar,
}: PlainTextEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const emittedRef = useRef(value);
  const timerRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  const onAfterContentSwapRef = useRef(onAfterContentSwap);
  useLayoutEffect(function syncLatestCallbacks() {
    onChangeRef.current = onChange;
    onAfterContentSwapRef.current = onAfterContentSwap;
  });

  const flush = useCallback(function flushToBuffer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const view = viewRef.current;
    if (!view) return;
    const text = view.state.doc.toString();
    if (text === emittedRef.current) return;
    emittedRef.current = text;
    onChangeRef.current(text);
  }, []);

  useLayoutEffect(
    function mountPlainTextView() {
      const host = hostRef.current;
      if (!host) return;
      const view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: emittedRef.current,
          extensions: [
            history(),
            drawSelection(),
            keymap.of([
              { key: "Tab", run: insertTab, shift: indentLess },
              ...defaultKeymap,
              ...historyKeymap,
            ]),
            EditorView.lineWrapping,
            editorBaseTheme,
            plainTextTheme,
            EditorView.updateListener.of((update) => {
              if (!update.docChanged) return;
              if (update.transactions.every((tr) => tr.annotation(replacedFromOutside))) return;
              if (timerRef.current !== null) window.clearTimeout(timerRef.current);
              timerRef.current = window.setTimeout(flush, PLAIN_TEXT_BUFFER_DEBOUNCE_MS);
            }),
          ],
        }),
      });
      viewRef.current = view;
      requestAnimationFrame(() => onAfterContentSwapRef.current?.());
      return function destroyPlainTextView() {
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        view.destroy();
        viewRef.current = null;
      };
    },
    [flush],
  );

  useEffect(
    function acceptContentFromOutside() {
      const view = viewRef.current;
      if (!view || value === emittedRef.current) return;
      emittedRef.current = value;
      if (value === view.state.doc.toString()) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: replacedFromOutside.of(true),
      });
    },
    [value],
  );

  useEffect(
    function registerFlush() {
      onFlushReady?.(flush);
      return () => onFlushReady?.(null);
    },
    [flush, onFlushReady],
  );

  return (
    <div className="tiptap-editor cm-editor-host plain-text-editor">
      {toolbar}
      <div className="tiptap-editor__scroll cm-editor-host__scroll" ref={hostRef} />
    </div>
  );
}

export const PlainTextEditor = memo(PlainTextEditorInner);
