import { useState } from "react";

import { AgentsSettings } from "./AgentsSettings";
import { GeneralSettings } from "./GeneralSettings";
import { AboutSettings } from "./AboutSettings";

const CATEGORIES = [
  { id: "agents", label: "AI agents" },
  { id: "general", label: "General" },
  { id: "about", label: "About" },
] as const;
type CategoryId = (typeof CATEGORIES)[number]["id"];

/**
 * Settings content — a macOS-style vertical category rail plus a content pane.
 * Rendered either inside a workspace tab (the pane host) or, on the dashboard
 * where there is no tab strip, inside the modal wrapper
 * [SettingsDialog](./SettingsDialog.tsx). It owns no chrome (no backdrop / title
 * bar) so it composes into either host.
 */
export function SettingsPanel() {
  const [category, setCategory] = useState<CategoryId>("agents");

  return (
    <div className="settings-shell">
      <nav className="settings-nav" aria-label="Settings sections">
        {CATEGORIES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={[
              "settings-nav__item",
              category === entry.id ? "settings-nav__item--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-current={category === entry.id}
            onClick={() => setCategory(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>
      <div className="settings-content">
        {category === "agents" ? (
          <AgentsSettings />
        ) : category === "general" ? (
          <GeneralSettings />
        ) : (
          <AboutSettings />
        )}
      </div>
    </div>
  );
}
