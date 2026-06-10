import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { HarnessInfo } from "../../lib/ipc/bobClient";
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
  tokenLabel: "25.7K tokens",
  disabled: false,
};

describe("ChatComposerFooterView", () => {
  it("shows the selected harness, model, token count, and send hint", () => {
    const html = renderToStaticMarkup(<ChatComposerFooterView {...base} />);
    expect(html).toContain("Codex"); // harness trigger
    expect(html).toContain("gpt-5-codex"); // model trigger
    expect(html).toContain("25.7K tokens"); // token count
    expect(html).toContain("to send"); // the ↵ hint
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
});
