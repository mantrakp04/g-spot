import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "./index";
import { chatMessages, chats } from "./schema";

type ChatListCursor = {
  updatedAt: string;
  id: string;
};

type CreateChatInput = {
  title?: string;
  model?: string;
  initialMessage?: {
    id: string;
    message: string;
  };
};

export async function listChats(
  userId: string,
  input?: {
    cursor?: ChatListCursor | null;
    limit?: number;
  },
) {
  const limit = Math.min(Math.max(input?.limit ?? 20, 1), 100);
  const cursor = input?.cursor ?? null;

  const rows = await db
    .select()
    .from(chats)
    .where(
      cursor
        ? and(
            eq(chats.userId, userId),
            or(
              lt(chats.updatedAt, cursor.updatedAt),
              and(eq(chats.updatedAt, cursor.updatedAt), lt(chats.id, cursor.id)),
            ),
          )
        : eq(chats.userId, userId),
    )
    .orderBy(desc(chats.updatedAt), desc(chats.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const lastChat = page.at(-1);

  return {
    chats: page,
    nextCursor:
      rows.length > limit && lastChat
        ? {
            updatedAt: lastChat.updatedAt,
            id: lastChat.id,
          }
        : null,
  };
}

export async function getChat(userId: string, chatId: string) {
  const [chat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)));
  return chat ?? null;
}

export async function createChat(userId: string, input?: CreateChatInput) {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.insert(chats).values({
      id,
      userId,
      title: input?.title ?? "New Chat",
      model: input?.model ?? "gpt-5.4-mini",
      createdAt: now,
      updatedAt: now,
    });

    if (input?.initialMessage) {
      await tx.insert(chatMessages).values({
        id: input.initialMessage.id,
        chatId: id,
        message: input.initialMessage.message,
        createdAt: now,
      });
    }
  });

  return { id };
}

export async function updateChatTitle(
  userId: string,
  chatId: string,
  title: string,
) {
  await db
    .update(chats)
    .set({ title, updatedAt: new Date().toISOString() })
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)));
}

export async function updateChatModel(
  userId: string,
  chatId: string,
  model: string,
) {
  await db
    .update(chats)
    .set({ model, updatedAt: new Date().toISOString() })
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)));
}

export async function deleteChat(userId: string, chatId: string) {
  await db
    .delete(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)));
}

export async function getChatMessages(chatId: string) {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(chatMessages.createdAt, sql`rowid`);
}

export async function saveChatMessage(
  chatId: string,
  message: { id: string; message: string },
) {
  await db.insert(chatMessages).values({
    id: message.id,
    chatId,
    message: message.message,
  });
  await db
    .update(chats)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(chats.id, chatId));
}

export async function replaceChatMessages(
  chatId: string,
  messages: Array<{ id: string; message: string }>,
) {
  await db.transaction(async (tx) => {
    await tx.delete(chatMessages).where(eq(chatMessages.chatId, chatId));

    if (messages.length > 0) {
      await tx.insert(chatMessages).values(
        messages.map((message) => ({
          id: message.id,
          chatId,
          message: message.message,
        })),
      );
    }

    await tx
      .update(chats)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(chats.id, chatId));
  });
}

export async function forkChat(
  userId: string,
  title: string | undefined,
  model: string | undefined,
  messages: Array<{ id: string; message: string }>,
) {
  const id = nanoid();
  const now = new Date().toISOString();
  const forkedMessages = messages.map((message) => {
    const nextMessageId = nanoid();
    const parsedMessage = JSON.parse(message.message) as { id?: string };

    return {
      id: nextMessageId,
      chatId: id,
      message: JSON.stringify({
        ...parsedMessage,
        id: nextMessageId,
      }),
    };
  });

  await db.transaction(async (tx) => {
    await tx.insert(chats).values({
      id,
      userId,
      title: title ?? "New Chat",
      model: model ?? "gpt-5.4-mini",
      createdAt: now,
      updatedAt: now,
    });

    if (forkedMessages.length > 0) {
      await tx.insert(chatMessages).values(forkedMessages);
    }
  });

  return { id };
}

export async function deleteChatMessage(messageId: string) {
  await db.delete(chatMessages).where(eq(chatMessages.id, messageId));
}
