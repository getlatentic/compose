import { useCallback, useEffect, useMemo, useState } from "react";

import { useUiStore } from "../../../app/store/uiStore";
import { loadInstalledFamilies } from "../../../lib/theme/installedFonts";
import { cssFamily, effectiveReadingFont, type ReadingFont } from "../../../lib/theme/reading";
import { PopupPicker, type PickerItem, type PickerSection } from "../../shared/PopupPicker";

/** Each choice written in its own face, so the list is its own preview. */
const COMPOSE_FONTS: readonly { font: ReadingFont; label: string; family: string }[] = [
  { font: "theme", label: "Theme's font", family: "var(--font-doc-body)" },
  { font: "serif", label: "IBM Plex Serif", family: "var(--font-plex-serif)" },
  { font: "sans", label: "IBM Plex Sans", family: "var(--font-plex-sans)" },
  { font: "mono", label: "JetBrains Mono", family: "var(--font-jetbrains-mono)" },
];

const MAC_FONTS: readonly { font: ReadingFont; label: string; family: string }[] = [
  { font: "newYork", label: "New York", family: "var(--font-new-york)" },
  { font: "sfPro", label: "SF Pro", family: "var(--font-system)" },
  { font: "chalkboard", label: "Chalkboard", family: "var(--font-chalkboard)" },
];

const INSTALLED_PREFIX = "installed:";

function item(font: ReadingFont, label: string, family: string): PickerItem {
  return { id: font, label, labelStyle: { fontFamily: family } };
}

/**
 * The note's font, as one pop-up: Compose's own fonts, the Mac's, then every
 * installed font, each written in its own face, with search across them all.
 */
export function FontPicker() {
  const readingFont = useUiStore((state) => state.readingFont);
  const customFont = useUiStore((state) => state.customFont);
  const setReadingFont = useUiStore((state) => state.setReadingFont);
  const setCustomFont = useUiStore((state) => state.setCustomFont);
  const [installed, setInstalled] = useState<string[] | null>(null);

  useEffect(() => {
    let live = true;
    void loadInstalledFamilies().then((families) => {
      if (live) setInstalled(families);
    });
    return () => {
      live = false;
    };
  }, []);

  const sections = useMemo<PickerSection[]>(() => {
    const installedItems = (installed ?? []).map((family) => ({
      id: `${INSTALLED_PREFIX}${family}`,
      label: family,
      labelStyle: { fontFamily: cssFamily(family) },
    }));
    // A chosen font that is no longer installed still names itself.
    if (customFont && installed !== null && !installed.includes(customFont)) {
      installedItems.unshift({ id: `${INSTALLED_PREFIX}${customFont}`, label: customFont, labelStyle: { fontFamily: cssFamily(customFont) } });
    }
    return [
      { title: "Compose", items: COMPOSE_FONTS.map((font) => item(font.font, font.label, font.family)) },
      { title: "Mac", items: MAC_FONTS.map((font) => item(font.font, font.label, font.family)) },
      { title: "Installed", items: installedItems },
    ];
  }, [installed, customFont]);

  const effective = effectiveReadingFont(readingFont, customFont);
  const selectedId = effective === "custom" && customFont ? `${INSTALLED_PREFIX}${customFont}` : effective;

  const choose = useCallback(
    (id: string) => {
      if (id.startsWith(INSTALLED_PREFIX)) setCustomFont(id.slice(INSTALLED_PREFIX.length));
      else setReadingFont(id as ReadingFont);
    },
    [setCustomFont, setReadingFont],
  );

  return (
    <PopupPicker
      label="Font"
      selectedId={selectedId}
      sections={sections}
      onSelect={choose}
      searchPlaceholder="Search fonts"
      loadingNote={installed === null ? "Reading your fonts…" : undefined}
    />
  );
}
