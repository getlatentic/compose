import { Markdown } from "@tiptap/markdown";
import { Link } from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { openExternalUrl } from "../../lib/links/openExternal";
import { resolveWorkspaceLink } from "../../lib/links/workspaceLink";
import { resolveWikilinkTarget } from "../../lib/links/wikilink";
import { WikiLink } from "./wikilinkExtension";
import { EditorFileActions, type DocumentExportFormat } from "./EditorFileActions";
import {
  type DocumentTextChange,
  type SourceRange,
  type WorkspaceCommentThread,
} from "../comments/commentModel";
import { CommentBubble } from "./CommentBubble";
import {
  parseFrontmatter,
  serializeMarkdown,
  type Frontmatter,
} from "./frontmatter";
import {
  buildImageMarkdown,
  extractImageBlobs,
  extractImageFiles,
  insertImageBlob,
} from "./imageInsert";
import { ImageWithAssets } from "./imageAssetExtension";
import { computeFileDir, type ImageResolveContext } from "./imageSrcResolver";
import { TiptapToolbar } from "./TiptapToolbar";

export type TiptapEditorMode = "wysiwyg" | "source";

/**
 * Rich-text markdown editor backed by TipTap (ProseMirror).
 *
 * Design contract:
 *   * **Markdown file on disk is the source of truth.** TipTap is a
 *     projection. The editor never persists its own JSON / HTML.
 *   * **Hash-based loop prevention.** External writes (LLM, file
 *     watcher, save round-trips) come back as `value` prop
 *     changes. The hash of the incoming markdown is compared to
 *     the hash of the last markdown WE emitted; if they differ,
 *     the editor reloads via `setContent(md, {contentType:
 *     'markdown'})` and the resulting `update` event is
 *     suppressed so we don't echo a save back.
 *   * **Debounced autosave.** User edits → editor 'update' event
 *     → debounce ~500ms → serialize to markdown → if hash
 *     changed → `onChange(markdown, [])`. The empty changes
 *     array is intentional: TipTap doesn't model byte-range
 *     deltas; the file watcher and undo systems work on
 *     whole-document content for now.
 */
export interface TiptapMarkdownEditorProps {
  comments?: WorkspaceCommentThread[];
  mode?: TiptapEditorMode;
  onChange: (value: string, changes: DocumentTextChange[]) => void;
  /**
   * Bob-chat about the current selection. Caller opens the chat
   * panel with the selection as context and the question as the
   * first turn. No edit to the document.
   *
   * Edit-with-Bob is handled INSIDE this component: it owns the
   * editor instance and is best-placed to substitute Bob's
   * response back into the selected range. Ask-with-Bob has to
   * leak out because the chat panel lives in the AppShell.
   */
  onAskAboutSelection?: (question: string, selection: { range: SourceRange; text: string }) => void;
  /** Stage the note as a comment in the panel queue (batch-send later). */
  onQueueComment?: (note: string, selection: { range: SourceRange; text: string }) => void;
  onSelectionChange?: (selection: { range: SourceRange; text: string } | null) => void;
  value: string;
  workspaceId?: string;
  /** Absolute OS path of the workspace root — used to resolve relative image
   * references to displayable asset URLs on the desktop. */
  workspaceRoot?: string;
  /** Workspace-relative path of the file being edited; relative image
   * references resolve against this file's directory. */
  filePath?: string;
  /** Every workspace-relative file path, used to resolve a clicked link to a
   * navigable target. */
  linkTargets?: ReadonlySet<string>;
  /** Open another workspace file (a cross-file link followed with the modifier
   * key). The caller routes this to the workspace store's `selectFile`. */
  onNavigateToLink?: (path: string) => void;
  /** Current-file actions, rendered right-aligned in the editor toolbar. All
   * MUST be referentially stable (this component is memoized) — the caller
   * should read live state inside them (e.g. via the store) rather than close
   * over per-keystroke values. */
  onSave?: () => void;
  onShowVersionHistory?: () => void;
  onExport?: (format: DocumentExportFormat) => void;
  /** Toggle the per-file comments panel from the toolbar's Comments button. */
  onToggleComments?: () => void;
  /** Whether the comments panel is open (drives the toolbar button's state). */
  commentsOpen?: boolean;
  /** Open-comment count for this file, shown as a badge on the Comments button. */
  commentCount?: number;
  /** Toggle the chat panel — moved from the (now-deleted) top header. */
  onToggleChat?: () => void;
  /** Whether the chat panel is open. */
  chatOpen?: boolean;
  /** Disable the chat toggle when the editor is the only visible pane. */
  chatToggleDisabled?: boolean;
}

