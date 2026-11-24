import { useMemo } from "react";

import { useUiStore } from "../../../app/store/uiStore";
import { PALETTES } from "../../../lib/theme/palettes";
import { PopupPicker, type PickerSection } from "../../shared/PopupPicker";

/** A theme as a tiny page: its sidebar, page colour and accent rule. */
function Swatch({ id }: { id: string }) {
  return (
    <span className="theme-swatch" data-palette={id} aria-hidden>
      <span className="theme-swatch__side" />
      <span className="theme-swatch__page">
        <span className="theme-swatch__rule" />
      </span>
    </span>
  );
}

/** The note's colour theme, as one pop-up: a swatch and a name per theme. */
export function ThemePicker() {
  const palette = useUiStore((state) => state.palette);
  const setPalette = useUiStore((state) => state.setPalette);
  const sections = useMemo<PickerSection[]>(
    () => [{ items: PALETTES.map((entry) => ({ id: entry.id, label: entry.label, leading: <Swatch id={entry.id} /> })) }],
    [],
  );
  return <PopupPicker label="Theme" selectedId={palette} sections={sections} onSelect={setPalette} />;
}
