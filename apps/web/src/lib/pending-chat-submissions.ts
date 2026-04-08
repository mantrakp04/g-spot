import type { UIMessage } from "@/lib/chat-ui";

type PendingChatSubmission = {
  messageId: string;
  parts: UIMessage["parts"];
};

const pendingChatSubmissions = new Map<string, PendingChatSubmission>();

export function setPendingChatSubmission(
  chatId: string,
  submission: PendingChatSubmission,
) {
  pendingChatSubmissions.set(chatId, submission);
}

export function consumePendingChatSubmission(chatId: string) {
  const submission = pendingChatSubmissions.get(chatId) ?? null;
  if (submission) {
    pendingChatSubmissions.delete(chatId);
  }
  return submission;
}
