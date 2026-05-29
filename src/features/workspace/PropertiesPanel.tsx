import { memo, useMemo, useState } from "react";
import { Add, TrashCan } from "@carbon/react/icons";
import {
  parseFrontmatter,
  serializeMarkdown,
  type Frontmatter,
  type FrontmatterValue,
} from "../editor/frontmatter";

/**
 * Sidebar Properties section.
 *
 * Renders the active file's YAML frontmatter as editable key/value
 * rows. This is the user-facing surface for the metadata the
 * WYSIWYG editor hides — they get a clean writing surface plus a
 * structured place to set status / tags / dates / etc.
 *
 * Round-trip model: we own neither the markdown nor the
 * frontmatter — both come from the active buffer in the store.
 * Edits here re-serialize the full markdown (frontmatter + body)
 * and call `onChange` with the new string. The editor's value
 * sync picks it up, re-parses, updates its own body / frontmatter
 * refs.
 *
 * Why only flat primitives in the row UI: arrays show as comma-
 * separated chips, nested objects fall through to a raw string
 * edit. The 80%-case for these docs (status / tags / dates /
 * boolean flags) maps cleanly to flat rows; anything weirder
 * round-trips via SOURCE mode without us trying to grow a YAML
 * editor.
 */
interface PropertiesPanelProps {
  markdown: string;
  onChange: (next: string) => void;
}

function PropertiesPanelInner({ markdown, onChange }: PropertiesPanelProps) {
  const doc = useMemo(() => parseFrontmatter(markdown), [markdown]);
  const entries = useMemo(() => Object.entries(doc.frontmatter ?? {}), [doc.frontmatter]);
  const [draftKey, setDraftKey] = useState("");

  function commitFrontmatter(next: Frontmatter | null) {
    onChange(serializeMarkdown({ frontmatter: next, body: doc.body }));
  }

  function setField(key: string, value: FrontmatterValue) {
    const updated: Frontmatter = { ...(doc.frontmatter ?? {}), [key]: value };
    commitFrontmatter(updated);
  }

  function removeField(key: string) {
    if (!doc.frontmatter) return;
    const updated: Frontmatter = { ...doc.frontmatter };
    delete updated[key];
    commitFrontmatter(Object.keys(updated).length === 0 ? null : updated);
  }

  function addField() {
    const trimmed = draftKey.trim();
    if (!trimmed) return;
    // Don't clobber an existing key; the user can edit it directly.
    if (doc.frontmatter && trimmed in doc.frontmatter) {
      setDraftKey("");
      return;
    }
    setField(trimmed, "");
    setDraftKey("");
  }

  return (
    <div className="bob-sidebar-properties">
      <div className="bob-section-label">
        <span>Properties</span>
        <span className="bob-section-meta">
          {entries.length === 0 ? "Empty" : `${entries.length} field${entries.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {entries.length > 0 ? (
        <ul className="bob-properties-list">
          {entries.map(([key, value]) => (
            <PropertyRow
              key={key}
              propertyKey={key}
              value={value}
              onValueChange={(next) => setField(key, next)}
              onRemove={() => removeField(key)}
            />
          ))}
        </ul>
      ) : (
        <p className="bob-properties-empty">
          No frontmatter on this file. Add a field below to start tracking metadata.
        </p>
      )}
      <div className="bob-properties-add">
        <input
          aria-label="New property name"
          className="bob-properties-add__key"
          placeholder="New field name"
          value={draftKey}
          onChange={(event) => setDraftKey(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addField();
            }
          }}
        />
        <button
          type="button"
          className="bob-icon-button"
          onClick={addField}
          aria-label="Add property"
          title="Add property"
          disabled={!draftKey.trim()}
        >
          <Add size={16} />
        </button>
      </div>
    </div>
  );
}

/**
 * One frontmatter field row. Renders an inline editor whose shape
 * matches the value's type:
 *   - string / number / null → text input
 *   - boolean → checkbox
 *   - array of primitives → comma-separated text input, parsed
 *     back to an array on commit
 *   - nested object → text input editing the raw JSON (escape
 *     hatch — Source mode is the real editor for these)
 */
function PropertyRow({
  propertyKey,
  value,
  onValueChange,
  onRemove,
}: {
  propertyKey: string;
  value: FrontmatterValue;
  onValueChange: (next: FrontmatterValue) => void;
  onRemove: () => void;
}) {
  const [text, setText] = useState(() => formatForEdit(value));
  const [isFocused, setIsFocused] = useState(false);

  // Keep the local text in sync when the underlying value changes
  // externally (e.g., Bob updates the frontmatter, or the user
  // edits the raw file via SOURCE mode). We only do this when the
  // row isn't currently focused so the user's in-progress typing
  // doesn't get clobbered.
  if (!isFocused) {
    const expected = formatForEdit(value);
    if (expected !== text) {
      // Render-time set is normally a smell — but the alternative
      // (an effect) would still be one frame stale, and we're
      // gated on `!isFocused` so there's no loop with typing.
      setText(expected);
    }
  }

  if (typeof value === "boolean") {
    return (
      <li className="bob-property-row">
        <span className="bob-property-row__key">{propertyKey}</span>
        <input
          type="checkbox"
          className="bob-property-row__checkbox"
          checked={value}
          onChange={(event) => onValueChange(event.target.checked)}
          aria-label={`${propertyKey} toggle`}
        />
        <button
          type="button"
          className="bob-property-row__remove"
          onClick={onRemove}
          aria-label={`Remove ${propertyKey}`}
          title="Remove field"
        >
          <TrashCan size={14} />
        </button>
      </li>
    );
  }

  return (
    <li className="bob-property-row">
      <span className="bob-property-row__key">{propertyKey}</span>
      <input
        className="bob-property-row__input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          onValueChange(parseFromEdit(text, value));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        placeholder={Array.isArray(value) ? "value1, value2" : "value"}
        aria-label={`${propertyKey} value`}
      />
      <button
        type="button"
        className="bob-property-row__remove"
        onClick={onRemove}
        aria-label={`Remove ${propertyKey}`}
        title="Remove field"
      >
        <TrashCan size={14} />
      </button>
    </li>
  );
}

/**
 * Convert a frontmatter value to its text-input representation.
 * Arrays render as comma-joined; nested objects as JSON; nulls
 * as empty string.
 */
function formatForEdit(value: FrontmatterValue): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(", ");
  }
  return JSON.stringify(value);
}

/**
 * Convert text-input back to a frontmatter value. Preserves the
 * type-shape of the previous value where reasonable:
 *   - was an array → split on commas
 *   - was a number → try parse
 *   - was a nested object → try JSON parse
 *   - everything else → string
 */
function parseFromEdit(text: string, previous: FrontmatterValue): FrontmatterValue {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  if (Array.isArray(previous)) {
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  if (typeof previous === "number") {
    const num = Number(trimmed);
    if (!Number.isNaN(num)) return num;
    return trimmed;
  }
  if (previous != null && typeof previous === "object" && !Array.isArray(previous)) {
    try {
      return JSON.parse(trimmed) as FrontmatterValue;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/**
 * Memoized export. PropertiesPanel sits in the left sidebar and its
 * `markdown` prop only changes when the active buffer's content
 * mutates — but the parent (AppShell) re-renders on every workspace
 * store tick (chat tokens, fs events, autosaves). Memo means we skip
 * the frontmatter parse + row diff when the markdown string is
 * referentially equal to last render.
 */
export const PropertiesPanel = memo(PropertiesPanelInner);
