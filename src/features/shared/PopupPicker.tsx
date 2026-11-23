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

/**
 * A Mac pop-up button: the current choice, and a short list under it to
 * change it. Stays compact however many choices there are, with sections
 * and, for long lists, a search field. Arrow keys move, Return chooses,
 * Escape closes.
 */
export function PopupPicker({ label, selectedId, sections, onSelect, searchPlaceholder, loadingNote }: PopupPickerProps) {
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const selected = useMemo(() => sections.flatMap((section) => section.items).find((item) => item.id === selectedId), [sections, selectedId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let budget = MAX_ROWS;
    return sections
      .map((section) => {
        const items = (needle ? section.items.filter((item) => item.label.toLowerCase().includes(needle)) : section.items).slice(0, budget);
        budget -= items.length;
        return { ...section, items };
      })
      .filter((section) => section.items.length > 0);
  }, [sections, query]);
  const flat = useMemo(() => visible.flatMap((section) => section.items), [visible]);

  const close = useCallback(() => {
    setPosition(null);
    setQuery("");
    buttonRef.current?.focus();
  }, []);

  const open = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    setPosition(
      below > 320
        ? { top: rect.bottom + 4, left: rect.left, minInlineSize: rect.width }
        : { bottom: window.innerHeight - rect.top + 4, left: rect.left, minInlineSize: rect.width },
    );
    setActive(Math.max(0, flat.findIndex((item) => item.id === selectedId)));
  }, [flat, selectedId]);

  const toggle = useCallback(() => (position ? close() : open()), [position, close, open]);

  const choose = useCallback(
    (id: string) => {
      onSelect(id);
      close();
    },
    [onSelect, close],
  );

  useEffect(() => {
    if (!position) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !listRef.current?.contains(target)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [position, close]);

  useEffect(() => {
    if (!position) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, position]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((index) => Math.min(flat.length - 1, index + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((index) => Math.max(0, index - 1));
      } else if (event.key === "Enter" && flat[active]) {
        event.preventDefault();
        choose(flat[active].id);
      }
    },
    [close, flat, active, choose],
  );

  const handleQuery = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setActive(0);
  }, []);

  let index = -1;
  return (
    <>
      <button
        ref={buttonRef}
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
            <div ref={listRef} className="popup-picker__popover" style={position} onKeyDown={handleKeyDown}>
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
              <div id={listId} className="popup-picker__list" role="listbox" aria-label={label} tabIndex={searchPlaceholder ? -1 : 0}>
                {visible.map((section) => (
                  <div key={section.title ?? "items"} role="group" aria-label={section.title}>
                    {section.title ? <p className="popup-picker__section">{section.title}</p> : null}
                    {section.items.map((item) => {
                      index += 1;
                      return (
                        <PickerOption
                          key={item.id}
                          item={item}
                          index={index}
                          active={index === active}
                          selected={item.id === selectedId}
                          onChoose={choose}
                          onHover={setActive}
                        />
                      );
                    })}
                  </div>
                ))}
                {flat.length === 0 ? <p className="popup-picker__note">{loadingNote ?? "Nothing matches."}</p> : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
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
