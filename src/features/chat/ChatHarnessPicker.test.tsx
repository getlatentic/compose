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
  it("renders an option per harness, with the selected one marked", () => {
    const html = renderToStaticMarkup(
      <ChatHarnessPickerView
        harnesses={[harness("bob", "Bob"), harness("codex", "Codex")]}
        selectedId="codex"
        onSelect={() => {}}
      />,
    );
    expect(html).toContain(">Bob</option>");
    expect(html).toContain(">Codex</option>");
    // The control reflects the current selection (React renders the matching
    // option as selected for a controlled <select>).
    expect(html).toContain("selected");
    // Carbon's `labelText` gives the control its accessible name.
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
    expect(
      renderToStaticMarkup(<ChatHarnessPickerView {...props} disabled={false} />),
    ).not.toContain("disabled");
  });

  it("renders nothing when there is no catalog (browser preview)", () => {
    expect(
      renderToStaticMarkup(
        <ChatHarnessPickerView harnesses={[]} selectedId="bob" onSelect={() => {}} />,
      ),
    ).toBe("");
  });
});
