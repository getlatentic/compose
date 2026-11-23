import type { EditGuard, SandboxFile } from "../../lib/ipc/harnessClient";
import { readFile } from "../../lib/ipc/filesClient";
import type { ReviewFeedback } from "../../features/review/reviewFeedback";
import { NO_WAITING_PROPOSALS, notesToRead, waitingProposals, type NoteTexts } from "../../features/review/waitingProposals";
import type { Workspace } from "../workspace/types";
import { finishReviewRun, retireCarriedProposals } from "./reviewFlow";
import { markReviewFeedbackSent } from "./reviewMarginSlice";
import type { WorkspaceStoreGet, WorkspaceStoreSet } from "./types";

/**
 * The review side of one agent run, the same for every way a run starts:
 * the files its sandbox starts from, and what happens once the request is
 * sent and once the run ends.
 */
export interface ReviewRun {
  readonly sandboxFiles: readonly SandboxFile[];
  /** The run was accepted: the agent has now been told `feedback`. */
  sent(): void;
  /** The run ended: surface its changes and retire what it carried. */
  finished(cancelled: boolean): void;
}

interface ReviewRunStart {
  set: WorkspaceStoreSet;
  get: WorkspaceStoreGet;
  workspace: Workspace;
  runId: string;
  editGuard: EditGuard;
  feedback: ReviewFeedback | null;
}

/** Read the closed notes {@link waitingProposals} needs; one that cannot be read is left out. */
async function readClosedNotes(workspace: Workspace): Promise<NoteTexts> {
  const read = await Promise.all(
    notesToRead(workspace).map(async (path): Promise<[string, string] | null> => {
      try {
        return [path, (await readFile(workspace.id, path)).content];
      } catch {
        return null;
      }
    }),
  );
  return new Map(read.filter((entry): entry is [string, string] => entry !== null));
}

/**
 * Prepare a run's review. A sandboxed (`clone`) run starts from the
 * proposals still waiting for the writer, so the agent finds what its
 * conversation says it did, and its own proposal replaces them once it lands.
 */
export async function startReviewRun({ set, get, workspace, runId, editGuard, feedback }: ReviewRunStart): Promise<ReviewRun> {
  const waiting =
    editGuard === "clone" ? waitingProposals(workspace, await readClosedNotes(workspace)) : NO_WAITING_PROPOSALS;
  return {
    sandboxFiles: waiting.files,
    sent: () => markReviewFeedbackSent(set, workspace.id, feedback),
    finished: (cancelled) => {
      void finishReviewRun(set, workspace.id, runId, editGuard, cancelled).then((landed) => {
        if (landed) retireCarriedProposals(set, get, workspace.id, waiting.suggestionIds);
      });
    },
  };
}
