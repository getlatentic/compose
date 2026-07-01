import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WorkspaceAppliedChange } from "../../app/workspaceModel";
import { AppliedChanges } from "./AppliedChanges";

describe("AppliedChanges", () => {
  it("labels the edit card with the file name, keeping the full path on hover", () => {
    const change: WorkspaceAppliedChange = {
      kind: "rewrite",
      filePath: "Others/Writing/data-science-nigeria-video.md",
      originalText: "old\n",
      newText: "new\n",
      originalSize: 4,
      newSize: 4,
      previewOmitted: true,
    };
    const html = renderToStaticMarkup(
      <AppliedChanges changes={[change]} onOpenDocument={() => {}} />,
    );

    // The path button shows the basename...
    expect(html).toContain(">data-science-nigeria-video.md</button>");
    // ...with the full path only in the hover title, never as the visible label.
    expect(html).toContain('title="Others/Writing/data-science-nigeria-video.md"');
    expect(html).not.toContain(">Others/Writing/data-science-nigeria-video.md</button>");
  });
});
