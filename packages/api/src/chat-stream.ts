import { saveChatMessage } from "@g-spot/db/chat";
import type { UIMessage } from "ai";
import { convertToModelMessages, streamText } from "ai";
import { nanoid } from "nanoid";

import { createOpenAIClient, getOpenAICredentials } from "./lib/openai";
import { verifyStackToken } from "./lib/verify-token";

/** Strip file parts with data: URLs — all new attachments use server URLs. */
function preprocessMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg) => ({
    ...msg,
    parts: msg.parts.filter(
      (part) => !(part.type === "file" && "url" in part && (part.url as string)?.startsWith("data:")),
    ),
  })) as UIMessage[];
}

export async function handleChatStream(request: Request): Promise<Response> {
  // Authenticate
  const accessToken = request.headers.get("x-stack-access-token");
  if (!accessToken) {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = await verifyStackToken(accessToken);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Get OpenAI credentials
  const creds = await getOpenAICredentials(userId);
  if (!creds) {
    return new Response("OpenAI not connected", { status: 400 });
  }

  // Parse request body
  const body = (await request.json()) as {
    messages: UIMessage[];
    chatId: string;
    model?: string;
  };
  const { messages: rawMessages, chatId, model = "gpt-5.4" } = body;

  // Convert data: URLs to inline data so the AI SDK won't try to download them
  const messages = preprocessMessages(rawMessages);

  // Create per-request OpenAI provider with correct base URL and headers
  const openai = createOpenAIClient(creds);

  // Convert UI messages to model messages for streamText
  const modelMessages = await convertToModelMessages(messages);

  try {
    const result = streamText({
      model: openai.responses(model),
      messages: modelMessages,
      providerOptions: {
        openai: {
          instructions: "You are a helpful assistant.",
          store: false,
        },
      },
      onFinish: async ({ text }) => {
        // Persist assistant response
        if (text) {
          const id = nanoid();
          const uiMessage = {
            id,
            role: "assistant" as const,
            parts: [{ type: "text" as const, text }],
            createdAt: new Date().toISOString(),
          };
          await saveChatMessage(chatId, {
            id,
            message: JSON.stringify(uiMessage),
          });
        }
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    console.error("Chat stream error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Stream failed" }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
}
