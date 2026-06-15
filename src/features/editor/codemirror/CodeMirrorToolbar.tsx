/**
 * CodeMirror toolbar — visual mirror of TiptapToolbar wired to CM6
 * commands.
 *
 * Pressed state is derived live from the Lezer syntax tree at the
 * caret position. The toolbar subscribes to the view's
 * `updateListener` so it re-renders on every selection / doc change
 * — same UX as Tiptap's `editor.isActive(...)` reactivity.
 *
 * Buttons dispatch through the registered commands (formatCommands,
 * blockCommands). No new logic lives here; the toolbar is a thin
 * affordance layer.
 */

import {
  Code,
  Image as ImageIcon,
  ListBulleted,
  ListNumbered,
  Quotes,
  TextBold,
  TextItalic,
  TextLink,
} from "@carbon/react/icons";
import type { ReactNode } from "react";
import { memo, useEffect, useState } from "react";
import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";

import { blockCommands } from "./decorations/blockCommands";
import { formatCommands } from "./decorations/formatCommands";
import { useTextPrompt } from "../../dialogs/TextPromptProvider";
import { useLinkPrompt } from "../../dialogs/LinkInsertProvider";

export interface CodeMirrorToolbarProps {
  view: EditorView | null;
  /** Right-aligned current-file actions (Save / History / Export / Comments / Chat). */
  fileActions?: ReactNode;
  /** Insert image via parent (Tauri file dialog vs browser file input). */
  onInsertImage?: () => void;
  /** Workspace-relative paths used by the link dialog's File tab. */
  linkTargets?: ReadonlySet<string>;
  /** Hide formatting buttons in Source mode (caller decides). */
  mode: "wysiwyg" | "source";
}

interface CaretContext {
  bold: boolean;
  italic: boolean;
  code: boolean;
  link: boolean;
  heading: 1 | 2 | 3 | 4 | 5 | 6 | 0;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
}

const EMPTY_CONTEXT: CaretContext = {
  bold: false,
  italic: false,
  code: false,
  link: false,
  heading: 0,
  bulletList: false,
  orderedList: false,
  blockquote: false,
};

function caretContext(view: EditorView): CaretContext {
  const pos = view.state.selection.main.head;
  const tree = syntaxTree(view.state);
  let node: { name: string; parent: typeof node } | null = tree.resolveInner(
    pos,
    1,
  ) as unknown as { name: string; parent: typeof node };
  const ctx: CaretContext = { ...EMPTY_CONTEXT };
  while (node) {
    const n = node.name;
    if (n === "StrongEmphasis") ctx.bold = true;
    else if (n === "Emphasis") ctx.italic = true;
    else if (n === "InlineCode") ctx.code = true;
    else if (n === "Link") ctx.link = true;
    else if (n === "BulletList") ctx.bulletList = true;
    else if (n === "OrderedList") ctx.orderedList = true;
    else if (n === "Blockquote") ctx.blockquote = true;
    else if (n.startsWith("ATXHeading")) {
      const lvl = Number(n.slice("ATXHeading".length));
      if (lvl >= 1 && lvl <= 6) ctx.heading = lvl as CaretContext["heading"];
    }
    node = node.parent;
  }
  return ctx;
}

function caretContextsEqual(a: CaretContext, b: CaretContext): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.code === b.code &&
    a.link === b.link &&
    a.heading === b.heading &&
    a.bulletList === b.bulletList &&
    a.orderedList === b.orderedList &&
    a.blockquote === b.blockquote
  );
}

/**
 * Keep the toolbar's pressed states in sync with the caret. We poll via
 * rAF, but only re-render when the *computed* caret context actually
 * changes — not on every caret move or keystroke.
 *
 * The earlier version bumped a tick whenever the caret head or doc
 * length changed, which is EVERY keystroke — so the toolbar (and its ~13
 * icon buttons) re-rendered on every keypress even though bold/italic/
 * heading state hadn't flipped (react-scan caught this: `mi ×10` after
 * 10 chars). Now we compute the context in the poll and shallow-compare
 * the eight fields; typing inside a paragraph produces an unchanged
 * context, so React never re-renders.
 */
function useCaretContext(view: EditorView | null): CaretContext {
  const [ctx, setCtx] = useState<CaretContext>(EMPTY_CONTEXT);
  useEffect(function pollCaretForToolbarPressedState() {
    if (!view) {
      setCtx(EMPTY_CONTEXT);
      return;
    }
    let lastSelHead = -1;
    let lastDocLen = -1;
    let current = EMPTY_CONTEXT;
    let raf = 0;
    function poll() {
      const head = view!.state.selection.main.head;
      const docLen = view!.state.doc.length;
      if (head !== lastSelHead || docLen !== lastDocLen) {
        lastSelHead = head;
        lastDocLen = docLen;
        const next = caretContext(view!);
        if (!caretContextsEqual(next, current)) {
          current = next;
          setCtx(next);
        }
      }
      raf = requestAnimationFrame(poll);
    }
    raf = requestAnimationFrame(poll);
    return function stopPolling() {
      cancelAnimationFrame(raf);
    };
  }, [view]);
  return ctx;
}

function CodeMirrorToolbarInner({
  view,
  fileActions,
  onInsertImage,
  linkTargets,
  mode,
}: CodeMirrorToolbarProps) {
  return (
    <div className="tiptap-toolbar" role="toolbar" aria-label="Editor">
      {mode === "wysiwyg" && view ? (
        <FormattingButtons view={view} onInsertImage={onInsertImage} linkTargets={linkTargets} />
      ) : null}
      <span className="tiptap-toolbar__spacer" aria-hidden="true" />
      {fileActions}
    </div>
  );
}

