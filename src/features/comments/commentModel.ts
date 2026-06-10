import { PositionMapper, byteLength, type SourceRange } from "../text/positionMapper";

export {
  PositionMapper,
  byteLength,
  byteOffsetToCodeUnitIndex,
  codeUnitIndexToByteOffset,
  sliceByByteRange,
} from "../text/positionMapper";
export type { SourceRange } from "../text/positionMapper";

export type AnchorResolutionState =
  | "collapsed"
  | "contracted"
  | "expanded"
  | "moved"
  | "orphaned"
  | "replaced"
  | "resolved"
  | "truncatedEnd"
  | "truncatedStart";

export interface DocumentTextChange {
  range: SourceRange;
  text: string;
}

export interface CommentAnchor {
  prefix: string;
  range: SourceRange;
  resolution: AnchorResolutionState;
  selectedText: string;
  suffix: string;
}

export interface WorkspaceCommentThread {
  anchor: CommentAnchor;
  body: string;
  createdAt: number;
  filePath: string;
  id: string;
  status: "open" | "resolved";
  updatedAt: number;
}

export interface CreateCommentInput {
  body: string;
  filePath: string;
  fullText: string;
  id: string;
  range: SourceRange;
  selectedText: string;
  timestamp: number;
}

const CONTEXT_BYTES = 80;

/**
 * Build a comment thread anchor for `input.range` against `input.fullText`.
 *
 * `mapper` is optional — supplied by bulk callers (lag benchmark setup,
 * workspace import) that want to amortise the O(n) chunk-index build
 * across many anchor constructions on the same document. When omitted,
 * a one-shot mapper is built.
 */
export function createCommentThread(
  input: CreateCommentInput,
  mapper?: PositionMapper,
): WorkspaceCommentThread {
  if (input.range.start >= input.range.end) {
    throw new Error("comment range must not be empty");
  }

  const documentMapper = mapper ?? new PositionMapper(input.fullText);
  const prefixStart = Math.max(0, input.range.start - CONTEXT_BYTES);
  const suffixEnd = Math.min(documentMapper.byteLength, input.range.end + CONTEXT_BYTES);

  return {
    anchor: {
      prefix: documentMapper.sliceByByteRange({ start: prefixStart, end: input.range.start }),
      range: input.range,
      resolution: "resolved",
      selectedText: input.selectedText,
      suffix: documentMapper.sliceByByteRange({ start: input.range.end, end: suffixEnd }),
    },
    body: input.body.trim(),
    createdAt: input.timestamp,
    filePath: input.filePath,
    id: input.id,
    status: "open",
    updatedAt: input.timestamp,
  };
}

export function applyDocumentChangesToComments(
  comments: WorkspaceCommentThread[],
  filePath: string,
  changes: DocumentTextChange[],
  timestamp: number,
): WorkspaceCommentThread[] {
  if (changes.length === 0) {
    return comments;
  }

  return comments.map((comment) => {
    if (comment.filePath !== filePath || comment.status === "resolved") {
      return comment;
    }

    let range: SourceRange | null = comment.anchor.range;
    let resolution: AnchorResolutionState = comment.anchor.resolution;

    for (const change of changes) {
      if (!range) {
        break;
      }
      const result = transformRange(range, change);
      range = result.range;
      resolution = result.resolution;
    }

    return {
      ...comment,
      anchor: {
        ...comment.anchor,
        range: range ?? comment.anchor.range,
        resolution,
      },
      status: resolution === "orphaned" ? "resolved" : comment.status,
      updatedAt: timestamp,
    };
  });
}

export function moveCommentsToFile(
  comments: WorkspaceCommentThread[],
  fromFilePath: string,
  toFilePath: string,
  timestamp: number,
): WorkspaceCommentThread[] {
  return comments.map((comment) =>
    comment.filePath === fromFilePath
      ? { ...comment, filePath: toFilePath, updatedAt: timestamp }
      : comment,
  );
}

export function transformRange(
  range: SourceRange,
  change: DocumentTextChange,
): { range: SourceRange | null; resolution: AnchorResolutionState } {
  const insertedLength = byteLength(change.text);
  const deleteStart = change.range.start;
  const deleteEnd = change.range.end;
  const deletedLength = deleteEnd - deleteStart;

  if (deletedLength === 0) {
    return transformInsert(range, deleteStart, insertedLength);
  }

  if (insertedLength === 0) {
    return transformDelete(range, deleteStart, deleteEnd, deletedLength);
  }

  return transformReplace(range, deleteStart, deleteEnd, deletedLength, insertedLength);
}

function transformInsert(
  range: SourceRange,
  position: number,
  insertedLength: number,
): { range: SourceRange; resolution: AnchorResolutionState } {
  const { start, end } = range;
  if (position < start || position === start) {
    return {
      range: { start: start + insertedLength, end: end + insertedLength },
      resolution: "moved",
    };
  }
  if (position > start && position < end) {
    return {
      range: { start, end: end + insertedLength },
      resolution: "expanded",
    };
  }
  return { range, resolution: "resolved" };
}

function transformDelete(
  range: SourceRange,
  deleteStart: number,
  deleteEnd: number,
  deletedLength: number,
): { range: SourceRange | null; resolution: AnchorResolutionState } {
  const { start, end } = range;
  if (deleteEnd <= start) {
    return {
      range: { start: start - deletedLength, end: end - deletedLength },
      resolution: "moved",
    };
  }
  if (deleteStart >= end) {
    return { range, resolution: "resolved" };
  }
  if (deleteStart <= start && end <= deleteEnd) {
    return { range: null, resolution: "orphaned" };
  }
  if (deleteStart <= start && start < deleteEnd && deleteEnd < end) {
    return {
      range: { start: deleteStart, end: end - deletedLength },
      resolution: "truncatedStart",
    };
  }
  if (start < deleteStart && deleteEnd < end) {
    return {
      range: { start, end: end - deletedLength },
      resolution: "contracted",
    };
  }
  return {
    range: { start, end: deleteStart },
    resolution: "truncatedEnd",
  };
}

function transformReplace(
  range: SourceRange,
  deleteStart: number,
  deleteEnd: number,
  deletedLength: number,
  insertedLength: number,
): { range: SourceRange | null; resolution: AnchorResolutionState } {
  const { start, end } = range;
  const delta = insertedLength - deletedLength;

  if (deleteEnd <= start) {
    return {
      range: { start: start + delta, end: end + delta },
      resolution: "moved",
    };
  }
  if (deleteStart >= end) {
    return { range, resolution: "resolved" };
  }
  if (deleteStart <= start && end <= deleteEnd) {
    return {
      range: { start: deleteStart, end: deleteStart + insertedLength },
      resolution: "replaced",
    };
  }
  if (start < deleteStart && deleteEnd < end) {
    return {
      range: { start, end: end + delta },
      resolution: "replaced",
    };
  }
  if (deleteStart <= start && start < deleteEnd && deleteEnd < end) {
    return {
      range: { start: deleteStart, end: end + delta },
      resolution: "truncatedStart",
    };
  }
  return {
    range: { start, end: deleteStart + insertedLength },
    resolution: "truncatedEnd",
  };
}
