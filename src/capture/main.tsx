import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@latentic/live-markdown/styles.css";
import "../styles/fonts.css";
import "../styles/_tokens.scss";
import { installGlobalErrorReporter } from "../lib/diagnostics/errorReporter";
import { loadUiPrefs } from "../lib/prefs/uiPrefs";
import { applyAppearance } from "../lib/theme/appearance";
import { installPaletteStyles } from "../lib/theme/paletteCss";
import { syncWindowAppearance } from "../lib/theme/windowChrome";
import { tauriCaptureApi } from "./captureApi";
import { QuickNoteWindow } from "./QuickNoteWindow";
import "./quickCapture.css";

installGlobalErrorReporter();
installPaletteStyles(document);
const prefs = loadUiPrefs();
applyAppearance(prefs, document.documentElement);
void syncWindowAppearance(prefs.theme);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QuickNoteWindow api={tauriCaptureApi} />
    </StrictMode>,
  );
}
