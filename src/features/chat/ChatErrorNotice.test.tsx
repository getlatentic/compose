import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatErrorNotice } from "./ChatErrorNotice";

const CONNECTION_REFUSED =
  "Ollama is not reachable at http://localhost:11434 … Connection refused (os error 61)";

describe("ChatErrorNotice", () => {
  it("shows the friendly summary, not the raw text, while collapsed", () => {
    const html = renderToStaticMarkup(
      <ChatErrorNotice raw={CONNECTION_REFUSED} harnessName="Ollama" onRetry={() => {}} />,
    );
    // (the apostrophe is HTML-entity-encoded in static markup, so match around it)
    expect(html).toContain("running — start it, then retry.");
    // The raw os-error detail stays hidden until the user expands Details.
    expect(html).not.toContain("os error 61");
    expect(html).toContain("Retry");
    expect(html).toContain("Details");
  });

  it("omits Retry when no handler is given and Set up only when offered", () => {
    const html = renderToStaticMarkup(<ChatErrorNotice raw="boom" harnessName="Claude" />);
    expect(html).not.toContain("Retry");
    expect(html).not.toContain("Set up");
  });

  it("offers a Set-up link for the not-ready case", () => {
    const html = renderToStaticMarkup(
      <ChatErrorNotice raw="needs a key" harnessName="Codex" onOpenSettings={() => {}} />,
    );
    expect(html).toContain("Set up");
  });
});