const NO_LINK_TARGETS: ReadonlySet<string> = new Set();

const AUTOSAVE_DEBOUNCE_MS = 500;

/// Tiny non-crypto hash. Dedup save loops only — collisions are
/// not security-sensitive (we never trust the hash for identity,
/// only for "did this string change?").
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function TiptapMarkdownEditorInner({
  mode = "wysiwyg",
  onChange,
  onAskAboutSelection,
  onQueueComment,
  onSelectionChange,
  value,
  workspaceId,
  workspaceRoot,
  filePath,
  linkTargets,
  onNavigateToLink,
  onSave,
  onShowVersionHistory,
  onExport,
  onToggleComments,
  commentsOpen = false,
  commentCount = 0,
  onToggleChat,
  chatOpen = false,
  chatToggleDisabled = false,
}: TiptapMarkdownEditorProps) {
  // YAML frontmatter separation. The editor renders **only the
  // body** — the user shouldn't see raw `key: value` lines
  // bleeding into their writing surface. Frontmatter is held
  // alongside as a ref so autosave can recombine it before
  // emitting to the store.
  //
  // Round-trip invariant: the markdown the editor consumes (body)
  // round-trips through `serializeMarkdown` on every save such
  // that the *full* markdown emitted matches what's on disk byte
  // for byte (modulo YAML formatting, which we intentionally
  // normalise via the `yaml` package).
  const parsedRef = useRef(parseFrontmatter(value));
  const frontmatterRef = useRef<Frontmatter | null>(parsedRef.current.frontmatter);
  const bodyRef = useRef<string>(parsedRef.current.body);
  // Last markdown we emitted. When `value` arrives matching this
  // hash, the change is our own echo and we skip the reload.
  const lastEmittedHashRef = useRef<string>(hashString(value));
  // Latest markdown text (full document, frontmatter + body).
  // Held in a ref (not state) so the selection-change handler
  // reads the freshest content without forcing a re-render every
  // keystroke. Updated by both the external value prop and our
  // own autosave path.
  const currentMarkdownRef = useRef<string>(value);
  // Selection snapshot driving the floating comment bubble. We
  // re-publish it as React state (not just a ref) because the
  // bubble's anchor rect is computed from window.getSelection()
  // and we need a re-render trigger when selection enters /
  // leaves a non-empty span.
  const [bubbleSelection, setBubbleSelection] = useState<
    { range: SourceRange; text: string } | null
  >(null);
  // True just before we call `setContent` from an external value
  // change; the next 'update' event clears it and skips the save.
  // Prevents the file-watcher → setContent → 'update' → save →
  // file-watcher loop.
  const suppressNextUpdateRef = useRef<boolean>(false);
  // Debounce timer for autosave.
  const autosaveTimerRef = useRef<number | null>(null);

  // Resolve context for image display. Held in a ref so the Image node view —
  // configured once in the extensions memo below — always reads the *current*
  // file's directory even as the active file changes underneath it.
  const imageCtx = useMemo<ImageResolveContext>(
    () => ({ fileDir: computeFileDir(workspaceRoot, filePath) }),
    [workspaceRoot, filePath],
  );
  const imageCtxRef = useRef(imageCtx);
  imageCtxRef.current = imageCtx;

  const extensions = useMemo(
    () => [
      // StarterKit bundles paragraph, heading, bold, italic,
      // strike, code, list (bullet/ordered), blockquote, HR,
      // hard break, and history (built-in undo/redo).
      StarterKit.configure({
        // We bring in our own Link config (with openOnClick:
        // false so clicks land the caret instead of navigating).
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      ImageWithAssets.configure({
        // Allow loading images by URL on `setContent`. The
        // imageInsert pipeline produces either a workspace-
        // relative path or a `data:` URL — both are valid `src`.
        allowBase64: true,
        // Relative refs (e.g. `images/…`) are resolved to displayable
        // asset URLs at render time; the stored attribute stays relative.
        getContext: () => imageCtxRef.current,
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      // Decorate `[[Note]]` spans as clickable links (the text stays literal,
      // so markdown round-trips unchanged); click handled in handleLinkClick.
      WikiLink,
      // Official markdown extension — handles both directions of
      // the round trip. Editor accepts `contentType: 'markdown'`
      // in setContent and the editor instance gains a
      // `getMarkdown()` method.
      Markdown,
    ],
    [],
  );

  const editor = useEditor(
    {
      extensions,
      // Render only the body. Frontmatter is hidden from the
      // WYSIWYG surface and recombined into the saved markdown
      // below.
      content: bodyRef.current,
      contentType: "markdown",
      onUpdate({ editor }) {
        // Loop guard: if we just called setContent from an
        // external value change, the resulting update event is
        // our own — skip emitting a save.
        if (suppressNextUpdateRef.current) {
          suppressNextUpdateRef.current = false;
          return;
        }
        // Debounce save events so 100 fast keystrokes produce
        // one IPC write, not 100.
        if (autosaveTimerRef.current !== null) {
          window.clearTimeout(autosaveTimerRef.current);
        }
        autosaveTimerRef.current = window.setTimeout(() => {
          autosaveTimerRef.current = null;
          const body = editor.getMarkdown();
          bodyRef.current = body;
          // Recombine with the frontmatter we held aside. If
          // there was no frontmatter to begin with, the
          // serializer omits the fences and emits just the body.
          const full = serializeMarkdown({
            frontmatter: frontmatterRef.current,
            body,
          });
          const hash = hashString(full);
          if (hash === lastEmittedHashRef.current) return;
          lastEmittedHashRef.current = hash;
          currentMarkdownRef.current = full;
          onChange(full, []);
        }, AUTOSAVE_DEBOUNCE_MS);
      },
      onSelectionUpdate({ editor }) {
        const { from, to, empty } = editor.state.selection;
        if (empty) {
          setBubbleSelection(null);
          onSelectionChange?.(null);
          return;
        }
        // Selection → markdown byte range.
        //
        // TipTap selection positions are in doc-space (a tree of
        // nodes) and don't directly correspond to bytes in the
        // serialized markdown. To anchor a comment on real
        // markdown bytes we:
        //   1. Pull the selected text via `textBetween` (the
        //      rendered text the user actually highlighted —
        //      delimiters like `**` are NOT included because
        //      they're hidden by the rich-text view).
        //   2. Pull the text BEFORE the selection the same way.
        //      This is the "hint" that disambiguates duplicate
        //      occurrences of the selected text.
        //   3. Search the markdown source for the selected text
        //      at the position implied by the prefix's length,
        //      with a small forward window for the delimiters
        //      and whitespace the rich-text view didn't show.
        //
        // Tradeoffs:
        //   * Doesn't depend on rewriting `@tiptap/markdown`'s
        //     serializer to emit a source map.
        //   * Works for prose, headings, lists, links — anywhere
        //     the rendered text matches the markdown text 1:1
        //     after stripping markers.
        //   * Approximate for inline code that contains marker
        //     bytes (` ` `) and for tables (the rendered text
        //     drops `|` chars). Comments on those constructs
        //     fall back to the rough position; the persisted
        //     text content still lets us re-find the span on
        //     reload if the file changes.
        const text = editor.state.doc.textBetween(from, to, " ");
        const prefix = editor.state.doc.textBetween(0, from, " ");
        const range = locateInMarkdown(currentMarkdownRef.current, text, prefix.length);
        const snapshot = { range, text };
        setBubbleSelection(snapshot);
        onSelectionChange?.(snapshot);
      },
    },
    [],
  );

  // External value change: when the LLM or file watcher updates
  // the markdown file, push the new content into the editor.
  // Hash guard prevents an infinite loop with our own autosave.
  useEffect(() => {
    if (!editor) return;
    const hash = hashString(value);
    if (hash === lastEmittedHashRef.current) return;
    // Re-parse the new value so external frontmatter edits
    // (e.g., Bob updating the YAML, or future Properties panel
    // edits) propagate to our local state alongside body
    // changes.
    const parsed = parseFrontmatter(value);
    frontmatterRef.current = parsed.frontmatter;
    bodyRef.current = parsed.body;
    // Flag the next 'update' as ours so the save event is
    // skipped. Without this, every external write would echo
    // back as a save → file change → re-read → setContent loop.
    suppressNextUpdateRef.current = true;
    lastEmittedHashRef.current = hash;
    currentMarkdownRef.current = value;
    // Push only the body into the editor — the YAML frontmatter
    // stays in our ref, hidden from the user's writing surface.
    editor.commands.setContent(parsed.body, { contentType: "markdown" });
  }, [editor, value]);

  // Clean up the autosave timer on unmount so we don't fire a
  // save after the parent unmounted (file switch race).
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  // Image paste / drop handlers. Reuse the existing
  // `imageInsert.ts` pipeline (Tauri IPC write OR data-URL
  // fallback) so the markdown produced is the same shape across
  // canvas-era code and the new TipTap editor.
  function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    if (!editor) return;
    const blobs = extractImageBlobs(event.clipboardData?.items);
    if (blobs.length === 0) return;
    event.preventDefault();
    void insertImagesIntoEditor(blobs);
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!editor) return;
    const files = extractImageFiles(event.dataTransfer?.files);
    if (files.length === 0) return;
    event.preventDefault();
    void insertImagesIntoEditor(files);
  }

  // Follow a link on a plain click — like a reading view (this is what a
  // non-technical user expects; ⌘-click is not discoverable). Skipped while the
  // user is selecting text (a drag that ends on a link), so selection still
  // works. To EDIT the link's text, use Source mode. Internal links open the
  // target file in a tab; external links open in the browser.
  function handleLinkClick(event: ReactMouseEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return; // mid-selection — don't navigate
    const element = event.target as HTMLElement | null;
    const targets = linkTargets ?? NO_LINK_TARGETS;

    // A decorated `[[Note]]` span (see wikilinkExtension).
    const wikilink = element?.closest("[data-wikilink-target]");
    if (wikilink) {
      const target = wikilink.getAttribute("data-wikilink-target");
      const path = target ? resolveWikilinkTarget(target, { fromPath: filePath, knownPaths: targets }) : null;
      if (path) {
        event.preventDefault();
        onNavigateToLink?.(path);
      }
      return;
    }

    // A normal markdown link.
    const href = element?.closest("a")?.getAttribute("href");
    if (!href) return;
    const resolved = resolveWorkspaceLink(href, { fromPath: filePath, knownPaths: targets });
    if (!resolved) return;
    event.preventDefault();
    if (resolved.kind === "internal") {
      onNavigateToLink?.(resolved.path);
    } else {
      void openExternalUrl(resolved.href);
    }
  }

  async function insertImagesIntoEditor(blobs: Blob[]) {
    if (!editor) return;
    for (const blob of blobs) {
      try {
        const result = await insertImageBlob({
          blob,
          workspaceId: workspaceId ?? "preview",
        });
        // Insert as markdown so the file reflects the real
        // text; TipTap then renders the actual <img>.
        const md = buildImageMarkdown(result);
        editor
          .chain()
          .focus()
          .insertContent(md + "\n\n", { contentType: "markdown" })
          .run();
        if (result.warning) {
          console.info(`Image inserted with fallback: ${result.warning}`);
        }
      } catch (error) {
        console.error("Failed to insert image:", error);
      }
    }
  }

  // The toolbar bar — shared by both modes (formatting shows in WYSIWYG only;
  // the file actions show in both so Save / History / Export stay reachable).
  const fileActions =
    onSave && onShowVersionHistory && onExport && onToggleComments ? (
      <EditorFileActions
        onSave={onSave}
        onShowVersionHistory={onShowVersionHistory}
        onExport={onExport}
        onToggleComments={onToggleComments}
        commentsOpen={commentsOpen}
        commentCount={commentCount}
        onToggleChat={onToggleChat}
        chatOpen={chatOpen}
        chatToggleDisabled={chatToggleDisabled}
      />
    ) : undefined;
  const toolbar = (
    <TiptapToolbar
      editor={editor}
      mode={mode}
      onInsertImage={pickImageFile}
      fileActions={fileActions}
    />
  );

  // Source mode: plain textarea bound to the buffer. No syntax highlighting, no
  // preview leaks — the "normal text editor, nothing fancy" we agreed on.
  if (mode === "source") {
    return (
      <div className="bob-tiptap-editor" onClick={handleLinkClick}>
        {toolbar}
        <div className="bob-tiptap-source">
          <textarea
            className="bob-tiptap-source__textarea"
            spellCheck={false}
            value={value}
            onChange={(event) => {
              // Mark our own hash so when this value comes back through the
              // `value` prop, the editor doesn't re-render via setContent.
              lastEmittedHashRef.current = hashString(event.target.value);
              currentMarkdownRef.current = event.target.value;
              onChange(event.target.value, []);
            }}
          />
        </div>
      </div>
    );
  }

  function pickImageFile() {
    // Build a hidden <input type="file"> on the fly and trigger
    // the browser's native file picker. We don't keep the input
    // in the DOM because that would mean React renders / styles
    // it; instantiating per click keeps the editor markup clean.
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = () => {
      const files = input.files ? Array.from(input.files) : [];
      if (files.length > 0) {
        void insertImagesIntoEditor(files);
      }
    };
    input.click();
  }

  return (
    <div
      className="bob-tiptap-editor"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onPaste={handlePaste}
      onClick={handleLinkClick}
    >
      {toolbar}
      <div className="bob-tiptap-editor__scroll">
        <EditorContent editor={editor} className="bob-tiptap-editor__content" />
      </div>
      <CommentBubble
        editor={editor}
        selection={bubbleSelection}
        onSendToChat={onAskAboutSelection}
        onQueueComment={onQueueComment}
      />
    </div>
  );
}

/**
 * Memoized public export.
 *
 * Why: AppShell re-renders on every chat-thread mutation
 * (workspaces array gets a new ref → AppShell's selector
 * subscription fires → all props are re-evaluated). Before
 * memoization, every Bob streaming token blew through here,
 * re-running the heavy TipTap render path. With shallow
 * comparison on the props, the editor only re-renders when its
 * *own* data — value, mode, workspaceId, the three callbacks —
 * actually changes by reference. Chat-thread updates no longer
 * touch it.
 *
 * Caller responsibility: pass stable callback references via
 * `useCallback` from `AppShell`, otherwise each AppShell render
 * is still a fresh function reference and memo keeps firing.
 */
export const TiptapMarkdownEditor = memo(TiptapMarkdownEditorInner);

/**
 * Find `selectedText` in `markdown`, biased to the position
 * implied by the rendered prefix's length. Returns a byte range
 * `{ start, end }` even when the exact occurrence is ambiguous —
 * the rough hint pulls us to the right paragraph in nearly every
 * real case, and the persisted comment carries the text content
 * itself so re-finding after a file change works regardless.
 *
 * Exported for unit testing.
 */
export function locateInMarkdown(
  markdown: string,
  selectedText: string,
  prefixCharCount: number,
): SourceRange {
  if (!selectedText) {
    const at = Math.min(prefixCharCount, markdown.length);
    return { start: at, end: at };
  }
  // The hint is computed by approximating "1 rendered character ≈
  // 1 markdown character" — true for prose, an underestimate for
  // formatted text (markers add bytes). Walking forward from
  // the underestimate finds the right occurrence; walking
  // backward would find an earlier wrong one.
  const hint = Math.min(Math.max(0, prefixCharCount - 4), markdown.length);
  const fromForward = markdown.indexOf(selectedText, hint);
  if (fromForward !== -1) {
    return { start: fromForward, end: fromForward + selectedText.length };
  }
  // No match at-or-after the hint; try the whole document. This
  // covers the edge case where the renderer collapsed whitespace
  // (multiple spaces, soft breaks) so the prefix-char count
  // overshoots.
  const fromAnywhere = markdown.indexOf(selectedText);
  if (fromAnywhere !== -1) {
    return { start: fromAnywhere, end: fromAnywhere + selectedText.length };
  }
  // Truly couldn't find it (formatted text where the markers are
  // INSIDE the selection — e.g. user selected "**bold**" in
  // their head but the renderer dropped the asterisks). Fall
  // back to a zero-width range at the hint so the comment
  // anchors SOMEWHERE useful.
  return { start: hint, end: hint };
}
