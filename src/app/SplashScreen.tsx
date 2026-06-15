import { ChatBot } from "@carbon/react/icons";

/**
 * Single visible state during boot and the initial workspace scan — a centered
 * brand mark on the same background the workspace uses, so the transition to
 * the real UI is a content swap under one frame (not a flash of color). No
 * spinner: a moving indicator on a sub-second load reads as "something's wrong"
 * more than "loading." Used by AppRouter (boot hydration) and MainApp (scan).
 */
export function SplashScreen() {
  return (
    <div className="boot-loading" role="status" aria-label="Loading">
      <span className="boot-loading__mark" aria-hidden="true">
        <ChatBot size={36} />
      </span>
    </div>
  );
}
