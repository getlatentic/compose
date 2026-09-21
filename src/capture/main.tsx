import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { tauriCaptureApi } from "./captureApi";
import { QuickCapture } from "./QuickCapture";
import "./quickCapture.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QuickCapture api={tauriCaptureApi} />
    </StrictMode>,
  );
}
