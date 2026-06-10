import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { installGlobalErrorReporter } from "./lib/diagnostics/errorReporter";
import "./styles/global.scss";

// Capture uncaught errors / rejections to the local log before anything renders.
installGlobalErrorReporter();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// We used to gate the native window's first show() on a
// requestAnimationFrame after React mount (the idea: avoid the
// black flash during the ~300ms before our splash paints). That
// turned out to be a footgun on macOS — WKWebView throttles RAF
// (and many timers) in hidden windows, so the callback never
// fires and the window stays invisible forever (just the menu
// bar appears). The fix is structural, not procedural: the Tauri
// config now boots with `backgroundColor: #ffffff` and
// `index.html` ships a tiny static splash, so the native window
// can be visible from frame zero and the user only ever sees the
// splash → React handoff.
