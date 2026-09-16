import { describe, expect, it } from "vitest";

import { defaultExportFileName } from "./documentExport";

describe("the name an export is offered under", () => {
  it("swaps the document's own extension for the export's", () => {
    expect(defaultExportFileName("notes/plan.md", "pdf")).toBe("plan.pdf");
    expect(defaultExportFileName("notes/plan.markdown", "html")).toBe("plan.html");
    expect(defaultExportFileName("/Users/me/todo.txt", "pdf")).toBe("todo.pdf");
  });

  it("keeps a dotted name whole", () => {
    expect(defaultExportFileName("release-1.2.md", "pdf")).toBe("release-1.2.pdf");
  });
});
