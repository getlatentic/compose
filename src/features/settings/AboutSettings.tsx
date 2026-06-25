import { Link } from "@carbon/react";
import { Launch } from "@carbon/react/icons";

const APP_VERSION = "0.1.0";

/** The "About" settings pane: identity only — name, version, tagline, and the
 *  informational links. The local-only diagnostics (open error log, reset all
 *  data) live in General now, so this stays a slim identity card. */
export function AboutSettings() {
  return (
    <div className="settings-section">
      <h3>Compose</h3>
      <p className="settings-helper">Version {APP_VERSION}</p>
      <p className="settings-helper">
        A local-first AI writing workspace — your notes stay on your computer. AI for everyone.
      </p>
      <div className="about-links">
        <Link renderIcon={Launch}>Release notes</Link>
        <Link renderIcon={Launch}>Licenses</Link>
        <Link renderIcon={Launch}>Privacy</Link>
      </div>
    </div>
  );
}
