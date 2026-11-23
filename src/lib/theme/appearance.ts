import { applyPalette } from "./palettes";
import { applyReadingStyle, type ReadingFont, type ReadingSize } from "./reading";
import { applyEditorScheme, applyTheme, type EditorScheme, type ThemeChoice } from "./theme";

/** Everything Settings → Appearance chooses, as the root attributes that carry it. */
export interface Appearance {
  readonly theme: ThemeChoice;
  readonly palette: string;
  readonly readingFont: ReadingFont;
  readonly readingSize: ReadingSize;
  /** The installed font "custom" reads in. */
  readonly customFont: string | null;
  /** The note panel's own light or dark. */
  readonly editorScheme: EditorScheme;
}

export function applyAppearance(appearance: Appearance, root: HTMLElement): void {
  applyTheme(appearance.theme, root);
  applyPalette(appearance.palette, root);
  applyReadingStyle(appearance.readingFont, appearance.readingSize, appearance.customFont, root);
  applyEditorScheme(appearance.editorScheme, root);
}
