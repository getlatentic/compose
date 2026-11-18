import { applyPalette } from "./palettes";
import { applyReadingStyle, type ReadingFont, type ReadingSize } from "./reading";
import { applyTheme, type ThemeChoice } from "./theme";

/** Everything Settings → Appearance chooses, as the root attributes that carry it. */
export interface Appearance {
  readonly theme: ThemeChoice;
  readonly palette: string;
  readonly readingFont: ReadingFont;
  readonly readingSize: ReadingSize;
}

export function applyAppearance(appearance: Appearance, root: HTMLElement): void {
  applyTheme(appearance.theme, root);
  applyPalette(appearance.palette, root);
  applyReadingStyle(appearance.readingFont, appearance.readingSize, root);
}
