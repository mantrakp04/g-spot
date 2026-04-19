import {
  createChat,
  deleteChat,
  deleteChatMessage,
  forkChat,
  getChat,
  getChatMessages,
  listChats,
  replaceChatMessages,
  updateChatAgentConfig,
  updateChatTitle,
} from "@g-spot/db/chat";
import { getProject } from "@g-spot/db/projects";
import { z } from "zod";

import type { PiChatHistoryMessage } from "@g-spot/types";
import { piAgentConfigSchema } from "@g-spot/types";

import { publicProcedure, router } from "../index";
import {
  markChatRuntimeRead,
  resolveChatToolApproval,
  snapshotChatRuntimeStatuses,
} from "../chat-runtime";
import { deserializePiMessages } from "../lib/pi-chat-messages";
import {
  getPiAgentDefaults,
  normalizePiAgentConfig,
  normalizeStoredChatAgentConfig,
  normalizeStoredProjectAgentConfig,
} from "../lib/pi";

function withParsedAgentConfig<T extends { agentConfig?: string | null; model?: string }>(
  chat: T,
) {
  return {
    ...chat,
    agentConfig: normalizeStoredChatAgentConfig(chat),
  };
}

export const chatRouter = router({
  list: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z
          .object({
            updatedAt: z.string(),
            id: z.string(),
          })
          .nullable()
          .optional(),
      }),
    )
    .query(async ({ input }) => {
      const page = await listChats(input);
      return {
        ...page,
        chats: page.chats.map((chat) => withParsedAgentConfig(chat)),
      };
    }),

  get: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const chat = await getChat(input.chatId);
      return chat ? withParsedAgentConfig(chat) : null;
    }),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        title: z.string().optional(),
        model: z.string().min(1).optional(),
        agentConfig: piAgentConfigSchema.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // Seed new chats from the per-project agent config when the caller
      // doesn't send one explicitly. The project-level config is itself
      // seeded from `/chat/settings` at project creation time, so:
      //   user defaults  →  project config  →  chat config
      const defaults = await getPiAgentDefaults();
      let agentConfig = input.agentConfig
        ? normalizePiAgentConfig(input.agentConfig)
        : undefined;

      if (!agentConfig) {
        const project = await getProject(input.projectId);
        if (project) {
          agentConfig = normalizeStoredProjectAgentConfig(
            project.agentConfig,
            defaults.chat,
          );
        }
      }

      return createChat({
        projectId: input.projectId,
        title: input.title,
        model: agentConfig?.modelId ?? input.model,
        agentConfig: agentConfig ? JSON.stringify(agentConfig) : undefined,
      });
    }),

  updateTitle: publicProcedure
    .input(z.object({ chatId: z.string(), title: z.string() }))
    .mutation(async ({ input }) => {
      await updateChatTitle(input.chatId, input.title);
    }),

  updateModel: publicProcedure
    .input(z.object({ chatId: z.string(), model: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const chat = await getChat(input.chatId);
      if (!chat) throw new Error("Chat not found");

      const currentAgentConfig = withParsedAgentConfig(chat).agentConfig;
      const nextAgentConfig = normalizePiAgentConfig(
        Object.assign({}, currentAgentConfig, {
          modelId: input.model,
        }),
      );

      await updateChatAgentConfig(
        input.chatId,
        JSON.stringify(nextAgentConfig),
        nextAgentConfig.modelId,
      );
    }),

  updateAgentConfig: publicProcedure
    .input(z.object({ chatId: z.string(), agentConfig: piAgentConfigSchema }))
    .mutation(async ({ input }) => {
      const nextAgentConfig = normalizePiAgentConfig(input.agentConfig);
      await updateChatAgentConfig(
        input.chatId,
        JSON.stringify(nextAgentConfig),
        nextAgentConfig.modelId,
      );
    }),

  delete: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(async ({ input }) => {
      await deleteChat(input.chatId);
    }),

  messages: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      // Verify ownership
      const chat = await getChat(input.chatId);
      if (!chat) return [];
      const rows = await getChatMessages(input.chatId);
      const messages = await deserializePiMessages(rows);
      const history: PiChatHistoryMessage[] = messages.map((row) => ({
        ...row.parsedMessage,
        id: row.id,
        createdAt: row.createdAt,
      }));
      return history;
    }),

  replaceMessages: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        messages: z.array(
          z.object({
            id: z.string(),
            message: z.string(), // JSON-serialized PI message
          }),
        ),
      }),
    )
    .mutation(async ({ input }) => {
      const chat = await getChat(input.chatId);
      if (!chat) throw new Error("Chat not found");
      await replaceChatMessages(input.chatId, input.messages);
    }),

  fork: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        messages: z.array(
          z.object({
            id: z.string(),
            message: z.string(), // JSON-serialized PI message
          }),
        ),
      }),
    )
    .mutation(async ({ input }) => {
      const sourceChat = await getChat(input.chatId);
      if (!sourceChat) throw new Error("Chat not found");

      return forkChat(
        sourceChat.projectId,
        `${sourceChat.title} (fork)`,
        sourceChat.model,
        sourceChat.agentConfig,
        input.messages,
      );
    }),

  deleteMessage: publicProcedure
    .input(z.object({ messageId: z.string() }))
    .mutation(async ({ input }) => {
      await deleteChatMessage(input.messageId);
    }),

  /**
   * Snapshot of which of the user's chats currently have an active runtime.
   * Used by the sidebar to show a per-chat status dot (running / pending
   * approval / finished-unread). Chats absent from the map are
   * idle-and-acknowledged.
   *
   * The web polls this at a low frequency — don't do anything expensive
   * here.
   */
  runtimeStatuses: publicProcedure.query(() => {
    return snapshotChatRuntimeStatuses();
  }),

  /**
   * Clear the "finished-unread" dot for a chat. Called by the web when the
   * user opens the chat (so visiting a chat always acts as an ack) and
   * again when a stream finishes while the chat is already visible.
   */
  markChatRead: publicProcedure
    .input(z.object({ chatId: z.string().min(1) }))
    .mutation(({ input }) => {
      const cleared = markChatRuntimeRead(input.chatId);
      return { cleared };
    }),

  /**
   * Resolve a pending tool-call approval. The chat stream publishes a
   * `tool_approval_request` event when a tool call is gated by the current
   * `PiAgentConfig.approvalPolicy`; the client renders approve/deny buttons
   * and calls this mutation to unblock (or reject) the pending call.
   */
  resolveToolApproval: publicProcedure
    .input(
      z.object({
        chatId: z.string().min(1),
        toolCallId: z.string().min(1),
        approved: z.boolean(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const resolved = resolveChatToolApproval(input.chatId, {
        toolCallId: input.toolCallId,
        approved: input.approved,
        reason: input.reason,
      });
      return { resolved };
    }),
});
