import { memo, useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react";
import type { CaptureApi, ClipboardAccess, ClipboardSummary } from "../captureApi";
import { CopyIcon, DocumentIcon, IntoNoteIcon, NewNoteIcon, PinIcon, TextIcon, TrashIcon, WebLinkIcon } from "../icons";
import { timeAgo } from "../timeAgo";
import type { ClipboardHistoryState } from "./useClipboardHistory";

export interface ClipboardActions {
  /** Put what was picked back on the clipboard and close, to paste where the user was. */
  use(ids: string[]): void;
  /** Put what was picked into the quick note being written. */
  insert(ids: string[]): void;
  /** Start a new quick note with what was picked in it. */
  newNote(ids: string[]): void;
}

export interface ClipboardViewProps {
  api: CaptureApi;
  history: ClipboardHistoryState;
  actions: ClipboardActions;
  searchRef: React.RefObject<HTMLInputElement>;
}

/** What was copied lately, to find, paste again, or put into a note. */
export function ClipboardView({ api, history, actions, searchRef }: ClipboardViewProps) {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const turnOn = useCallback(() => void history.setEnabled(true), [history]);
  const search = useCallback((event: ChangeEvent<HTMLInputElement>) => history.setQuery(event.target.value), [history]);
  const navigate = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        if (event.shiftKey) history.extend(step);
        else history.move(step);
      } else if (event.key === "Enter" && !event.metaKey && history.selectedIds.length > 0) {
        event.preventDefault();
        actions.use(history.selectedIds);
      }
    },
    [actions, history],
  );
  const askToClear = useCallback(() => setConfirmingClear(true), []);
  const clear = useCallback(() => {
    setConfirmingClear(false);
    void history.clear();
  }, [history]);
  const keep = useCallback(() => setConfirmingClear(false), []);
  const turnOff = useCallback(() => void history.setEnabled(false), [history]);
  const openPrivacySettings = useCallback(() => void history.openPrivacySettings(), [history]);

  if (history.enabled === false) return <HistoryOff onTurnOn={turnOn} />;

  const picked = new Set(history.selectedIds);
  const several = history.selectedIds.length > 1;

  return (
    <div className="quick-note__clipboard">
      <input
        ref={searchRef}
        className="quick-note__search"
        type="search"
        aria-label="Search what you copied"
        placeholder="Search what you copied"
        value={history.query}
        onChange={search}
        onKeyDown={navigate}
      />
      {history.access === "allowed" ? null : <AccessNotice access={history.access} onOpenSettings={openPrivacySettings} />}
      <ul
        className="quick-note__clips"
        role="listbox"
        aria-label="Copied lately"
        aria-multiselectable="true"
        onMouseDown={keepTheSearchFocused}
      >
        {history.items.map((item) => (
          <ClipboardRow
            key={item.id}
            api={api}
            item={item}
            selected={picked.has(item.id)}
            current={item.id === history.focusId}
            history={history}
            actions={actions}
          />
        ))}
        {history.items.length === 0 ? (
          <li className="quick-note__empty">{history.query ? "Nothing you copied matches." : "Copy something in any app and it appears here."}</li>
        ) : null}
      </ul>
      <footer className="quick-note__footer" onMouseDown={keepTheSearchFocused}>
        {history.error ? (
          <span role="alert" className="quick-note__error">
            {history.error}
          </span>
        ) : null}
        {confirmingClear ? (
          <span role="alert" className="quick-note__confirm">
            Forget every copy that is not pinned?
            <button type="button" className="quick-note__action quick-note__action--danger" onClick={clear}>
              Clear
            </button>
            <button type="button" className="quick-note__action" onClick={keep}>
              Keep
            </button>
          </span>
        ) : (
          <span className="quick-note__hints">
            {several ? (
              <>
                <kbd>↩</kbd> Copy {history.selectedIds.length} together <kbd>⌘↩</kbd> Put them in the note <kbd>⌘N</kbd>{" "}
                New note from them
              </>
            ) : (
              <>
                <kbd>↩</kbd> Copy to paste anywhere <kbd>⌘↩</kbd> Into the note <kbd>⌘N</kbd> New note <kbd>⌘</kbd>-click
                for several
              </>
            )}
          </span>
        )}
        <span className="quick-note__spacer" />
        <button type="button" className="quick-note__action quick-note__action--quiet" onClick={askToClear}>
          Clear history
        </button>
        <button type="button" className="quick-note__action quick-note__action--quiet" onClick={turnOff}>
          Turn off
        </button>
      </footer>
    </div>
  );
}

/** A click on an entry or a button leaves the keyboard in the search box, where Return and the arrows work. */
function keepTheSearchFocused(event: MouseEvent): void {
  event.preventDefault();
}

function HistoryOff({ onTurnOn }: { onTurnOn: () => void }) {
  return (
    <div className="quick-note__clipboard quick-note__clipboard--off">
      <div className="quick-note__off">
        <h2>Clipboard history is off</h2>
        <p>
          Compose can keep what you copy in any app — text, links, images and files — so you can find it here, paste it
          again, or put it in a note. It stays on this Mac. What password managers copy is never kept.
        </p>
        <button type="button" className="quick-note__action quick-note__action--primary" onClick={onTurnOn}>
          Turn on clipboard history
        </button>
      </div>
    </div>
  );
}

