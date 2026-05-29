import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

export type LivePreviewLine =
  | { depth: number; kind: "heading"; text: string }
  | { checked: boolean | null; kind: "listItem"; ordered: boolean; text: string }
  | { kind: "quote"; text: string };

export interface LivePreviewCodeBlock {
  code: string;
  kind: "codeBlock";
  language: string | null;
}

export type LivePreviewInlineRange =
  | { from: number; kind: "inlineCode"; markerRanges: Array<[number, number]>; to: number }
  | { from: number; kind: "bold"; markerRanges: Array<[number, number]>; to: number }
  | { from: number; kind: "italic"; markerRanges: Array<[number, number]>; to: number }
  | { from: number; kind: "link"; markerRanges: Array<[number, number]>; to: number };

export function toLivePreviewLine(lineText: string): LivePreviewLine | null {
  const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(lineText);
  if (heading) {
    return {
      depth: heading[1].length,
      kind: "heading",
      text: heading[2],
    };
  }

  const unorderedList = /^(\s*)[-*+]\s+(?:\[([ xX])\]\s+)?(.+)$/.exec(lineText);
  if (unorderedList) {
    return {
      checked: checkboxState(unorderedList[2]),
      kind: "listItem",
      ordered: false,
      text: unorderedList[3],
    };
  }

  const orderedList = /^(\s*)\d+[.)]\s+(.+)$/.exec(lineText);
  if (orderedList) {
    return {
      checked: null,
      kind: "listItem",
      ordered: true,
      text: orderedList[2],
    };
  }

  const quote = /^>\s+(.+)$/.exec(lineText);
  if (quote) {
    return {
      kind: "quote",
      text: quote[1],
    };
  }

  return null;
}

export function toLivePreviewCodeBlock(lines: string[]): LivePreviewCodeBlock | null {
  if (lines.length < 2) {
    return null;
  }

  const openingFence = /^```\s*([A-Za-z0-9_-]+)?\s*$/.exec(lines[0]);
  const closingFence = /^```\s*$/.exec(lines[lines.length - 1]);
  if (!openingFence || !closingFence) {
    return null;
  }

  return {
    code: lines.slice(1, -1).join("\n"),
    kind: "codeBlock",
    language: openingFence[1] ?? null,
  };
}

