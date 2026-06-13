/**
 * The output of the worker-side markdown preview. Carries the metadata the
 * status-bar + heading-outline surfaces need — no AST.
 *
 * Earlier shape included a full `tree: hast.Root` produced via the unified
 * pipeline; profiling on a 1MB markdown showed that step dominated the open
 * latency at ~2.1s out of 2.3s. No non-test code in the running app ever
 * consumed `tree` — only `meta.wordCount` (status bar). So the preview was
 * paying a 2.1s parse to produce a structure nobody reads. The scanner in
 * `markdownPipeline.ts` now extracts the same metadata in milliseconds and
 * the `tree` field is gone.
 *
 * The chat renderer (`markdownToReact.tsx`) uses unified independently and is
 * unaffected.
 */
export interface MarkdownPreviewDocument {
  meta: {
    headings: MarkdownHeading[];
    wordCount: number;
  };
}

export interface MarkdownHeading {
  depth: number;
  text: string;
}
