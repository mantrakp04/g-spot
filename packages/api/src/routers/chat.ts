import {
  createChat,
  deleteChat,
  deleteChatMessage,
  forkChat,
  getChat,
  getChatMessages,
  listChats,
  replaceChatMessages,
  saveChatMessage,
  updateChatModel,
  updateChatTitle,
} from "@g-spot/db/chat";
import { generateText } from "ai";
import { z } from "zod";

import {
  createOpenAIClient,
  getOpenAICredentials,
} from "../lib/openai";
import { authedProcedure, router } from "../index";

function extractTranscriptText(
  messages: Array<{
    role: "system" | "user" | "assistant";
    parts: unknown[];
  }>,
) {
  return messages
    .map((message) => {
      const text = message.parts
        .flatMap((part) => {
          if (
            typeof part === "object" &&
            part !== null &&
            "type" in part &&
            "text" in part &&
            part.type === "text" &&
            typeof part.text === "string"
          ) {
            return [part.text.trim()];
          }

          return [];
        })
        .filter(Boolean)
        .join("\n");

      return text ? `${message.role}: ${text}` : null;
    })
    .filter(Boolean)
    .slice(-12)
    .join("\n\n");
}

function sanitizeGeneratedTitle(text: string) {
  return text
    .split("\n")[0]
    ?.trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

export const chatRouter = router({
  list: authedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          cursor: z
            .object({
              updatedAt: z.string(),
              id: z.string(),
            })
            .nullable()
            .optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return listChats(ctx.userId, input);
    }),

  get: authedProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ ctx, input }) => {
      return getChat(ctx.userId, input.chatId);
    }),

  create: authedProcedure
    .input(
      z.object({
        title: z.string().optional(),
        model: z.string().min(1).optional(),
        initialMessage: z
          .object({
            id: z.string(),
            message: z.string(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return createChat(ctx.userId, input);
    }),

  updateTitle: authedProcedure
    .input(z.object({ chatId: z.string(), title: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await updateChatTitle(ctx.userId, input.chatId, input.title);
    }),

  updateModel: authedProcedure
    .input(z.object({ chatId: z.string(), model: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await updateChatModel(ctx.userId, input.chatId, input.model);
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
      return rows.map((row) => ({
        ...JSON.parse(row.message),
        createdAt: row.createdAt,
      }));
    }),

  saveMessage: authedProcedure
    .input(
      z.object({
        chatId: z.string(),
        message: z.object({
          id: z.string(),
          message: z.string(), // JSON-serialized UIMessage
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const chat = await getChat(ctx.userId, input.chatId);
      if (!chat) throw new Error("Chat not found");
      await saveChatMessage(input.chatId, input.message);
    }),

  replaceMessages: authedProcedure
    .input(
      z.object({
        chatId: z.string(),
        messages: z.array(
          z.object({
            id: z.string(),
            message: z.string(),
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
            message: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sourceChat = await getChat(ctx.userId, input.chatId);
      if (!sourceChat) throw new Error("Chat not found");

      return forkChat(
        ctx.userId,
        `${sourceChat.title} (fork)`,
        sourceChat.model,
        input.messages,
      );
    }),

  generateTitle: authedProcedure
    .input(
      z.object({
        chatId: z.string(),
        model: z.string().min(1),
        messages: z.array(
          z.object({
            role: z.enum(["system", "user", "assistant"]),
            parts: z.array(z.unknown()),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const chat = await getChat(ctx.userId, input.chatId);
      if (!chat) throw new Error("Chat not found");

      const transcript = extractTranscriptText(input.messages);
      if (!transcript) {
        return { title: chat.title };
      }

      const credentials = await getOpenAICredentials(ctx.userId);
      if (!credentials) {
        throw new Error("OpenAI not connected");
      }

      const openai = createOpenAIClient(credentials);
      const result = await generateText({
        model: openai.responses(input.model),
        system:
          "Generate a short chat title. Return only the title in sentence case, no quotes, no markdown, and keep it under 8 words.",
        prompt: transcript,
        maxOutputTokens: 24,
        providerOptions: {
          openai: {
            store: false,
          },
        },
      });

      const title = sanitizeGeneratedTitle(result.text);
      if (!title) {
        return { title: chat.title };
      }

      if (title !== chat.title) {
        await updateChatTitle(ctx.userId, input.chatId, title);
      }

      return { title };
    }),

  deleteMessage: authedProcedure
    .input(z.object({ messageId: z.string() }))
    .mutation(async ({ input }) => {
      await deleteChatMessage(input.messageId);
    }),
});