export function toLivePreviewInlineRanges(lineText: string): LivePreviewInlineRange[] {
  const ranges: LivePreviewInlineRange[] = [];
  const occupied: Array<[number, number]> = [];

  collectInlineMatches(lineText, /`([^`\n]+)`/g, (match) => ({
    from: match.index + 1,
    kind: "inlineCode",
    markerRanges: [
      [match.index, match.index + 1],
      [match.index + match[0].length - 1, match.index + match[0].length],
    ],
    to: match.index + match[0].length - 1,
  }), ranges, occupied);

  collectInlineMatches(lineText, /\[([^\]\n]+)\]\(([^)\n]+)\)/g, (match) => {
    const labelStart = match.index + 1;
    const labelEnd = labelStart + match[1].length;
    return {
      from: labelStart,
      kind: "link",
      markerRanges: [
        [match.index, labelStart],
        [labelEnd, match.index + match[0].length],
      ],
      to: labelEnd,
    };
  }, ranges, occupied);

  collectInlineMatches(lineText, /\*\*([^*\n]+)\*\*/g, (match) => ({
    from: match.index + 2,
    kind: "bold",
    markerRanges: [
      [match.index, match.index + 2],
      [match.index + match[0].length - 2, match.index + match[0].length],
    ],
    to: match.index + match[0].length - 2,
  }), ranges, occupied);

  collectInlineMatches(lineText, /(^|[^\*])\*([^*\n]+)\*/g, (match) => {
    const markerStart = match.index + match[1].length;
    const contentStart = markerStart + 1;
    return {
      from: contentStart,
      kind: "italic",
      markerRanges: [
        [markerStart, contentStart],
        [contentStart + match[2].length, contentStart + match[2].length + 1],
      ],
      to: contentStart + match[2].length,
    };
  }, ranges, occupied);

  return ranges.sort((first, second) => first.from - second.from);
}

export const liveMarkdownPreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

export const liveMarkdownPreviewTheme = EditorView.theme({
  ".cm-live-md": {
    cursor: "text",
    display: "inline-flex",
    fontFamily: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif",
    maxWidth: "100%",
    minHeight: "1.65em",
    whiteSpace: "normal",
  },
  ".cm-live-md-heading": {
    color: "#161616",
    fontFamily: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif",
    fontWeight: "700",
    lineHeight: "1.25",
  },
  ".cm-live-md-heading-1": {
    fontSize: "1.6em",
  },
  ".cm-live-md-heading-2": {
    fontSize: "1.35em",
  },
  ".cm-live-md-heading-3": {
    fontSize: "1.15em",
  },
  ".cm-live-md-list": {
    alignItems: "baseline",
    color: "#262626",
    gap: "0.5rem",
  },
  ".cm-live-md-list-marker": {
    color: "#0f62fe",
    flex: "0 0 auto",
    fontWeight: "700",
  },
  ".cm-live-md-task": {
    border: "1px solid #8d8d8d",
    borderRadius: "3px",
    color: "#0f62fe",
    display: "inline-grid",
    flex: "0 0 auto",
    fontSize: "0.75em",
    height: "1.1em",
    lineHeight: "1",
    marginTop: "0.2em",
    placeItems: "center",
    width: "1.1em",
  },
  ".cm-live-md-quote": {
    borderLeft: "3px solid #0f62fe",
    color: "#525252",
    fontStyle: "italic",
    paddingLeft: "0.75rem",
  },
  ".cm-line.cm-live-md-code-line": {
    backgroundColor: "#262626",
    color: "#f4f4f4",
    fontFamily: "'JetBrains Mono', 'IBM Plex Mono', SFMono-Regular, ui-monospace, monospace",
    fontSize: "0.92em",
    lineHeight: "1.55",
    paddingLeft: "0.85rem",
    paddingRight: "0.85rem",
    whiteSpace: "pre",
  },
  ".cm-line.cm-live-md-code-line-start": {
    borderTopLeftRadius: "6px",
    borderTopRightRadius: "6px",
    marginTop: "0.35rem",
    paddingTop: "0.65rem",
  },
  ".cm-line.cm-live-md-code-line-end": {
    borderBottomLeftRadius: "6px",
    borderBottomRightRadius: "6px",
    marginBottom: "0.35rem",
    paddingBottom: "0.65rem",
  },
  ".cm-live-md-code-fence": {
    cursor: "text",
    display: "block",
    minHeight: "1.55em",
  },
  ".cm-live-md-code-language": {
    color: "#c6c6c6",
    fontFamily: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif",
    fontSize: "0.76em",
    fontWeight: "700",
    letterSpacing: "0",
    marginBottom: "0.45rem",
    textTransform: "uppercase",
  },
  ".cm-live-md-hidden-syntax": {
    display: "none",
  },
  ".cm-live-md-inline-bold": {
    fontFamily: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif",
    fontWeight: "700",
  },
  ".cm-live-md-inline-code": {
    backgroundColor: "var(--cds-layer-01, #f4f4f4)",
    border: "1px solid var(--cds-border-subtle-01, #e0e0e0)",
    borderRadius: "3px",
    color: "#a2191f",
    fontFamily: "'IBM Plex Mono', SFMono-Regular, ui-monospace, monospace",
    padding: "0 0.18rem",
  },
  ".cm-live-md-inline-italic": {
    fontFamily: "'IBM Plex Serif', Georgia, serif",
    fontStyle: "italic",
  },
  ".cm-live-md-inline-link": {
    color: "var(--cds-link-primary, #0f62fe)",
    textDecoration: "underline",
    textUnderlineOffset: "0.15em",
  },
});

function buildDecorations(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  const cursorLineNumber = view.state.doc.lineAt(view.state.selection.main.head).number;
  const codeBlocksByLine = collectCodeBlocks(view, cursorLineNumber);

  for (const range of view.visibleRanges) {
    let position = range.from;

    while (position <= range.to) {
      const line = view.state.doc.lineAt(position);
      const codeBlock = codeBlocksByLine.get(line.number);
      if (codeBlock) {
        builder.add(
          line.from,
          line.from,
          Decoration.line({
            class: [
              "cm-live-md-code-line",
              line.number === codeBlock.startLineNumber ? "cm-live-md-code-line-start" : "",
              line.number === codeBlock.endLineNumber ? "cm-live-md-code-line-end" : "",
            ]
              .filter(Boolean)
              .join(" "),
          }),
        );

        if (line.number === codeBlock.startLineNumber || line.number === codeBlock.endLineNumber) {
          builder.add(
            line.from,
            line.to,
            Decoration.replace({
              inclusive: false,
              widget: new LiveMarkdownCodeFenceWidget(
                codeBlock.preview,
                codeBlock.editPosition,
                line.number === codeBlock.startLineNumber ? "opening" : "closing",
              ),
            }),
          );
        }

        if (line.to >= range.to || line.to === view.state.doc.length) {
          break;
        }

        position = line.to + 1;
        continue;
      }

      const previewLine =
        line.number === cursorLineNumber ? null : toLivePreviewLine(line.text.trimEnd());

      if (previewLine) {
        builder.add(
          line.from,
          line.to,
          Decoration.replace({
            inclusive: false,
            widget: new LiveMarkdownLineWidget(previewLine, line.from),
          }),
        );
      } else {
        addInlineDecorations(builder, line.from, line.text);
      }

      if (line.to >= range.to || line.to === view.state.doc.length) {
        break;
      }

      position = line.to + 1;
    }
  }

  return builder.finish();
}

interface CodeBlockDecoration {
  endLineNumber: number;
  editPosition: number;
  preview: LivePreviewCodeBlock;
  startLineNumber: number;
}

function collectCodeBlocks(view: EditorView, cursorLineNumber: number) {
  const codeBlocks = new Map<number, CodeBlockDecoration>();
  let lineNumber = 1;

  while (lineNumber <= view.state.doc.lines) {
    const openingLine = view.state.doc.line(lineNumber);
    const openingFence = /^```\s*([A-Za-z0-9_-]+)?\s*$/.exec(openingLine.text);
    if (!openingFence) {
      lineNumber += 1;
      continue;
    }

    const bodyLines = [openingLine.text];
    let closingLineNumber = lineNumber + 1;
    let closingLine = openingLine;

    while (closingLineNumber <= view.state.doc.lines) {
      closingLine = view.state.doc.line(closingLineNumber);
      bodyLines.push(closingLine.text);
      if (/^```\s*$/.test(closingLine.text)) {
        break;
      }
      closingLineNumber += 1;
    }

    const preview = toLivePreviewCodeBlock(bodyLines);
    const cursorInsideBlock = cursorLineNumber >= lineNumber && cursorLineNumber <= closingLineNumber;
    if (preview && !cursorInsideBlock) {
      const codeBlock = {
        endLineNumber: closingLineNumber,
        editPosition:
          lineNumber + 1 <= view.state.doc.lines
            ? view.state.doc.line(lineNumber + 1).from
            : openingLine.from,
        preview,
        startLineNumber: lineNumber,
      };

      for (let codeLineNumber = lineNumber; codeLineNumber <= closingLineNumber; codeLineNumber += 1) {
        codeBlocks.set(codeLineNumber, codeBlock);
      }
    }

    lineNumber = Math.max(closingLineNumber + 1, lineNumber + 1);
  }

  return codeBlocks;
}

class LiveMarkdownLineWidget extends WidgetType {
  constructor(
    private readonly previewLine: LivePreviewLine,
    private readonly editPosition: number,
  ) {
    super();
  }

  eq(other: LiveMarkdownLineWidget) {
    return (
      this.editPosition === other.editPosition &&
      JSON.stringify(this.previewLine) === JSON.stringify(other.previewLine)
    );
  }

  toDOM(view: EditorView) {
    if (this.previewLine.kind === "heading") {
      const element = document.createElement(`h${this.previewLine.depth}`);
      element.className = [
        "cm-live-md",
        "cm-live-md-heading",
        `cm-live-md-heading-${this.previewLine.depth}`,
      ].join(" ");
      element.textContent = this.previewLine.text;
      this.attachEditHandler(element, view);
      return element;
    }

    if (this.previewLine.kind === "quote") {
      const element = document.createElement("span");
      element.className = "cm-live-md cm-live-md-quote";
      element.textContent = this.previewLine.text;
      this.attachEditHandler(element, view);
      return element;
    }

    const element = document.createElement("span");
    element.className = "cm-live-md cm-live-md-list";

    if (this.previewLine.checked === null) {
      const marker = document.createElement("span");
      marker.className = "cm-live-md-list-marker";
      marker.textContent = this.previewLine.ordered ? "1." : "•";
      element.append(marker);
    } else {
      const marker = document.createElement("span");
      marker.className = "cm-live-md-task";
      marker.textContent = this.previewLine.checked ? "✓" : "";
      element.append(marker);
    }

    const text = document.createElement("span");
    text.textContent = this.previewLine.text;
    element.append(text);
    this.attachEditHandler(element, view);
    return element;
  }

  ignoreEvent() {
    return false;
  }

  private attachEditHandler(element: HTMLElement, view: EditorView) {
    element.title = "Click to edit Markdown source";
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.focus();
      view.dispatch({ selection: { anchor: this.editPosition } });
    });
  }
}

class LiveMarkdownCodeFenceWidget extends WidgetType {
  constructor(
    private readonly previewBlock: LivePreviewCodeBlock,
    private readonly editPosition: number,
    private readonly fence: "closing" | "opening",
  ) {
    super();
  }

  eq(other: LiveMarkdownCodeFenceWidget) {
    return (
      this.editPosition === other.editPosition &&
      this.fence === other.fence &&
      this.previewBlock.language === other.previewBlock.language
    );
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-live-md-code-fence";
    wrapper.title = "Click to edit Markdown source";

    if (this.fence === "opening" && this.previewBlock.language) {
      const language = document.createElement("span");
      language.className = "cm-live-md-code-language";
      language.textContent = this.previewBlock.language;
      wrapper.append(language);
    }

    wrapper.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.focus();
      view.dispatch({ selection: { anchor: this.editPosition } });
    });

    return wrapper;
  }

  ignoreEvent() {
    return false;
  }
}

class HiddenMarkdownSyntaxWidget extends WidgetType {
  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-live-md-hidden-syntax";
    element.setAttribute("aria-hidden", "true");
    return element;
  }
}

function addInlineDecorations(
  builder: RangeSetBuilder<Decoration>,
  lineStart: number,
  lineText: string,
) {
  const decorations: Array<{ decoration: Decoration; from: number; to: number }> = [];
  for (const range of toLivePreviewInlineRanges(lineText)) {
    for (const [from, to] of range.markerRanges) {
      decorations.push({
        decoration: Decoration.replace({
          inclusive: false,
          widget: new HiddenMarkdownSyntaxWidget(),
        }),
        from: lineStart + from,
        to: lineStart + to,
      });
    }

    decorations.push({
      decoration: Decoration.mark({
        class: inlineClassForKind(range.kind),
      }),
      from: lineStart + range.from,
      to: lineStart + range.to,
    });
  }

  decorations.sort((first, second) => first.from - second.from || first.to - second.to);
  for (const item of decorations) {
    builder.add(item.from, item.to, item.decoration);
  }
}

function collectInlineMatches(
  lineText: string,
  pattern: RegExp,
  buildRange: (match: RegExpExecArray) => LivePreviewInlineRange,
  ranges: LivePreviewInlineRange[],
  occupied: Array<[number, number]>,
) {
  for (const rawMatch of lineText.matchAll(pattern)) {
    const match = rawMatch as RegExpExecArray;
    if (match.index == null) {
      continue;
    }
    const fullRange: [number, number] = [match.index, match.index + match[0].length];
    if (occupied.some(([from, to]) => fullRange[0] < to && from < fullRange[1])) {
      continue;
    }
    ranges.push(buildRange(match));
    occupied.push(fullRange);
  }
}

function inlineClassForKind(kind: LivePreviewInlineRange["kind"]) {
  switch (kind) {
    case "bold":
      return "cm-live-md-inline-bold";
    case "inlineCode":
      return "cm-live-md-inline-code";
    case "italic":
      return "cm-live-md-inline-italic";
    case "link":
      return "cm-live-md-inline-link";
  }
}

function checkboxState(rawValue: string | undefined) {
  if (rawValue === undefined) {
    return null;
  }

  return rawValue.toLowerCase() === "x";
}
