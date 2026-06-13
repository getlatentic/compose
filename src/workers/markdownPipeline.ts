import type { MarkdownHeading, MarkdownPreviewDocument } from "./shared/markdownTypes";

/**
 * Fast markdown metadata scanner — replaces a 2.1s-on-1MB unified pipeline.
 *
 * The earlier implementation ran the full `unified + remark-parse +
 * remark-rehype + rehype-sanitize` pipeline to produce a hast tree, then
 * walked it for headings and prose words. Profiling on a 1MB markdown showed
 * `remark-parse` alone took 2.1s out of the 2.3s total — 92% of the cost.
 *
 * The kicker: **no non-test consumer ever read the tree**. The only field
 * the UI consumes is `meta.wordCount` (status bar "X words"). Building a
 * full AST to count words is the wrong shape of work.
 *
 * This scanner walks the raw markdown once, strips the constructs that
 * don't count as prose (fenced code, HTML tags, inline code, link URLs,
 * syntax markers) and counts whitespace-separated tokens. Headings come
 * from a second pass over the LINES that's also linear and cheap.
 *
 * Approximations vs. the old pipeline:
 *
 *   * Word count of malformed HTML / non-standard entities differs from
 *     the sanitized output by ~the same fudge a human reader would
 *     tolerate. This is for "X words" in a status bar, not legal evidence.
 *   * Headings inside fenced code are correctly skipped.
 *   * Setext-style headings (`Title\n=====`) are recognized.
 *
 * The chat renderer ([markdownToReact.tsx](../lib/markdown/markdownToReact.tsx))
 * is unaffected — it builds its own React output via the unified pipeline
 * for its own (small, per-message) content and retains the sanitization
 * boundary. This preview path doesn't render the markdown anywhere, so
 * there's nothing to sanitize.
 */
export async function renderMarkdownPreview(markdown: string): Promise<MarkdownPreviewDocument> {
  return {
    meta: {
      headings: extractHeadings(markdown),
      wordCount: countProseWords(markdown),
    },
  };
}

// ---- word count --------------------------------------------------------

/**
 * Count whitespace-separated tokens after stripping markdown constructs
 * that don't read as prose.
 *
 * Single linear pass per regex (5 calls, each producing one new string
 * via `.replace`), no per-token allocations beyond the final match array.
 */
function countProseWords(markdown: string): number {
  // Order matters: fenced code first (so a `#` inside a code block isn't
  // counted as text), then HTML script/style/comment blocks (drop content
  // wholesale — not prose), then inline code, then link/image syntax (keep
  // the visible text, drop the URL), then remaining single-char markers.
  const prose = markdown
    .replace(STRIP_FENCED_CODE, " ")
    .replace(STRIP_HTML_BLOCK, " ")
    .replace(STRIP_HTML_TAG, " ")
    .replace(STRIP_INLINE_CODE, " ")
    .replace(STRIP_LINK_OR_IMAGE, "$1")
    .replace(STRIP_SYNTAX_MARKERS, " ");

  const match = prose.match(/\S+/g);
  return match ? match.length : 0;
}

const STRIP_FENCED_CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
// Drop `<script>...</script>`, `<style>...</style>`, and `<!-- ... -->`
// blocks INCLUDING their text content — none of it reads as prose.
const STRIP_HTML_BLOCK =
  /<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi;
// Remaining inline HTML tags — drop the tag itself, keep any text it
// wraps (so `<em>foo</em>` counts foo).
const STRIP_HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;
const STRIP_INLINE_CODE = /`[^`\n]*`/g;
// `[text](url)` and `![alt](url)` → keep the visible text via the capture.
const STRIP_LINK_OR_IMAGE = /!?\[([^\]]*)\]\([^)]*\)/g;
// Syntax markers that aren't word boundaries but shouldn't count as text.
// `*` `_` `~` are emphasis/strikethrough; `#` is ATX heading; `>` is
// blockquote; leading `-`/`+` at line start are list markers.
const STRIP_SYNTAX_MARKERS = /[#>*_~]|^[-+]\s/gm;

// ---- headings ----------------------------------------------------------

/**
 * Extract ATX (`# Title`) and setext (`Title\n====`) headings in one
 * line-walk. Fenced code blocks are tracked so a `#` inside ``` doesn't
 * fire. Linear time, no allocations per heading beyond the result rows.
 */
function extractHeadings(markdown: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const lines = markdown.split("\n");
  let inFence = false;
  let fenceChar: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (!inFence) {
      const fence = line.match(/^([`~]{3,})/);
      if (fence) {
        inFence = true;
        fenceChar = fence[1][0];
        continue;
      }
    } else {
      if (fenceChar !== null && new RegExp(`^${fenceChar}{3,}\\s*$`).test(line)) {
        inFence = false;
        fenceChar = null;
      }
      continue;
    }

    // ATX heading: 1–6 leading `#` + space + text (with optional trailing `#`).
    const atx = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (atx) {
      headings.push({ depth: atx[1].length, text: cleanInlineMarkdown(atx[2]) });
      continue;
    }

    // Setext heading: this line is the title, next line is the underline.
    if (i + 1 < lines.length) {
      const underline = lines[i + 1];
      if (line.trim() !== "" && /^=+\s*$/.test(underline)) {
        headings.push({ depth: 1, text: cleanInlineMarkdown(line.trim()) });
      } else if (line.trim() !== "" && /^-+\s*$/.test(underline)) {
        headings.push({ depth: 2, text: cleanInlineMarkdown(line.trim()) });
      }
    }
  }

  return headings;
}

/**
 * Strip inline markdown from a heading's text so the outline shows the
 * rendered prose rather than the source.
 */
function cleanInlineMarkdown(text: string): string {
  return text
    .replace(STRIP_INLINE_CODE, "")
    .replace(STRIP_LINK_OR_IMAGE, "$1")
    .replace(/[*_~]/g, "");
}
