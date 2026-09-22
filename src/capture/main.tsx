import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@latentic/live-markdown/styles.css";
import "../styles/_tokens.scss";
import { installGlobalErrorReporter } from "../lib/diagnostics/errorReporter";
import { tauriCaptureApi } from "./captureApi";
import { QuickNoteWindow } from "./QuickNoteWindow";
import "./quickCapture.css";

installGlobalErrorReporter();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QuickNoteWindow api={tauriCaptureApi} />
    </StrictMode>,
  );
}
