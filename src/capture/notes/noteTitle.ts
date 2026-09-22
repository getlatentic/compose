/** List markers a line can start with, as the app strips them when it names a note. */
const MARKERS = ["- [ ] ", "- [x] ", "- ", "* ", "+ ", "> "];
/** A marker with nothing after it, as when a list was only started. */
const BARE_MARKERS = new Set(["-", "*", "+", ">", "- [ ]", "- [x]", "[ ]", "[x]"]);

/**
 * A quick note's name in the list: its first line that says something, without
 * the heading, list, task or quote marker the app also leaves out of its file
 * name, and without emphasis marks.
 */
export function noteTitle(body: string): string {
  for (const line of body.split("\n")) {
    const title = withoutMarkup(line).replace(/[*_`~]/g, "").trim();
    if (title) return title;
  }
  return "";
}

function withoutMarkup(line: string): string {
  const unheaded = line.trimStart().replace(/^#+/, "").trimStart();
  const marker = MARKERS.find((each) => unheaded.startsWith(each));
  const text = (marker ? unheaded.slice(marker.length) : unheaded).trim();
  return BARE_MARKERS.has(text) ? "" : text;
}
