/**
 * Boot / initial-load placeholder: the empty three-pane shell (sidebar |
 * editor | chat) with its dividers, matching the pre-React skeleton in
 * index.html so the HTML → React → app handoff is one continuous fill-in —
 * the real panes' content drops into the same structure, with no brand-splash
 * blink. Rendered by AppRouter's hydration gate and SetupScreen's loading
 * state. Styled by `.app-skeleton` in global.scss; keep in sync with index.html.
 */
export function SplashScreen() {
  return (
    <div className="app-skeleton" role="status" aria-label="Loading">
      <div className="app-skeleton__pane app-skeleton__pane--sidebar" />
      <div className="app-skeleton__pane app-skeleton__pane--editor" />
      <div className="app-skeleton__pane app-skeleton__pane--chat" />
    </div>
  );
}
