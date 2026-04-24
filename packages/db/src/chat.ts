import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "./index";
import { chatMessages, chats } from "./schema";

type ChatListCursor = {
  updatedAt: string;
  id: string;
};

type CreateChatInput = {
  projectId: string;
  title?: string;
  agentConfig?: string;
};

function getFallbackSerializedAgentConfig() {
  return JSON.stringify({
    modelId: "gpt-5.4-mini",
    thinkingLevel: "off",
  });
}

function timestampSortValue(value: string | typeof chats.updatedAt | typeof chatMessages.createdAt) {
  return sql<number>`coalesce(cast((julianday(${value}) - 2440587.5) * 86400000 as integer), 0)`;
}

function extractSerializedMessageCreatedAt(
  serializedMessage: string,
  fallback: string,
) {
  try {
    const parsed = JSON.parse(serializedMessage) as { createdAt?: unknown };

    if (typeof parsed.createdAt !== "string") {
      return fallback;
    }

    const parsedTime = Date.parse(parsed.createdAt);
    return Number.isNaN(parsedTime) ? fallback : new Date(parsedTime).toISOString();
  } catch {
    return fallback;
  }
}

export async function listChats(input: {
  projectId: string;
  cursor?: ChatListCursor | null;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const cursor = input.cursor ?? null;
  const updatedAtSortValue = timestampSortValue(chats.updatedAt);
  const cursorUpdatedAtSortValue = cursor ? timestampSortValue(cursor.updatedAt) : null;

  const scopeFilter = eq(chats.projectId, input.projectId);

  const rows = await db
    .select()
    .from(chats)
    .where(
      cursor
        ? and(
            scopeFilter,
            or(
              sql`${updatedAtSortValue} < ${cursorUpdatedAtSortValue}`,
              and(
                sql`${updatedAtSortValue} = ${cursorUpdatedAtSortValue}`,
                lt(chats.id, cursor.id),
              ),
            ),
          )
        : scopeFilter,
    )
    .orderBy(desc(updatedAtSortValue), desc(chats.id))
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

export async function getChat(chatId: string) {
  const [chat] = await db
    .select()
    .from(chats)
    .where(eq(chats.id, chatId));
  return chat ?? null;
}

export async function createChat(input: CreateChatInput) {
  const id = nanoid();
  const now = new Date().toISOString();

  await db.insert(chats).values({
    id,
    projectId: input.projectId,
    title: input.title ?? "New Chat",
    agentConfig: input.agentConfig ?? getFallbackSerializedAgentConfig(),
    createdAt: now,
    updatedAt: now,
  });

  return { id };
}

export async function updateChatTitle(chatId: string, title: string) {
  await db
    .update(chats)
    .set({ title, updatedAt: new Date().toISOString() })
    .where(eq(chats.id, chatId));
}

export async function updateChatAgentConfig(
  chatId: string,
  agentConfig: string,
) {
  await db
    .update(chats)
    .set({
      agentConfig,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(chats.id, chatId));
}

export async function deleteChat(chatId: string) {
  await db.delete(chats).where(eq(chats.id, chatId));
}

export async function getChatMessages(chatId: string) {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(timestampSortValue(chatMessages.createdAt), sql`rowid`);
}

export async function getLatestUserChatMessageId(chatId: string) {
  const rows = await db
    .select({
      id: chatMessages.id,
      message: chatMessages.message,
    })
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(desc(timestampSortValue(chatMessages.createdAt)), desc(sql`rowid`))
    .limit(8);

  for (const row of rows) {
    try {
      const parsedMessage = JSON.parse(row.message) as { role?: unknown };
      if (parsedMessage.role === "user") {
        return row.id;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function saveChatMessage(
  chatId: string,
  message: { id: string; message: string },
) {
  const now = new Date().toISOString();

  await db.insert(chatMessages).values({
    id: message.id,
    chatId,
    message: message.message,
    createdAt: extractSerializedMessageCreatedAt(message.message, now),
  });
  await db
    .update(chats)
    .set({ updatedAt: now })
    .where(eq(chats.id, chatId));
}

export async function replaceChatMessages(
  chatId: string,
  messages: Array<{ id: string; message: string }>,
) {
  await db.transaction(async (tx) => {
    const now = new Date().toISOString();

    await tx.delete(chatMessages).where(eq(chatMessages.chatId, chatId));

    if (messages.length > 0) {
      await tx.insert(chatMessages).values(
        messages.map((message) => ({
          id: message.id,
          chatId,
          message: message.message,
          createdAt: extractSerializedMessageCreatedAt(message.message, now),
        })),
      );
    }

    await tx
      .update(chats)
      .set({ updatedAt: now })
      .where(eq(chats.id, chatId));
  });
}

export async function forkChat(
  projectId: string,
  title: string | undefined,
  agentConfig: string | undefined,
  messages: Array<{ id: string; message: string }>,
) {
  const id = nanoid();
  const now = new Date().toISOString();
  const forkedMessages = messages.map((message) => {
    const nextMessageId = nanoid();
    const nextSerializedMessage = message.message;

    return {
      id: nextMessageId,
      chatId: id,
      message: nextSerializedMessage,
      createdAt: extractSerializedMessageCreatedAt(nextSerializedMessage, now),
    };
  });

  await db.transaction(async (tx) => {
    await tx.insert(chats).values({
      id,
      projectId,
      title: title ?? "New Chat",
      agentConfig: agentConfig ?? getFallbackSerializedAgentConfig(),
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
