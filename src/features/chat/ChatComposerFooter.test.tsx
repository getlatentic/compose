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
  it("collapses the assistant + model into one label", () => {
    const html = renderToStaticMarkup(<ChatComposerFooterView {...base} />);
    expect(html).toContain("Codex/gpt-5-codex");
  });

  it("avoids repeating the assistant when the model id already carries it", () => {
    const html = renderToStaticMarkup(
      <ChatComposerFooterView
        {...base}
        harnesses={[harness("opencode", "OpenCode")]}
        selectedHarnessId="opencode"
        selectedModel="opencode/deepseek-v4-flash-free"
        modelLabel="opencode/deepseek-v4-flash-free"
      />,
    );
    expect(html).toContain("opencode/deepseek-v4-flash-free");
    expect(html).not.toContain("OpenCode/opencode/");
  });

  it("shows just the assistant when there's no model to switch among", () => {
    const html = renderToStaticMarkup(
      <ChatComposerFooterView {...base} modelItems={[]} selectedModel="" modelLabel="Default" />,
    );
    expect(html).toContain(">Codex<");
    expect(html).not.toContain("Codex/");
  });

  it("disables the picker mid-run", () => {
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

  it("marks the picker Offline when the harness is unavailable", () => {
    const html = renderToStaticMarkup(<ChatComposerFooterView {...base} unavailable />);
    expect(html).toContain("Offline");
  });

  it("hides the Offline marker when the harness is available", () => {
    expect(renderToStaticMarkup(<ChatComposerFooterView {...base} />)).not.toContain("Offline");
  });
});
