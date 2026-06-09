import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { HarnessInfo } from "../../lib/ipc/bobClient";
import { ChatHarnessPickerView } from "./ChatHarnessPicker";

/** A minimal valid catalog entry — only `id`/`displayName` matter here. */
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

describe("ChatHarnessPickerView", () => {
  it("shows the selected harness under the Assistant label", () => {
    const html = renderToStaticMarkup(
      <ChatHarnessPickerView
        harnesses={[harness("bob", "Bob"), harness("codex", "Codex")]}
        selectedId="codex"
        onSelect={() => {}}
      />,
    );
    // The inline Dropdown's trigger reflects the current selection…
    expect(html).toContain("Codex");
    // …under Carbon's `titleText` label (also the control's accessible name).
    expect(html).toContain("Assistant");
  });

  it("disables the control when asked (mid-run)", () => {
    const props = {
      harnesses: [harness("bob", "Bob")],
      selectedId: "bob",
      onSelect: () => {},
    };
    expect(renderToStaticMarkup(<ChatHarnessPickerView {...props} disabled />)).toContain(
      "disabled",
    );
  });

  it("renders nothing when there is no catalog (browser preview)", () => {
    expect(
      renderToStaticMarkup(
        <ChatHarnessPickerView harnesses={[]} selectedId="bob" onSelect={() => {}} />,
      ),
    ).toBe("");
  });
});
