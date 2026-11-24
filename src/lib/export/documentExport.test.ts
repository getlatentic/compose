import { describe, expect, it, vi } from "vitest";

import { defaultExportFileName, reportExportResult, type ExportToast } from "./documentExport";

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

const revealItemInDir = vi.fn(async () => undefined);
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir }));

describe("reportExportResult", () => {
  it("names the saved file and offers to show it in Finder", async () => {
    const shown: ExportToast[] = [];
    reportExportResult({ status: "exported", path: "/Users/me/Desktop/Plan.png" }, (toast) => shown.push(toast));
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ kind: "success", message: "Saved “Plan.png”.", action: { label: "Show in Finder" } });
    shown[0].action?.run();
    await vi.waitFor(() => expect(revealItemInDir).toHaveBeenCalledWith("/Users/me/Desktop/Plan.png"));
  });

  it("says why an export failed, and nothing when the Save dialog was cancelled", () => {
    const shown: ExportToast[] = [];
    reportExportResult({ status: "error", message: "Disk full" }, (toast) => shown.push(toast));
    reportExportResult({ status: "cancelled" }, (toast) => shown.push(toast));
    expect(shown).toEqual([{ kind: "error", title: "Export failed", message: "Disk full" }]);
  });
});
