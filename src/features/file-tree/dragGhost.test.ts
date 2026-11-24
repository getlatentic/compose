// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { createDragGhost } from "./dragGhost";

describe("createDragGhost", () => {
  it("shows the note's icon and its name as text, even when the name looks like markup", () => {
    const ghost = createDragGhost(document, "<b>Plan</b>.md");
    expect(ghost.querySelector("svg")).not.toBeNull();
    expect(ghost.querySelector("span")?.textContent).toBe("<b>Plan</b>.md");
    expect(ghost.querySelector("b")).toBeNull();
  });
});
