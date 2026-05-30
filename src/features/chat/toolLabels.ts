/**
 * Plain-language names for the agent's tools, so a non-technical reader
 * sees "Reading your notes" instead of `read_file {"path":"/abs/…"}`.
 *
 *  - `toolActionLabel(name, input)` — present continuous for the live
 *    status ("Reading Notes.md…"); folds in the file's *basename* when
 *    the tool input carries a path (never the absolute path — that floods
 *    the line).
 *  - `toolName` — a clean past-tense phrase for the trace ("Read file").
 * Unknown tools fall back to their de-underscored name.
 */
interface ToolLabel {
  /** Present-continuous verb for the live status, e.g. "Reading". */
  verb: string;
  /** Fallback object when there's no filename, e.g. "your notes". */
  object: string;
  /** Past-tense noun phrase for the trace, e.g. "Read file". */
  noun: string;
}

const TOOL_LABELS: Record<string, ToolLabel> = {
  read_file: { verb: "Reading", object: "your notes", noun: "Read file" },
  write_file: { verb: "Writing", object: "a file", noun: "Wrote file" },
  apply_diff: { verb: "Editing", object: "a file", noun: "Edited file" },
  insert_content: { verb: "Editing", object: "a file", noun: "Edited file" },
  search_files: { verb: "Searching", object: "your files", noun: "Searched files" },
  list_files: { verb: "Looking through", object: "your files", noun: "Listed files" },
  execute_command: { verb: "Running", object: "a command", noun: "Ran a command" },
  attempt_completion: { verb: "Finalizing", object: "", noun: "Finished up" },
};

function deUnderscore(name: string): string {
  return name.replace(/_/g, " ");
}

/** The last path segment of a value that looks like a file path, else
 * null. Strips any directory so an absolute path can't blow up the line. */
function basename(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const segments = value.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] ?? null;
}

/** Pull a file name out of a tool's JSON input (path / file / file_path /
 * dir_path), returning just the basename. Best-effort — null on anything
 * unparseable. */
function fileFromInput(input: string | undefined): string | null {
  if (!input) {
    return null;
  }
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    for (const key of ["path", "file_path", "file", "filename", "dir_path"]) {
      const name = basename(parsed[key]);
      if (name) {
        return name;
      }
    }
  } catch {
    // not JSON / unexpected shape — no filename
  }
  return null;
}

/** Present-continuous status label, e.g. "Reading Notes.md" or, with no
 * filename, "Reading your notes". */
export function toolActionLabel(name: string, input?: string): string {
  const label = TOOL_LABELS[name];
  if (!label) {
    return `Using ${deUnderscore(name)}`;
  }
  const file = fileFromInput(input);
  if (file) {
    return `${label.verb} ${file}`;
  }
  return label.object ? `${label.verb} ${label.object}` : label.verb;
}

/** Past-tense noun phrase for the trace, e.g. "Read file". */
export function toolName(name: string): string {
  return TOOL_LABELS[name]?.noun ?? deUnderscore(name);
}
