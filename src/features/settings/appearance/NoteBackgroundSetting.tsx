import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useState, type ChangeEvent } from "react";

import { useUiStore } from "../../../app/store/uiStore";
import { storeBackgroundImage } from "../../../lib/ipc/backgroundClient";
import { isTauriRuntime } from "../../../lib/runtime/desktopRuntime";
import { DEFAULT_DIM, type ImageFit, type NoteBackground } from "../../../lib/theme/noteBackground";
import { ColorField } from "../../shared/ColorField";
import { SegmentedControl, type SegmentOption } from "../../shared/SegmentedControl";

type Kind = NoteBackground["kind"];

const KIND_OPTIONS: readonly SegmentOption<Kind>[] = [
  { value: "theme", label: "Theme" },
  { value: "color", label: "Colour" },
  { value: "image", label: "Image" },
];

const FIT_OPTIONS: readonly SegmentOption<ImageFit>[] = [
  { value: "fill", label: "Fill" },
  { value: "tile", label: "Tile" },
];

/** A soft paper colour to start from, for a writer who picks Colour first. */
const STARTING_COLOR = "#f4efe6";

/**
 * Settings → Appearance → Background: the theme's page, a colour, or an
 * image behind the note. An image is copied into Compose's data folder first.
 */
export function NoteBackgroundSetting() {
  const background = useUiStore((state) => state.noteBackground);
  const setBackground = useUiStore((state) => state.setNoteBackground);
  const [error, setError] = useState<string | null>(null);

  const chooseImage = useCallback(async () => {
    setError(null);
    const picked = await open({ multiple: false, directory: false, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
    if (typeof picked !== "string") return;
    try {
      const file = await storeBackgroundImage(picked);
      setBackground({ kind: "image", file, fit: "fill", dim: DEFAULT_DIM });
    } catch (failure) {
      setError(String(failure));
    }
  }, [setBackground]);

  const changeKind = useCallback(
    (kind: Kind) => {
      setError(null);
      if (kind === "theme") setBackground({ kind: "theme" });
      else if (kind === "color") setBackground({ kind: "color", color: STARTING_COLOR });
      else if (background.kind !== "image") void chooseImage();
    },
    [background.kind, chooseImage, setBackground],
  );

  const changeColor = useCallback((color: string) => setBackground({ kind: "color", color }), [setBackground]);
  const changeFit = useCallback(
    (fit: ImageFit) => {
      if (background.kind === "image") setBackground({ ...background, fit });
    },
    [background, setBackground],
  );
  const changeDim = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (background.kind === "image") setBackground({ ...background, dim: Number(event.target.value) / 100 });
    },
    [background, setBackground],
  );
  const handleChoose = useCallback(() => void chooseImage(), [chooseImage]);

  return (
    <>
      <div className="appearance-settings__row">
        <span id="note-bg-label" className="appearance-settings__row-label">
          Background
        </span>
        <SegmentedControl name="note-bg" labelledBy="note-bg-label" options={KIND_OPTIONS} value={background.kind} onChange={changeKind} />
      </div>
      {background.kind === "color" ? (
        <div className="appearance-settings__row">
          <span className="appearance-settings__row-label" />
          <ColorField value={background.color} onChange={changeColor} label="Background colour" />
        </div>
      ) : null}
      {background.kind === "image" ? (
        <>
          <div className="appearance-settings__row">
            <span className="appearance-settings__row-label" />
            <button type="button" className="note-bg__choose" onClick={handleChoose} disabled={!isTauriRuntime()}>
              Choose image…
            </button>
            <SegmentedControl name="note-bg-fit" labelledBy="note-bg-label" options={FIT_OPTIONS} value={background.fit} onChange={changeFit} />
          </div>
          <div className="appearance-settings__row">
            <span id="note-bg-dim-label" className="appearance-settings__row-label">
              Soften
            </span>
            <input
              className="note-bg__dim"
              type="range"
              min={0}
              max={95}
              step={5}
              value={Math.round(background.dim * 100)}
              onChange={changeDim}
              aria-labelledby="note-bg-dim-label"
            />
          </div>
        </>
      ) : null}
      {error ? (
        <p className="settings-helper note-bg__error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** Hands the note's font and background back to the theme. */
export function ResetToThemeButton() {
  const readingFont = useUiStore((state) => state.readingFont);
  const background = useUiStore((state) => state.noteBackground);
  const resetToTheme = useUiStore((state) => state.resetToTheme);
  const customised = readingFont !== "theme" || background.kind !== "theme";
  return (
    <button type="button" className="appearance-settings__reset" onClick={resetToTheme} disabled={!customised}>
      Reset to theme
    </button>
  );
}
