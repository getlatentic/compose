import { ChatBot } from "@carbon/react/icons";

/**
 * Boot + initial-scan splash. Renders the SAME brand mark + wordmark + loading
 * pulse as the pre-React splash in index.html, so the HTML → React handoff is
 * one continuous screen rather than a brand-then-bare-icon flicker. The
 * `--seamless` modifier drops the fade-in (the HTML splash already played it)
 * so the swap doesn't re-fade. Used by AppRouter (boot hydration) and MainApp
 * (the active workspace's first scan). Keep in sync with index.html's
 * `.app-splash`.
 */
export function SplashScreen() {
  return (
    <div className="app-splash app-splash--seamless" role="status" aria-label="Loading">
      <span className="app-splash__mark" aria-hidden="true">
        <ChatBot size={36} />
      </span>
      <div className="app-splash__wordmark">
        <span className="app-splash__name">Compose</span>
        <span className="app-splash__descriptor">AI for everyone</span>
      </div>
      <div className="app-splash__pulse" aria-hidden="true" />
    </div>
  );
}
