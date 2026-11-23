import { ChevronDown, Check } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface PickerItem {
  readonly id: string;
  readonly label: string;
  /** Drawn before the label: a swatch, a sample. */
  readonly leading?: ReactNode;
  /** Style for the label, e.g. a font sample's family. */
  readonly labelStyle?: CSSProperties;
}

export interface PickerSection {
  readonly title?: string;
  readonly items: readonly PickerItem[];
}

interface PopupPickerProps {
  /** Names the control for assistive technology. */
  readonly label: string;
  readonly selectedId: string;
  readonly sections: readonly PickerSection[];
  readonly onSelect: (id: string) => void;
  /** Shown above the list; filters items by label. */
  readonly searchPlaceholder?: string;
  /** Shown when the list is still being gathered (installed fonts). */
  readonly loadingNote?: string;
}

/** Rows drawn at once while searching a long list. */
const MAX_ROWS = 120;
/** Room needed under the button to open the list downward. */
const ROOM_BELOW_PX = 320;

/** The sections with only the items whose label holds `query`, at most {@link MAX_ROWS} in all. */
function filterSections(sections: readonly PickerSection[], query: string): PickerSection[] {
  const needle = query.trim().toLowerCase();
  let budget = MAX_ROWS;
  return sections
    .map((section) => {
      const matching = needle ? section.items.filter((item) => item.label.toLowerCase().includes(needle)) : section.items;
      const items = matching.slice(0, budget);
      budget -= items.length;
      return { ...section, items };
    })
    .filter((section) => section.items.length > 0);
}

/** Under the button, or above it when the window has too little room below. */
function popoverPosition(rect: DOMRect): CSSProperties {
  const below = window.innerHeight - rect.bottom;
  return below > ROOM_BELOW_PX
    ? { top: rect.bottom + 4, left: rect.left, minInlineSize: rect.width }
    : { bottom: window.innerHeight - rect.top + 4, left: rect.left, minInlineSize: rect.width };
}

/** Where the list is open (null while closed), and a press outside it closing it. */
function usePickerPopover() {
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => {
    setPosition(null);
    buttonRef.current?.focus();
  }, []);
  const open = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPosition(popoverPosition(rect));
  }, []);
  useEffect(() => {
    if (!position) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !listRef.current?.contains(target)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [position, close]);
  return { position, open, close, buttonRef, listRef };
}

