const SVG_NS = "http://www.w3.org/2000/svg";

/** Lucide's `file` glyph, built as DOM so the note's name never passes through HTML parsing. */
function fileIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  for (const [name, value] of Object.entries({
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.75",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  })) {
    svg.setAttribute(name, value);
  }
  for (const d of ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4"]) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

/** The tile shown under the pointer while a note is dragged: its icon and name. */
export function createDragGhost(doc: Document, name: string): HTMLDivElement {
  const ghost = doc.createElement("div");
  ghost.className = "file-drag-ghost";
  const label = doc.createElement("span");
  label.textContent = name;
  ghost.append(fileIcon(doc), label);
  return ghost;
}
