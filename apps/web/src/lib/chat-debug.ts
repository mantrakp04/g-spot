import type { UIMessage } from "@/lib/chat-ui";

export function isChatDebugEnabled() {
  return import.meta.env.DEV;
}

export function setChatDebugEnabled(enabled: boolean) {
  void enabled;
}

export function logChatDebug(event: string, payload?: unknown) {
  if (!isChatDebugEnabled()) {
    return;
  }

  if (payload === undefined) {
    console.log(`[g-spot chat] ${event}`);
    return;
  }

  console.log(`[g-spot chat] ${event}`, payload);
}

export function summarizeUiMessage(message: UIMessage) {
  const textPreview = message.parts
    .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim()
    .slice(0, 120);

  return {
    id: message.id,
    role: message.role,
    createdAt: message.createdAt,
    partCount: message.parts.length,
    partTypes: message.parts.map((part) => part.type),
    textPreview,
  };
}
