import type { EditorView } from "@codemirror/view";

import { createValueStore } from "../../lib/valueStore";

/**
 * The editor showing the open note. The selection's format bar needs it to
 * run Bold or Link, but the editor hands its view only to the toolbar, so the
 * toolbar publishes it here.
 */
export const activeEditorView = createValueStore<EditorView | null>(null);
