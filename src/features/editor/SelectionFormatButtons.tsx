import { useCallback, type MouseEvent, type ReactNode } from "react";
import type { EditorView } from "@codemirror/view";
import { Bold, Code, Italic, Link2 } from "lucide-react";

import { formatCommands } from "@latentic/live-markdown";
import { useCaretContext } from "./caretContext";
import { useLinkPrompt } from "../dialogs/LinkInsertProvider";

function keepEditorSelection(event: MouseEvent): void {
  event.preventDefault();
}

/**
 * The everyday inline formats, on the bar that appears over selected text.
 * Paragraph styles, lists and inserts are in the toolbar's Aa menu.
 */
export function SelectionFormatButtons({ view, linkTargets }: { view: EditorView; linkTargets?: ReadonlySet<string> }) {
  const ctx = useCaretContext(view);
  const promptLink = useLinkPrompt();

  const bold = useCallback(() => {
    formatCommands.toggleBold(view);
    view.focus();
  }, [view]);
  const italic = useCallback(() => {
    formatCommands.toggleItalic(view);
    view.focus();
  }, [view]);
  const code = useCallback(() => {
    formatCommands.toggleInlineCode(view);
    view.focus();
  }, [view]);
  const link = useCallback(async () => {
    const sel = view.state.selection.main;
    const result = await promptLink({
      linkTargets: linkTargets ?? new Set(),
      initialText: view.state.sliceDoc(sel.from, sel.to),
    });
    if (!result) return;
    const insert = result.type === "url" ? `[${result.text}](${result.url})` : `[[${result.path}]]`;
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, userEvent: "input.format.link" });
    view.focus();
  }, [view, promptLink, linkTargets]);

  return (
    <>
      <FormatButton label="Bold (⌘B)" active={ctx.bold} onClick={bold} icon={<Bold size={15} strokeWidth={2.25} />} />
      <FormatButton label="Italic (⌘I)" active={ctx.italic} onClick={italic} icon={<Italic size={15} />} />
      <FormatButton label="Code (⌘E)" active={ctx.code} onClick={code} icon={<Code size={15} />} />
      <FormatButton label="Link (⌘K)" active={ctx.link} onClick={link} icon={<Link2 size={15} />} />
      <span className="selection-actions__divider" aria-hidden="true" />
    </>
  );
}

interface FormatButtonProps {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly icon: ReactNode;
}

function FormatButton({ label, active, onClick, icon }: FormatButtonProps) {
  return (
    <button
      type="button"
      className={`selection-actions__format${active ? " selection-actions__format--active" : ""}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onMouseDown={keepEditorSelection}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
