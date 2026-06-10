import { describe, expect, it } from "vitest";
import { markdownExportFileName } from "./markdownExport";

describe("markdown export", () => {
  it("preserves markdown file names", () => {
    expect(markdownExportFileName("notes/meeting.md")).toBe("meeting.md");
  });

  it("adds the markdown extension to extensionless notes", () => {
    expect(markdownExportFileName("notes/research")).toBe("research.md");
  });

  it("sanitizes unsafe download characters", () => {
    expect(markdownExportFileName("notes/bob:plan?.md")).toBe("bob-plan-.md");
  });
});
