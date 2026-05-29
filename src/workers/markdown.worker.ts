import { expose } from "comlink";
import { renderMarkdownPreview } from "./markdownPipeline";

const api = {
  renderPreview: renderMarkdownPreview,
};

export type MarkdownWorkerApi = typeof api;

expose(api);
