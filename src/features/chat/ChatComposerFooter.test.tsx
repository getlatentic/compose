import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { HarnessInfo } from "../../lib/ipc/harnessClient";
import { ChatComposerFooterView } from "./ChatComposerFooter";

function harness(id: string, displayName: string): HarnessInfo {
  return {
    id,
    displayName,
    description: "",
    requiresInstall: false,
    capabilities: {
      credentialRequired: false,
      previewsEdits: false,
      models: [],
      allowsCustomModel: false,
      supportsEffort: false,
      supportsMaxTurns: false,
      supportsLogin: false,
      supportsCustomInstructions: false,
    },
  };
}

const base = {
  harnesses: [harness("bob", "Bob"), harness("codex", "Codex")],
  selectedHarnessId: "codex",
  onSelectHarness: () => {},
  modelItems: [
    { value: "", label: "Default" },
    { value: "gpt-5-codex", label: "gpt-5-codex" },
  ],
  selectedModel: "gpt-5-codex",
  modelLabel: "gpt-5-codex",
  onSelectModel: () => {},
  disabled: false,
};

describe("ChatComposerFooterView", () => {
  it("shows the selected harness and model", () => {
    const html = renderToStaticMarkup(<ChatComposerFooterView {...base} />);
    expect(html).toContain("Codex"); // harness trigger
    expect(html).toContain("gpt-5-codex"); // model trigger
  });

  it("omits the model selector when there's nothing to switch among", () => {
    const html = renderToStaticMarkup(
      <ChatComposerFooterView {...base} modelItems={[]} modelLabel="Default" selectedModel="" />,
    );
    expect(html).not.toContain('aria-label="Model"');
    // …but the harness selector is always present.
    expect(html).toContain('aria-label="Assistant"');
  });

  it("disables the selectors mid-run", () => {
    const html = renderToStaticMarkup(<ChatComposerFooterView {...base} disabled />);
    expect(html).toContain("disabled");
  });

  it("renders nothing without a catalog (browser preview)", () => {
    expect(renderToStaticMarkup(<ChatComposerFooterView {...base} harnesses={[]} />)).toBe("");
  });

  it("hides the review/auto-apply toggle by default", () => {
    const html = renderToStaticMarkup(<ChatComposerFooterView {...base} />);
    expect(html).not.toContain('role="switch"');
  });

  it("shows an Auto-apply pill (switch off) for a write-capable harness", () => {
    const html = renderToStaticMarkup(
      <ChatComposerFooterView {...base} showReviewToggle reviewEdits={false} />,
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("Auto-apply");
  });

  it("shows a Review edits pill (switch on) when reviewEdits is set", () => {
    const html = renderToStaticMarkup(
      <ChatComposerFooterView {...base} showReviewToggle reviewEdits />,
    );
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Review edits");
  });

  it("shows an Offline marker beside the model when the harness is unavailable", () => {
    const html = renderToStaticMarkup(<ChatComposerFooterView {...base} unavailable />);
    expect(html).toContain("Offline");
  });

  it("hides the Offline marker when the harness is available", () => {
    expect(renderToStaticMarkup(<ChatComposerFooterView {...base} />)).not.toContain("Offline");
  });

  it("lets only the model selector shrink-and-truncate, keeping the full name as a tooltip", () => {
    const html = renderToStaticMarkup(
      <ChatComposerFooterView {...base} modelLabel="opencode/deepseek-v4-flash-free" />,
    );
    // The model selector opts into the grow/truncate variant; the harness (short,
    // fixed name) does not — so a long model id can't push out the toggle.
    expect(html.match(/footer-menu--grow/g)).toHaveLength(1);
    // The full label stays reachable as a tooltip when visually truncated.
    expect(html).toContain('title="opencode/deepseek-v4-flash-free"');
  });
});
