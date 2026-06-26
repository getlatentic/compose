import type { InstallKind } from "../../lib/ipc/harnessClient";

/** Presentation for an install-kind badge: a short label, a Carbon Tag tone, and
 *  a one-line plain-English note on what the kind means for staying current. */
export interface InstallKindBadge {
  label: string;
  tone: "green" | "warm-gray" | "blue" | "purple";
  /** Why it matters — shown beside the badge / in the Details disclosure. */
  note: string;
}

/** Badge metadata per install kind. A registry (not an inline chain) so a new
 *  kind is one entry, and the view stays declarative. */
const BADGES: Record<InstallKind, InstallKindBadge> = {
  native: {
    label: "Native",
    tone: "green",
    note: "Native build — installs its own updates automatically.",
  },
  "npm-global": {
    label: "npm",
    tone: "warm-gray",
    note: "Installed via npm. The native build starts faster and updates itself — switching replaces the npm binary.",
  },
  homebrew: {
    label: "Homebrew",
    tone: "blue",
    note: "Installed via Homebrew — update with brew.",
  },
  bundled: {
    label: "Bundled",
    tone: "purple",
    note: "Ships inside Compose.",
  },
  unknown: {
    label: "Custom",
    tone: "warm-gray",
    note: "Resolved from an unrecognized location.",
  },
};

export function installKindBadge(kind: InstallKind): InstallKindBadge {
  return BADGES[kind];
}
