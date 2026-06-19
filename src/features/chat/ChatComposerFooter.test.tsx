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
});