/** Arrow keys move the highlight, Return chooses it, Escape closes. */
function usePickerKeys(flat: readonly PickerItem[], active: number, setActive: (update: (index: number) => number) => void, choose: (id: string) => void, close: () => void) {
  return useCallback(
    (event: KeyboardEvent) => {
      const moves: Record<string, () => void> = {
        Escape: close,
        ArrowDown: () => setActive((index) => Math.min(flat.length - 1, index + 1)),
        ArrowUp: () => setActive((index) => Math.max(0, index - 1)),
        Enter: () => flat[active] && choose(flat[active].id),
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      move();
    },
    [close, flat, active, setActive, choose],
  );
}

/**
 * A Mac pop-up button: the current choice, and a short list under it to
 * change it. Stays compact however many choices there are, with sections
 * and, for long lists, a search field. Arrow keys move, Return chooses,
 * Escape closes.
 */
export function PopupPicker({ label, selectedId, sections, onSelect, searchPlaceholder, loadingNote }: PopupPickerProps) {
  const popover = usePickerPopover();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  const selected = useMemo(() => sections.flatMap((section) => section.items).find((item) => item.id === selectedId), [sections, selectedId]);
  const visible = useMemo(() => filterSections(sections, query), [sections, query]);
  const flat = useMemo(() => visible.flatMap((section) => section.items), [visible]);

  const { open: openPopover, close: closePopover, position } = popover;
  const close = useCallback(() => {
    setQuery("");
    closePopover();
  }, [closePopover]);
  const toggle = useCallback(() => {
    if (position) return close();
    setActive(Math.max(0, flat.findIndex((item) => item.id === selectedId)));
    openPopover();
  }, [position, close, openPopover, flat, selectedId]);
  const choose = useCallback(
    (id: string) => {
      onSelect(id);
      close();
    },
    [onSelect, close],
  );
  const handleKeyDown = usePickerKeys(flat, active, setActive, choose, close);
  const handleQuery = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setActive(0);
  }, []);

  return (
    <>
      <button
        ref={popover.buttonRef}
        type="button"
        className="popup-picker__button"
        aria-label={`${label}: ${selected?.label ?? ""}`}
        aria-haspopup="listbox"
        aria-expanded={position !== null}
        aria-controls={position ? listId : undefined}
        onClick={toggle}
        onKeyDown={position ? handleKeyDown : undefined}
      >
        {selected?.leading}
        <span className="popup-picker__value" style={selected?.labelStyle}>
          {selected?.label ?? ""}
        </span>
        <ChevronDown size={14} className="popup-picker__chevron" aria-hidden />
      </button>
      {position
        ? createPortal(
            <div ref={popover.listRef} className="popup-picker__popover" style={position} onKeyDown={handleKeyDown}>
              {searchPlaceholder ? (
                <input
                  className="popup-picker__search"
                  type="search"
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  value={query}
                  onChange={handleQuery}
                  autoFocus
                />
              ) : null}
              <PickerList
                id={listId}
                label={label}
                sections={visible}
                active={active}
                selectedId={selectedId}
                focusable={!searchPlaceholder}
                emptyNote={loadingNote ?? "Nothing matches."}
                onChoose={choose}
                onHover={setActive}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

interface PickerListProps {
  readonly id: string;
  readonly label: string;
  readonly sections: readonly PickerSection[];
  readonly active: number;
  readonly selectedId: string;
  /** The list takes focus itself when there is no search field to hold it. */
  readonly focusable: boolean;
  readonly emptyNote: string;
  readonly onChoose: (id: string) => void;
  readonly onHover: (index: number) => void;
}

/** The sections and their options; the highlighted one scrolls into view. */
function PickerList({ id, label, sections, active, selectedId, focusable, emptyNote, onChoose, onHover }: PickerListProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  // Each section's first option's index in the whole list.
  const starts: number[] = [];
  let next = 0;
  for (const section of sections) {
    starts.push(next);
    next += section.items.length;
  }
  return (
    <div ref={listRef} id={id} className="popup-picker__list" role="listbox" aria-label={label} tabIndex={focusable ? 0 : -1}>
      {sections.map((section, sectionIndex) => (
        <div key={section.title ?? "items"} role="group" aria-label={section.title}>
          {section.title ? <p className="popup-picker__section">{section.title}</p> : null}
          {section.items.map((item, itemIndex) => {
            const index = starts[sectionIndex] + itemIndex;
            return (
              <PickerOption
                key={item.id}
                item={item}
                index={index}
                active={index === active}
                selected={item.id === selectedId}
                onChoose={onChoose}
                onHover={onHover}
              />
            );
          })}
        </div>
      ))}
      {sections.length === 0 ? <p className="popup-picker__note">{emptyNote}</p> : null}
    </div>
  );
}

interface PickerOptionProps {
  readonly item: PickerItem;
  readonly index: number;
  readonly active: boolean;
  readonly selected: boolean;
  readonly onChoose: (id: string) => void;
  readonly onHover: (index: number) => void;
}

function PickerOption({ item, index, active, selected, onChoose, onHover }: PickerOptionProps) {
  const handleClick = useCallback(() => onChoose(item.id), [onChoose, item.id]);
  const handleEnter = useCallback(() => onHover(index), [onHover, index]);
  return (
    <div
      role="option"
      aria-selected={selected}
      data-index={index}
      className={`popup-picker__option${active ? " popup-picker__option--active" : ""}`}
      onClick={handleClick}
      onPointerEnter={handleEnter}
    >
      <span className="popup-picker__check" aria-hidden>
        {selected ? <Check size={13} /> : null}
      </span>
      {item.leading}
      <span className="popup-picker__label" style={item.labelStyle}>
        {item.label}
      </span>
    </div>
  );
}
