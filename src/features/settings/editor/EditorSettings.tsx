import { useCallback } from "react";

import { useUiStore } from "../../../app/store/uiStore";
import type { ExportFont } from "../../../lib/theme/exportFont";
import { DEFAULT_READING_SIZE, MAX_READING_SIZE, MIN_READING_SIZE } from "../../../lib/theme/reading";
import type { EditorScheme } from "../../../lib/theme/theme";
import { SegmentedControl, type SegmentOption } from "../../shared/SegmentedControl";
import { Stepper } from "../../shared/Stepper";
import { NoteBackgroundSetting, ResetToThemeButton } from "../appearance/NoteBackgroundSetting";
import { FontPicker } from "./FontPicker";
import { ThemePicker } from "./ThemePicker";

const SCHEME_OPTIONS: readonly SegmentOption<EditorScheme>[] = [
  { value: "app", label: "Match app" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const EXPORT_FONT_OPTIONS: readonly SegmentOption<ExportFont>[] = [
  { value: "note", label: "Note's font" },
  { value: "latex", label: "LaTeX" },
];

/**
 * Settings → Editor: how notes look, apart from the app around them. A theme
 * sets the note's colours and font; each can be changed here, and Reset hands
 * them back. The preview at the top is drawn with the same rules as the
 * editor, so every change shows before you leave.
 */
export function EditorSettings() {
  const editorScheme = useUiStore((state) => state.editorScheme);
  const setEditorScheme = useUiStore((state) => state.setEditorScheme);
  const exportFont = useUiStore((state) => state.exportFont);
  const setExportFont = useUiStore((state) => state.setExportFont);

  return (
    <div className="appearance-settings">
      <EditorPreview />
      <section className="appearance-settings__group" aria-labelledby="editor-look-label">
        <div className="appearance-settings__heading-row">
          <h3 id="editor-look-label">Look</h3>
          <ResetToThemeButton />
        </div>
        <Row label="Theme" id="editor-theme-label">
          <ThemePicker />
        </Row>
        <Row label="Appearance" id="editor-scheme-label">
          <SegmentedControl name="editor-scheme" labelledBy="editor-scheme-label" options={SCHEME_OPTIONS} value={editorScheme} onChange={setEditorScheme} />
        </Row>
        <NoteBackgroundSetting />
      </section>
      <section className="appearance-settings__group" aria-labelledby="editor-type-label">
        <h3 id="editor-type-label">Type</h3>
        <Row label="Font" id="editor-font-label">
          <FontPicker />
        </Row>
        <Row label="Text size" id="reading-size-label">
          <TextSizeControl />
        </Row>
        <Row label="Exports" id="export-font-label">
          <SegmentedControl name="export-font" labelledBy="export-font-label" options={EXPORT_FONT_OPTIONS} value={exportFont} onChange={setExportFont} />
        </Row>
        <p className="settings-helper">Exports are PDF, HTML, printing and images: in your note's font, or in LaTeX's Latin Modern.</p>
      </section>
    </div>
  );
}

function Row({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="appearance-settings__row">
      <span id={id} className="appearance-settings__row-label">
        {label}
      </span>
      {children}
    </div>
  );
}

/** A heading and a paragraph in the note's look, so a change shows here first. */
function EditorPreview() {
  return (
    <figure className="editor-preview" aria-label="Preview">
      <p className="editor-preview__heading">Why plain files</p>
      <p className="editor-preview__body">
        A note should outlive the app it was written in. Plain markdown means your words move with you, to another
        editor, another computer, another decade.
      </p>
    </figure>
  );
}

/** The body size in px, one point at a time; headings scale with it. */
function TextSizeControl() {
  const readingSize = useUiStore((state) => state.readingSize);
  const setReadingSize = useUiStore((state) => state.setReadingSize);
  const smaller = useCallback(() => setReadingSize(readingSize - 1), [setReadingSize, readingSize]);
  const larger = useCallback(() => setReadingSize(readingSize + 1), [setReadingSize, readingSize]);
  const reset = useCallback(() => setReadingSize(DEFAULT_READING_SIZE), [setReadingSize]);
  return (
    <div className="zoom-control">
      <Stepper
        labelledBy="reading-size-label"
        valueLabel={`${readingSize} px`}
        decreaseLabel="Smaller text"
        increaseLabel="Larger text"
        canDecrease={readingSize > MIN_READING_SIZE}
        canIncrease={readingSize < MAX_READING_SIZE}
        onDecrease={smaller}
        onIncrease={larger}
      />
      <button type="button" className="settings-link-button" disabled={readingSize === DEFAULT_READING_SIZE} onClick={reset}>
        Default
      </button>
    </div>
  );
}
