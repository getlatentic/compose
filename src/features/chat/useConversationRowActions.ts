import { useCallback } from "react";

import { useWorkspaceStore } from "../../app/workspaceStore";
import { exportMarkdownFile } from "../../lib/export/markdownExport";
import { conversationToMarkdown } from "../../lib/export/conversationMarkdown";
import { loadConversation } from "../../lib/ipc/conversationsClient";
import type { ConversationSummary } from "../../lib/ipc/conversationsClient";
import { useTextPrompt } from "../dialogs/TextPromptProvider";
import { useConfirm } from "../dialogs/ConfirmProvider";
import type { ConversationActions } from "./ConversationActionsMenu";

/**
 * Builds the per-conversation {@link ConversationActions} (rename / duplicate /
 * export / archive / delete) for any conversation row, wired straight to the
 * store. Extracted from {@link ChatPanel} so the sidebar Chat tab and any other
 * surface that lists conversations share one implementation rather than
 * re-deriving the export/rename plumbing.
 *
 * Export prefers the live thread when the target conversation is the open one,
 * else loads the persisted snapshot — so exporting a background conversation
 * never switches which one is open.
 */
export function useConversationRowActions(): (
  conversation: ConversationSummary,
) => ConversationActions {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const renameConversation = useWorkspaceStore((state) => state.renameConversation);
  const duplicateConversation = useWorkspaceStore((state) => state.duplicateConversation);
  const archiveConversation = useWorkspaceStore((state) => state.archiveConversation);
  const deleteConversation = useWorkspaceStore((state) => state.deleteConversation);
  const promptText = useTextPrompt();
  const confirm = useConfirm();

  return useCallback(
    (conversation: ConversationSummary): ConversationActions => ({
      onRename: () => {
        void (async () => {
          const next = await promptText({
            title: "Rename conversation",
            defaultValue: conversation.title ?? "",
            submitLabel: "Rename",
          });
          if (next) {
            void renameConversation(conversation.conversationId, next);
          }
        })();
      },
      onDuplicate: () => void duplicateConversation(conversation.conversationId),
      onExport: () => {
        void (async () => {
          if (!activeWorkspaceId) {
            return;
          }
          const confirmed = await confirm({
            title: "Export conversation",
            message: `Export “${conversation.title}” as a Markdown file?`,
            confirmLabel: "Export",
          });
          if (!confirmed) {
            return;
          }
          const snapshot = await loadConversation(
            activeWorkspaceId,
            conversation.conversationId,
          ).catch(() => null);
          if (!snapshot) {
            return;
          }
          exportMarkdownFile({
            filePath: conversation.title || "conversation",
            markdown: conversationToMarkdown(conversation.title, snapshot.messages),
          });
        })();
      },
      onArchive: () =>
        void archiveConversation(conversation.conversationId, !conversation.archived),
      onDelete: () => deleteConversation(conversation.conversationId),
    }),
    [
      activeWorkspaceId,
      archiveConversation,
      confirm,
      deleteConversation,
      duplicateConversation,
      promptText,
      renameConversation,
    ],
  );
}
