import type { UIMessage } from "@/lib/chat-ui";

export function isChatDebugEnabled() {
  return false;
}

export function setChatDebugEnabled(enabled: boolean) {
  void enabled;
}

export function logChatDebug(event: string, payload?: unknown) {
  void event;
  void payload;
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
