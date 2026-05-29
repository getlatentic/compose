import { wrap } from "comlink";
import type { MarkdownWorkerApi } from "../../workers/markdown.worker";

const worker = new Worker(new URL("../../workers/markdown.worker.ts", import.meta.url), {
  type: "module",
});

export const markdownPreviewClient = wrap<MarkdownWorkerApi>(worker);
