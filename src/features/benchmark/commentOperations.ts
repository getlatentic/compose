/**
 * Comment-layer operations for the lag baseline — the live, shipping
 * code paths that the comment feature actually runs. Returned as
 * deferred thunks so the orchestrator can yield between them.
 *
 * Three families, each scaled across comment counts:
 *
 *   * `commentOverlay{N}` vs `commentOverlay{N}_indexed` — the per-paint
 *     "does any comment touch this visible line" scan. Naive is
 *     `rangeOverlapsAny` (O(comments) per line); indexed is
 *     `CommentRangeIndex.anyOverlapping` (O(log comments) per line).
 *     This is the regression the index exists to prevent.
 *   * `commentAnchorUpdate{N}` — `applyDocumentChangesToComments`, the
 *     per-edit anchor transform over every comment on the file.
 *   * `commentCreate{N}` — `createCommentThread` over a shared
 *     `PositionMapper`. Exactly the scenario the (formerly flaky)
 *     commentModel unit test guarded; its hard perf gate lives here now.
 *
 * Each comment set is built once, eagerly (untimed), and shared by its
 * overlay + anchor runners — matching how the renderer memoises the
 * index by comment identity rather than rebuilding per paint.
 */

import {
  applyDocumentChangesToComments,
  createCommentThread,
  PositionMapper,
  type WorkspaceCommentThread,
} from "../comments/commentModel";
import { CommentRangeIndex, rangeOverlapsAny } from "../comments/commentRangeIndex";
import { lineByteRanges, type BenchmarkDocument } from "./documentFixtures";
import { measure } from "./measure";
import { makeResult, type OperationResult } from "./operationResult";

const COMMENT_COUNTS = [1, 10, 100, 1000] as const;
const CREATE_COUNTS = [100, 1000] as const;
/** Visible-window height a single paint scans. */
const VISIBLE_LINE_COUNT = 50;
/** Selected-range width for a synthetic comment anchor, in bytes. */
const ANCHOR_WIDTH = 16;
const FILE_PATH = "bench/notes.md";

type LineRange = { start: number; end: number };

/**
 * Build `count` open comment threads spread evenly across the document,
 * all anchored through one shared `PositionMapper` (the production bulk
 * pattern). Built outside any timed region.
 */
function buildComments(
  doc: BenchmarkDocument,
  count: number,
  mapper: PositionMapper,
): WorkspaceCommentThread[] {
  const comments: WorkspaceCommentThread[] = [];
  const stride = Math.max(ANCHOR_WIDTH + 1, Math.floor(doc.byteSize / (count + 1)));
  for (let i = 0; i < count; i += 1) {
    const start = Math.min(i * stride, doc.byteSize - ANCHOR_WIDTH - 1);
    const end = start + ANCHOR_WIDTH;
    comments.push(
      createCommentThread(
        {
          body: `comment ${i}`,
          filePath: FILE_PATH,
          fullText: doc.text,
          id: `comment-${i}`,
          range: { start, end },
          selectedText: doc.text.slice(start, end),
          timestamp: 1,
        },
        mapper,
      ),
    );
  }
  return comments;
}

export function commentOperationRunners(doc: BenchmarkDocument): Array<() => OperationResult> {
  const mapper = new PositionMapper(doc.text);
  // One paint scans the visible window; place it mid-document so it sits
  // among comments rather than at an empty edge.
  const firstVisibleLine = Math.max(0, Math.floor(doc.lineCount / 2) - VISIBLE_LINE_COUNT);
  const visibleLines = lineByteRanges(doc.text, firstVisibleLine, VISIBLE_LINE_COUNT);

  const runners: Array<() => OperationResult> = [];
  for (const count of COMMENT_COUNTS) {
    const comments = buildComments(doc, count, mapper); // eager, untimed
    const index = new CommentRangeIndex(comments);
    runners.push(() => overlayNaive(count, comments, visibleLines));
    runners.push(() => overlayIndexed(count, index, visibleLines));
    runners.push(() => anchorUpdate(count, comments));
  }
  for (const count of CREATE_COUNTS) {
    runners.push(() => commentCreate(doc, count));
  }
  return runners;
}

/** Naive per-paint overlap scan: `rangeOverlapsAny` per visible line. */
function overlayNaive(
  count: number,
  comments: readonly WorkspaceCommentThread[],
  visibleLines: readonly LineRange[],
): OperationResult {
  const samples = measure(
    () => {
      for (const line of visibleLines) rangeOverlapsAny(line, comments);
    },
    { warmup: 2, samples: 8 },
  );
  return makeResult(`commentOverlay${count}`, samples);
}

/** Indexed per-paint overlap scan: `CommentRangeIndex.anyOverlapping` per line. */
function overlayIndexed(
  count: number,
  index: CommentRangeIndex,
  visibleLines: readonly LineRange[],
): OperationResult {
  const samples = measure(
    () => {
      for (const line of visibleLines) index.anyOverlapping(line.start, line.end);
    },
    { warmup: 2, samples: 8 },
  );
  return makeResult(`commentOverlay${count}_indexed`, samples);
}

/** Per-edit anchor transform over every comment on the file. */
function anchorUpdate(count: number, comments: WorkspaceCommentThread[]): OperationResult {
  const changes = [{ range: { start: 0, end: 0 }, text: "Intro " }];
  const samples = measure(
    () => void applyDocumentChangesToComments(comments, FILE_PATH, changes, 2),
    { warmup: 2, samples: 8 },
  );
  return makeResult(`commentAnchorUpdate${count}`, samples);
}

/** Bulk thread construction over a shared mapper (the flaky-test scenario). */
function commentCreate(doc: BenchmarkDocument, count: number): OperationResult {
  const samples = measure(
    () => {
      const mapper = new PositionMapper(doc.text);
      buildComments(doc, count, mapper);
    },
    { warmup: 1, samples: 8 },
  );
  return makeResult(`commentCreate${count}`, samples);
}