/** Why new copies are not arriving, and where the user changes that. */
function AccessNotice({ access, onOpenSettings }: { access: Exclude<ClipboardAccess, "allowed">; onOpenSettings: () => void }) {
  return (
    <div role="status" className="quick-note__notice">
      <p>
        {access === "denied"
          ? "macOS stops Compose from reading what other apps copy, so new copies are not kept."
          : "macOS asks before Compose reads what other apps copy, so new copies are not kept."}{" "}
        Set Compose to Allow under Paste from Other Apps.
      </p>
      <button type="button" className="quick-note__action" onClick={onOpenSettings}>
        Open Privacy &amp; Security
      </button>
    </div>
  );
}

interface RowProps {
  api: CaptureApi;
  item: ClipboardSummary;
  selected: boolean;
  /** The one the keyboard is on, which the list scrolls to. */
  current: boolean;
  history: ClipboardHistoryState;
  actions: ClipboardActions;
}

const ClipboardRow = memo(function ClipboardRow({ api, item, selected, current, history, actions }: RowProps) {
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (current) row.current?.scrollIntoView({ block: "nearest" });
  }, [current]);
  const id = item.id;
  /** Plain picks this entry; ⌘ takes it in or out; ⇧ reaches back to where picking started. */
  const choose = useCallback((event: MouseEvent) => {
    if (event.metaKey) history.toggle(id);
    else if (event.shiftKey) history.extendTo(id);
    else history.select(id);
  }, [history, id]);
  const use = useCallback(() => actions.use([id]), [actions, id]);
  const insert = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    actions.insert([id]);
  }, [actions, id]);
  const newNote = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    actions.newNote([id]);
  }, [actions, id]);
  const copy = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    actions.use([id]);
  }, [actions, id]);
  const pin = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    void history.pin([id], !item.pinned);
  }, [history, id, item.pinned]);
  const forget = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    void history.forget(id);
  }, [history, id]);

  return (
    <li
      ref={row}
      role="option"
      aria-selected={selected}
      className="quick-note__clip"
      onClick={choose}
      onDoubleClick={use}
    >
      <span className="quick-note__clip-kind" aria-hidden>
        <ClipIcon api={api} item={item} />
      </span>
      <span className="quick-note__clip-body">
        <span className="quick-note__clip-text">{clipText(item)}</span>
        <span className="quick-note__clip-meta">
          {[item.sourceName, timeAgo(item.copiedAt), item.pinned ? "Pinned" : null].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="quick-note__clip-actions">
        <button type="button" aria-label="Copy to paste anywhere" title="Copy to paste anywhere (↩)" onClick={copy}>
          <CopyIcon />
        </button>
        <button type="button" aria-label="Put in the note" title="Put in the note (⌘↩)" onClick={insert}>
          <IntoNoteIcon />
        </button>
        <button type="button" aria-label="New note from this" title="New note from this (⌘N)" onClick={newNote}>
          <NewNoteIcon />
        </button>
        <button type="button" aria-label={item.pinned ? "Unpin" : "Pin"} title={item.pinned ? "Unpin (⌘P)" : "Pin, to keep it (⌘P)"} onClick={pin}>
          <PinIcon filled={item.pinned} />
        </button>
        <button type="button" aria-label="Forget" title="Forget" onClick={forget}>
          <TrashIcon />
        </button>
      </span>
    </li>
  );
});

/** What the list says an entry is: its text, its link, or its files' names. */
function clipText(item: ClipboardSummary): string {
  if (item.kind === "image") return "Image";
  if (item.kind === "files") {
    const names = item.preview.split("\n").filter(Boolean).map((path) => path.slice(path.lastIndexOf("/") + 1));
    return names.join(", ");
  }
  return item.preview.trim();
}

function ClipIcon({ api, item }: { api: CaptureApi; item: ClipboardSummary }) {
  switch (item.kind) {
    case "image":
      return <ClipThumbnail api={api} id={item.id} />;
    case "link":
      return <WebLinkIcon />;
    case "files":
      return <DocumentIcon />;
    case "text":
      return <TextIcon />;
  }
}

/** Thumbnails already fetched, by entry: an entry's image never changes. */
const thumbnails = new Map<string, string>();
const MOST_THUMBNAILS = 60;

function ClipThumbnail({ api, id }: { api: CaptureApi; id: string }) {
  const [src, setSrc] = useState(() => thumbnails.get(id) ?? null);
  useEffect(() => {
    if (thumbnails.has(id)) return;
    let cancelled = false;
    api.clipboard.entry(id).then(
      (entry) => {
        if (!entry?.imageDataUrl || cancelled) return;
        if (thumbnails.size >= MOST_THUMBNAILS) thumbnails.delete(thumbnails.keys().next().value as string);
        thumbnails.set(id, entry.imageDataUrl);
        setSrc(entry.imageDataUrl);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [api, id]);
  return src ? <img className="quick-note__thumbnail" src={src} alt="" /> : <DocumentIcon />;
}
