import {
  Code,
  Image as ImageIcon,
  ListBulleted,
  ListNumbered,
  Quotes,
  TextBold,
  TextItalic,
  TextLink,
  TextStrikethrough,
} from "@carbon/react/icons";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import type { TiptapEditorMode } from "./TiptapMarkdownEditor";
import { useTextPrompt } from "../dialogs/TextPromptProvider";

/**
 * The editor's toolbar bar: a formatting group on the left (WYSIWYG only) and a
 * right-aligned current-file group (`fileActions`) — one element, one
 * background. The file group renders in Source mode too (no formatting there),
 * so Save / History / Export stay reachable in both modes.
 *
 * (Formatting group below.)
 *
 * Original rich-text toolbar.
 *
 * Design rules:
 *   * Always visible in WYSIWYG mode — discoverability over
 *     screen real estate, because the user is non-technical.
 *   * `editor.isActive(...)` drives the pressed state so the
 *     toolbar reflects what's under the cursor (e.g. caret inside
 *     bold text → B button highlighted).
 *   * Each click ends with `.focus()` so the editor regains
 *     focus and the keyboard caret keeps blinking — without this,
 *     clicking a button steals focus from the contentEditable
 *     and the user has to click back in to keep typing.
 *
 * Format actions cover the markdown subset @tiptap/markdown
 * round-trips cleanly: headings, bold/italic/strike/code, lists,
 * blockquote, code block, link, image. Tables stay accessible via
 * keyboard for now (a dropdown for "insert table" lands later).
 */
export interface TiptapToolbarProps {
  editor: Editor | null;
  mode: TiptapEditorMode;
  onInsertImage?: () => void;
  /** Right-aligned current-file actions (Save / History / Export). Shown in
   * both modes so they share the bar's background with the formatting group. */
  fileActions?: ReactNode;
}

export function TiptapToolbar({ editor, mode, onInsertImage, fileActions }: TiptapToolbarProps) {
  return (
    <div className="bob-tiptap-toolbar" role="toolbar" aria-label="Editor">
      {mode === "wysiwyg" && editor ? (
        <FormattingButtons editor={editor} onInsertImage={onInsertImage} />
      ) : null}
      <span className="bob-tiptap-toolbar__spacer" aria-hidden="true" />
      {fileActions}
    </div>
  );
}

function FormattingButtons({
  editor,
  onInsertImage,
}: {
  editor: Editor;
  onInsertImage?: () => void;
}) {
  const promptText = useTextPrompt();
  return (
    <>
      <HeadingGroup editor={editor} />
      <Divider />
      <Button
        editor={editor}
        label="Bold"
        shortcut="⌘B"
        active={editor.isActive("bold")}
        onClick={(e) => e.chain().focus().toggleBold().run()}
        icon={<TextBold size={16} />}
      />
      <Button
        editor={editor}
        label="Italic"
        shortcut="⌘I"
        active={editor.isActive("italic")}
        onClick={(e) => e.chain().focus().toggleItalic().run()}
        icon={<TextItalic size={16} />}
      />
      <Button
        editor={editor}
        label="Strikethrough"
        shortcut="⌘⇧S"
        active={editor.isActive("strike")}
        onClick={(e) => e.chain().focus().toggleStrike().run()}
        icon={<TextStrikethrough size={16} />}
      />
      <Button
        editor={editor}
        label="Inline code"
        shortcut="⌘E"
        active={editor.isActive("code")}
        onClick={(e) => e.chain().focus().toggleCode().run()}
        icon={<Code size={16} />}
      />
      <Divider />
      <Button
        editor={editor}
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={(e) => e.chain().focus().toggleBulletList().run()}
        icon={<ListBulleted size={16} />}
      />
      <Button
        editor={editor}
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={(e) => e.chain().focus().toggleOrderedList().run()}
        icon={<ListNumbered size={16} />}
      />
      <Button
        editor={editor}
        label="Quote"
        active={editor.isActive("blockquote")}
        onClick={(e) => e.chain().focus().toggleBlockquote().run()}
        icon={<Quotes size={16} />}
      />
      <Button
        editor={editor}
        label="Code block"
        active={editor.isActive("codeBlock")}
        onClick={(e) => e.chain().focus().toggleCodeBlock().run()}
        icon={<span style={{ fontFamily: "monospace", fontWeight: 700 }}>{"{}"}</span>}
      />
      <Divider />
      <Button
        editor={editor}
        label="Link"
        shortcut="⌘K"
        active={editor.isActive("link")}
        onClick={(e) => {
          const previousUrl = e.getAttributes("link").href as string | undefined;
          void (async () => {
            const url = await promptText({
              title: "Link URL",
              label: "URL (leave empty to remove the link)",
              defaultValue: previousUrl ?? "https://",
              allowEmpty: true,
            });
            if (url === null) return;
            if (url === "") {
              e.chain().focus().extendMarkRange("link").unsetLink().run();
              return;
            }
            e.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
          })();
        }}
        icon={<TextLink size={16} />}
      />
      <Button
        editor={editor}
        label="Insert image"
        onClick={() => {
          // Prefer the parent-provided picker (Tauri file dialog
          // when desktop, plain `<input type="file">` in browser).
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
            editor.chain().focus().setImage({ src: url }).run();
          })();
        }}
        icon={<ImageIcon size={16} />}
      />
    </>
  );
}

interface ButtonProps {
  editor: Editor;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: (editor: Editor) => void;
  icon: React.ReactNode;
}

function Button({ editor, label, shortcut, active, onClick, icon }: ButtonProps) {
  const fullLabel = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      className={[
        "bob-tiptap-toolbar__button",
        active ? "bob-tiptap-toolbar__button--active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={fullLabel}
      aria-pressed={active ? "true" : "false"}
      title={fullLabel}
      onMouseDown={(e) => {
        // Don't steal focus from the editor — we'll re-focus in
        // the onClick path via the editor command chain.
        e.preventDefault();
      }}
      onClick={() => onClick(editor)}
    >
      {icon}
    </button>
  );
}

function HeadingGroup({ editor }: { editor: Editor }) {
  // Heading level dropdown via segmented buttons. Three levels is
  // the sweet spot — H4+ is rare in real notes and clutters the
  // toolbar.
  const level = (() => {
    if (editor.isActive("heading", { level: 1 })) return 1;
    if (editor.isActive("heading", { level: 2 })) return 2;
    if (editor.isActive("heading", { level: 3 })) return 3;
    return 0;
  })();
  return (
    <div className="bob-tiptap-toolbar__heading-group" role="group" aria-label="Heading">
      {[1, 2, 3].map((lvl) => (
        <button
          key={lvl}
          type="button"
          className={[
            "bob-tiptap-toolbar__heading",
            level === lvl ? "bob-tiptap-toolbar__heading--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label={`Heading ${lvl}`}
          aria-pressed={level === lvl ? "true" : "false"}
          title={`Heading ${lvl}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            editor.chain().focus().toggleHeading({ level: lvl as 1 | 2 | 3 }).run();
          }}
        >
          H{lvl}
        </button>
      ))}
    </div>
  );
}

function Divider() {
  return <span className="bob-tiptap-toolbar__divider" aria-hidden="true" />;
}