/**
 * Memoised — the toolbar's *own* visual state (which button is "pressed")
 * comes from the caret-context polling inside `FormattingButtons`, not
 * from React props. Parent re-renders (chat token stream, file-watcher
 * tick, sibling state changes) shouldn't cascade into the toolbar.
 */
export const CodeMirrorToolbar = memo(CodeMirrorToolbarInner);

function FormattingButtons({
  view,
  onInsertImage,
  linkTargets,
}: {
  view: EditorView;
  onInsertImage?: () => void;
  linkTargets?: ReadonlySet<string>;
}) {
  const ctx = useCaretContext(view);
  const promptText = useTextPrompt();
  const promptLink = useLinkPrompt();
  const run = (cmd: (v: EditorView) => boolean) => {
    cmd(view);
    view.focus();
  };
  return (
    <>
      <HeadingGroup view={view} activeLevel={ctx.heading} />
      <Divider />
      <Button
        label="Bold"
        shortcut="⌘B"
        active={ctx.bold}
        onClick={() => run(formatCommands.toggleBold)}
        icon={<TextBold size={16} />}
      />
      <Button
        label="Italic"
        shortcut="⌘I"
        active={ctx.italic}
        onClick={() => run(formatCommands.toggleItalic)}
        icon={<TextItalic size={16} />}
      />
      <Button
        label="Inline code"
        shortcut="⌘E"
        active={ctx.code}
        onClick={() => run(formatCommands.toggleInlineCode)}
        icon={<Code size={16} />}
      />
      <Divider />
      <Button
        label="Bullet list"
        active={ctx.bulletList}
        onClick={() => run(blockCommands.toggleBulletList)}
        icon={<ListBulleted size={16} />}
      />
      <Button
        label="Numbered list"
        active={ctx.orderedList}
        onClick={() => run(blockCommands.toggleOrderedList)}
        icon={<ListNumbered size={16} />}
      />
      <Button
        label="Quote"
        active={ctx.blockquote}
        onClick={() => run(blockCommands.toggleBlockquote)}
        icon={<Quotes size={16} />}
      />
      <Button
        label="Code block"
        onClick={() => run(blockCommands.toggleCodeBlock)}
        icon={<span style={{ fontFamily: "monospace", fontWeight: 700 }}>{"{}"}</span>}
      />
      <Divider />
      <Button
        label="Link"
        shortcut="⌘K"
        active={ctx.link}
        onClick={() => {
          void (async () => {
            const sel = view.state.selection.main;
            const selectionText = sel.empty ? "" : view.state.sliceDoc(sel.from, sel.to);
            const result = await promptLink({
              linkTargets: linkTargets ?? new Set(),
              initialText: selectionText,
            });
            if (!result) return;
            const insert =
              result.type === "url"
                ? `[${result.text}](${result.url})`
                : `[[${result.path}]]`;
            view.dispatch({
              changes: { from: sel.from, to: sel.to, insert },
              userEvent: "input.format.link",
            });
            view.focus();
          })();
        }}
        icon={<TextLink size={16} />}
      />
      <Button
        label="Insert image"
        onClick={() => {
          if (onInsertImage) {
            onInsertImage();
            return;
          }
          void (async () => {
            const url = await promptText({
              title: "Insert image",
              label: "Image URL",
              defaultValue: "https://",
            });
            if (!url) return;
            const sel = view.state.selection.main;
            view.dispatch({
              changes: { from: sel.from, to: sel.to, insert: `![](${url})` },
              userEvent: "input.format.image",
            });
            view.focus();
          })();
        }}
        icon={<ImageIcon size={16} />}
      />
    </>
  );
}

function HeadingGroup({
  view,
  activeLevel,
}: {
  view: EditorView;
  activeLevel: CaretContext["heading"];
}) {
  const apply = (cmd: (v: EditorView) => boolean) => () => {
    cmd(view);
    view.focus();
  };
  return (
    <div className="tiptap-toolbar__heading-group" role="group" aria-label="Heading">
      {(
        [
          { lvl: 1, cmd: blockCommands.toggleHeading1 },
          { lvl: 2, cmd: blockCommands.toggleHeading2 },
          { lvl: 3, cmd: blockCommands.toggleHeading3 },
        ] as const
      ).map(({ lvl, cmd }) => (
        <button
          key={lvl}
          type="button"
          className={[
            "tiptap-toolbar__heading",
            activeLevel === lvl ? "tiptap-toolbar__heading--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label={`Heading ${lvl}`}
          aria-pressed={activeLevel === lvl ? "true" : "false"}
          title={`Heading ${lvl} (⌘${lvl})`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={apply(cmd)}
        >
          H{lvl}
        </button>
      ))}
    </div>
  );
}

interface ButtonProps {
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
  icon: ReactNode;
}

function Button({ label, shortcut, active, onClick, icon }: ButtonProps) {
  const fullLabel = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      className={[
        "tiptap-toolbar__button",
        active ? "tiptap-toolbar__button--active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={fullLabel}
      aria-pressed={active ? "true" : "false"}
      title={fullLabel}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

function Divider() {
  return <span className="tiptap-toolbar__divider" aria-hidden="true" />;
}
