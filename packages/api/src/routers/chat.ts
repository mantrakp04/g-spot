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

import { authedProcedure, router } from "../index";
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
  list: authedProcedure
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
    .query(async ({ ctx, input }) => {
      const page = await listChats(ctx.userId, input);
      return {
        ...page,
        chats: page.chats.map((chat) => withParsedAgentConfig(chat)),
      };
    }),

  get: authedProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ ctx, input }) => {
      const chat = await getChat(ctx.userId, input.chatId);
      return chat ? withParsedAgentConfig(chat) : null;
    }),

  create: authedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        title: z.string().optional(),
        model: z.string().min(1).optional(),
        agentConfig: piAgentConfigSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Seed new chats from the per-project agent config when the caller
      // doesn't send one explicitly. The project-level config is itself
      // seeded from `/chat/settings` at project creation time, so:
      //   user defaults  →  project config  →  chat config
      let agentConfig = input.agentConfig
        ? normalizePiAgentConfig(input.agentConfig)
        : undefined;

      if (!agentConfig) {
        const project = await getProject(ctx.userId, input.projectId);
        if (project) {
          const defaults = await getPiAgentDefaults(ctx.userId);
          agentConfig = normalizeStoredProjectAgentConfig(
            project.agentConfig,
            defaults.chat,
          );
        }
      }

      return createChat(ctx.userId, {
        projectId: input.projectId,
        title: input.title,
        model: agentConfig?.modelId ?? input.model,
        agentConfig: agentConfig ? JSON.stringify(agentConfig) : undefined,
      });
    }),

  updateTitle: authedProcedure
    .input(z.object({ chatId: z.string(), title: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await updateChatTitle(ctx.userId, input.chatId, input.title);
    }),

  updateModel: authedProcedure
    .input(z.object({ chatId: z.string(), model: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const chat = await getChat(ctx.userId, input.chatId);
      if (!chat) throw new Error("Chat not found");

      const currentAgentConfig = withParsedAgentConfig(chat).agentConfig;
      const nextAgentConfig = normalizePiAgentConfig(
        Object.assign({}, currentAgentConfig, {
          modelId: input.model,
        }),
      );

      await updateChatAgentConfig(
        ctx.userId,
        input.chatId,
        JSON.stringify(nextAgentConfig),
        nextAgentConfig.modelId,
      );
    }),

  updateAgentConfig: authedProcedure
    .input(z.object({ chatId: z.string(), agentConfig: piAgentConfigSchema }))
    .mutation(async ({ ctx, input }) => {
      const nextAgentConfig = normalizePiAgentConfig(input.agentConfig);
      await updateChatAgentConfig(
        ctx.userId,
        input.chatId,
        JSON.stringify(nextAgentConfig),
        nextAgentConfig.modelId,
      );
    }),

  delete: authedProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await deleteChat(ctx.userId, input.chatId);
    }),

  messages: authedProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const chat = await getChat(ctx.userId, input.chatId);
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

  replaceMessages: authedProcedure
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
    .mutation(async ({ ctx, input }) => {
      const chat = await getChat(ctx.userId, input.chatId);
      if (!chat) throw new Error("Chat not found");
      await replaceChatMessages(input.chatId, input.messages);
    }),

  fork: authedProcedure
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
    .mutation(async ({ ctx, input }) => {
      const sourceChat = await getChat(ctx.userId, input.chatId);
      if (!sourceChat) throw new Error("Chat not found");

      return forkChat(
        ctx.userId,
        sourceChat.projectId,
        `${sourceChat.title} (fork)`,
        sourceChat.model,
        sourceChat.agentConfig,
        input.messages,
      );
    }),

  deleteMessage: authedProcedure
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
  runtimeStatuses: authedProcedure.query(({ ctx }) => {
    return snapshotChatRuntimeStatuses(ctx.userId);
  }),

  /**
   * Clear the "finished-unread" dot for a chat. Called by the web when the
   * user opens the chat (so visiting a chat always acts as an ack) and
   * again when a stream finishes while the chat is already visible.
   */
  markChatRead: authedProcedure
    .input(z.object({ chatId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      const cleared = markChatRuntimeRead(input.chatId, ctx.userId);
      return { cleared };
    }),

  /**
   * Resolve a pending tool-call approval. The chat stream publishes a
   * `tool_approval_request` event when a tool call is gated by the current
   * `PiAgentConfig.approvalPolicy`; the client renders approve/deny buttons
   * and calls this mutation to unblock (or reject) the pending call.
   */
  resolveToolApproval: authedProcedure
    .input(
      z.object({
        chatId: z.string().min(1),
        toolCallId: z.string().min(1),
        approved: z.boolean(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const resolved = resolveChatToolApproval(input.chatId, ctx.userId, {
        toolCallId: input.toolCallId,
        approved: input.approved,
        reason: input.reason,
      });
      return { resolved };
    }),
});
