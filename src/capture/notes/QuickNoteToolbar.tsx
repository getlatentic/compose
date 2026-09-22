import { memo, useCallback, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { EditorView } from "@codemirror/view";
import { blockCommands, formatCommands } from "@latentic/live-markdown";

import { useCaretContext, type CaretContext } from "../../features/editor/caretContext";
import { BoldIcon, BulletListIcon, ChecklistIcon, CodeIcon, ItalicIcon, LinkIcon, NumberedListIcon, QuoteIcon } from "../icons";
import { insertLink } from "./insertLink";

type Command = (view: EditorView) => boolean;

interface ToolbarButton {
  label: string;
  shortcut?: string;
  icon: ReactNode;
  command: Command;
  pressed(context: CaretContext): boolean;
}

const HEADINGS: ToolbarButton[] = [1, 2, 3].map((level) => ({
  label: `Heading ${level}`,
  icon: <span className="quick-note-toolbar__heading">H{level}</span>,
  command: [blockCommands.toggleHeading1, blockCommands.toggleHeading2, blockCommands.toggleHeading3][level - 1] as Command,
  pressed: (context) => context.heading === level,
}));

const GROUPS: ToolbarButton[][] = [
  [
    { label: "Bold", shortcut: "⌘B", icon: <BoldIcon />, command: formatCommands.toggleBold, pressed: (context) => context.bold },
    { label: "Italic", shortcut: "⌘I", icon: <ItalicIcon />, command: formatCommands.toggleItalic, pressed: (context) => context.italic },
    { label: "Code", icon: <CodeIcon />, command: formatCommands.toggleInlineCode, pressed: (context) => context.code },
  ],
  HEADINGS,
  [
    { label: "Bulleted list", icon: <BulletListIcon />, command: blockCommands.toggleBulletList, pressed: (context) => context.bulletList },
    { label: "Numbered list", icon: <NumberedListIcon />, command: blockCommands.toggleOrderedList, pressed: (context) => context.orderedList },
    { label: "Checklist", icon: <ChecklistIcon />, command: blockCommands.toggleTaskList, pressed: (context) => context.taskList },
    { label: "Quote", icon: <QuoteIcon />, command: blockCommands.toggleBlockquote, pressed: (context) => context.blockquote },
  ],
];

const BUTTONS = GROUPS.flat();

/**
 * The quick note's formatting buttons, the main editor's in a smaller window.
 * Pressed states follow the caret; a click leaves the caret in the text.
 */
function QuickNoteToolbarInner({ view }: { view: EditorView }) {
  const context = useCaretContext(view);
  const [linking, setLinking] = useState(false);

  const run = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const button = BUTTONS[Number(event.currentTarget.dataset.index)];
      if (!button) return;
      button.command(view);
      view.focus();
    },
    [view],
  );
  const openLink = useCallback(() => setLinking(true), []);
  const closeLink = useCallback(() => {
    setLinking(false);
    view.focus();
  }, [view]);

  return (
    <div className="quick-note-toolbar" role="toolbar" aria-label="Formatting">
      {GROUPS.map((group, groupIndex) => (
        <span className="quick-note-toolbar__group" key={groupIndex}>
          {group.map((button) => (
            <button
              type="button"
              key={button.label}
              className="quick-note-toolbar__button"
              aria-label={button.shortcut ? `${button.label} (${button.shortcut})` : button.label}
              title={button.shortcut ? `${button.label} ${button.shortcut}` : button.label}
              aria-pressed={button.pressed(context)}
              data-index={BUTTONS.indexOf(button)}
              onMouseDown={keepTheCaret}
              onClick={run}
            >
              {button.icon}
            </button>
          ))}
        </span>
      ))}
      <span className="quick-note-toolbar__group">
        <button
          type="button"
          className="quick-note-toolbar__button"
          aria-label="Link"
          title="Link"
          aria-pressed={context.link}
          onMouseDown={keepTheCaret}
          onClick={openLink}
        >
          <LinkIcon />
        </button>
        {linking ? <LinkField view={view} onDone={closeLink} /> : null}
      </span>
    </div>
  );
}

export const QuickNoteToolbar = memo(QuickNoteToolbarInner);

/** A button press that leaves the caret, and the selection, in the text. */
function keepTheCaret(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

/** Where the link's address is typed; Return makes the selection a link to it. */
function LinkField({ view, onDone }: { view: EditorView; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const url = input.current?.value.trim() ?? "";
      if (url) insertLink(view, url);
      onDone();
    },
    [view, onDone],
  );
  const cancelOnEscape = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onDone();
    },
    [onDone],
  );
  return (
    <form className="quick-note-toolbar__link" onSubmit={submit}>
      <input
        ref={input}
        type="url"
        aria-label="Link address"
        placeholder="Paste or type a link, then Return"
        autoFocus
        onKeyDown={cancelOnEscape}
        onBlur={onDone}
      />
    </form>
  );
}
