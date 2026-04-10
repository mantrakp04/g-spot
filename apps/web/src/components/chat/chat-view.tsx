import { Skeleton } from "@g-spot/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@g-spot/ui/components/tabs";
import { env } from "@g-spot/env/web";
import type {
  PiAgentConfig,
  PiChatHistoryMessage,
  PiSdkMessage,
} from "@g-spot/types";
import {
  PaperclipIcon,
  XIcon,
  CodeIcon,
  CompassIcon,
  GraduationCapIcon,
  ArrowRightIcon,
  PenLineIcon,
} from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputProvider,
  PromptInputTextarea,
  PromptInputHeader,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
  PromptInputSelect,
  PromptInputSelectTrigger,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectValue,
  PromptInputButton,
  usePromptInputAttachments,
  usePromptInputController,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import {
  SlashCommandPopover,
  type SlashCommandPopoverHandle,
} from "@/components/chat/slash-command-popover";
import type { BuiltinHandlers } from "@/lib/slash-commands";

import { ChatMessage } from "./chat-message";

const STARTER_TAB_IDS = ["create", "explore", "code", "learn"] as const;
type StarterTabId = (typeof STARTER_TAB_IDS)[number];

const STARTER_PROMPTS: Record<StarterTabId, readonly string[]> = {
  create: [
    "Brainstorm ideas for a weekend project I could ship in a day",
    "Help me outline a clear, friendly email to follow up after an interview",
    "Draft a short product description for something I’m building",
    "Suggest a memorable name and one-line pitch for a new app idea",
  ],
  explore: [
    "What should I know before diving into a new field or hobby?",
    "Compare two common approaches and when each makes sense",
    "What are the open questions or tradeoffs in this topic?",
    "Summarize the main pros and cons in plain language",
  ],
  code: [
    "Explain what this error usually means and how to debug it",
    "Help me refactor this function for readability and fewer edge cases",
    "Sketch a small TypeScript type that models this data safely",
    "What’s a solid way to structure tests for this kind of logic?",
  ],
  learn: [
    "Explain this concept like I’m new but curious",
    "What’s the difference between these two terms people mix up?",
    "Give me a short study plan to go from zero to comfortable",
    "What are the most common misconceptions about this topic?",
  ],
};
import { stackClientApp } from "@/stack/client";
import {
  useChatDetail,
  useChatMessages,
  useCreateChatMutation,
  useForkChatMutation,
  useMarkChatReadMutation,
  useReplaceChatMessagesMutation,
  useUpdateChatAgentConfigMutation,
} from "@/hooks/use-chat-data";
import {
  usePiCatalog,
  usePiDefaults,
  useUpdatePiDefaultsMutation,
} from "@/hooks/use-pi";
import {
  type ChatStatus,
  type ChatStreamEvent,
  type UIMessage,
  type UIMessagePart,
  applyPiToolResultToMessages,
  applyToolApprovalRequestToMessages,
  applyToolApprovalResolvedToMessages,
  getMessageText,
  piHistoryToUiMessages,
  piMessageToUiMessage,
} from "@/lib/chat-ui";
import { trpcClient } from "@/utils/trpc";
import { usePiChatStream } from "@/hooks/use-pi-chat-stream";
import {
  logChatDebug,
  summarizeUiMessage,
} from "@/lib/chat-debug";
import {
  applyPermissionModePreset,
  areAgentConfigsEqual,
  FALLBACK_PI_AGENT_CONFIG,
  getModelValue,
  getPermissionModePresetId,
  normalizeAgentConfig,
  PERMISSION_MODE_PRESETS,
  PERMISSION_MODE_PRESET_ORDER,
  THINKING_LEVEL_OPTIONS,
  type PermissionModePresetId,
} from "@/lib/pi-agent-config";
import { chatKeys } from "@/lib/query-keys";
import { consumePendingChatSubmission, setPendingChatSubmission } from "@/lib/pending-chat-submissions";

/** Attach files button — must be a child of PromptInput to access attachments context */
function AttachFilesButton() {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton onClick={() => attachments.openFileDialog()}>
      <PaperclipIcon className="size-4" />
    </PromptInputButton>
  );
}

/** Shows attached file previews above the textarea */
function AttachmentPreviews() {
  const { files, remove } = usePromptInputAttachments();
  if (files.length === 0) return null;

  return (
    <PromptInputHeader>
      <div className="flex flex-wrap gap-2">
        {files.map((file) => {
          const isImage = file.mediaType?.startsWith("image/");
          return (
            <div
              key={file.id}
              className="group/att relative flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/50 px-2 py-1 text-xs"
            >
              {isImage && file.url ? (
                <img
                  src={file.url}
                  alt={file.filename}
                  className="size-6 rounded object-cover"
                />
              ) : (
                <PaperclipIcon className="size-3.5 text-muted-foreground" />
              )}
              <span className="max-w-[120px] truncate">{file.filename}</span>
              <button
                type="button"
                className="ml-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => remove(file.id)}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
    </PromptInputHeader>
  );
}

interface ChatViewProps {
  chatId?: string;
  /**
   * Project this chat belongs to (or, when `chatId` is omitted, the project
   * that a freshly created chat will be assigned to).
   */
  projectId: string;
}

type ChatUiMessage = UIMessage;

function stripHistoryMessage(message: PiChatHistoryMessage): PiSdkMessage {
  const { id: _id, createdAt: _createdAt, ...persistedMessage } = message;
  return persistedMessage;
}

function serializeHistoryMessage(message: PiChatHistoryMessage) {
  return {
    id: message.id,
    message: JSON.stringify(stripHistoryMessage(message)),
  };
}

function updatePersistedUserMessageText(
  message: PiChatHistoryMessage,
  newText: string,
): PiChatHistoryMessage {
  if (message.role !== "user") {
    throw new Error("Only user messages can be edited");
  }

  const originalContent: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  > = Array.isArray(message.content)
    ? message.content
    : typeof message.content === "string" && message.content.trim().length > 0
      ? [{ type: "text", text: message.content }]
      : [];

  let replaced = false;
  const nextContent: typeof originalContent = [];

  for (const part of originalContent) {
    if (part.type !== "text") {
      nextContent.push(part);
      continue;
    }

    if (replaced) {
      continue;
    }

    replaced = true;
    nextContent.push({ type: "text", text: newText });
  }

  if (!replaced) {
    nextContent.unshift({ type: "text" as const, text: newText });
  }

  return {
    ...message,
    content: nextContent,
  };
}

async function getChatHeaders() {
  const user = await stackClientApp.getUser();
  if (!user) {
    return { "content-type": "application/json" } as Record<string, string>;
  }

  const { accessToken } = await user.getAuthJson();
  return accessToken
    ? ({
        "content-type": "application/json",
        "x-stack-access-token": accessToken,
      } as Record<string, string>)
    : ({ "content-type": "application/json" } as Record<string, string>);
}

/**
 * Outer wrapper: fetches DB messages, shows loading skeleton,
 * then mounts ChatViewInner only once data is ready.
 * This ensures useChat initializes with the actual messages.
 */
export function ChatView({ chatId, projectId }: ChatViewProps) {
  const { data: chat, isLoading: isLoadingChat } = useChatDetail(chatId ?? "");
  const { data: dbMessages, isLoading: isLoadingMessages } = useChatMessages(chatId ?? "");

  useEffect(() => {
    logChatDebug("chat-view-query-state", {
      chatId,
      projectId,
      isLoadingChat,
      isLoadingMessages,
      dbMessageCount: dbMessages?.length ?? 0,
      hasPersistedAgentConfig: chat?.agentConfig != null,
    });
  }, [chat?.agentConfig, chatId, projectId, dbMessages?.length, isLoadingChat, isLoadingMessages]);

  if (chatId && (isLoadingChat || isLoadingMessages || !dbMessages)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <div className="flex w-full max-w-2xl flex-col gap-4">
          <Skeleton className="h-12 w-3/5 rounded-xl" />
          <Skeleton className="ml-auto h-8 w-2/5 rounded-xl" />
          <Skeleton className="h-16 w-4/5 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <ChatViewInner
      key={`${projectId}:${chatId ?? "draft"}`}
      chatId={chatId ?? null}
      projectId={projectId}
      chatAgentConfig={chat?.agentConfig ?? null}
      dbMessages={dbMessages ?? []}
    />
  );
}

interface ChatViewInnerProps {
  chatId: string | null;
  projectId: string;
  chatAgentConfig: PiAgentConfig | null;
  dbMessages: PiChatHistoryMessage[];
}

function ChatViewInner({
  chatId,
  projectId,
  chatAgentConfig,
  dbMessages,
}: ChatViewInnerProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const piCatalog = usePiCatalog();
  const piDefaults = usePiDefaults();
  const createChat = useCreateChatMutation();
  const updateChatAgentConfig = useUpdateChatAgentConfigMutation();
  const updatePiDefaults = useUpdatePiDefaultsMutation();
  const replaceMessages = useReplaceChatMessagesMutation();
  const forkChat = useForkChatMutation();
  const markChatRead = useMarkChatReadMutation();
  const isDraft = chatId === null;
  const allModels = piCatalog.data?.models ?? [];
  const draftDefaultConfig = useMemo(
    () =>
      normalizeAgentConfig(
        piDefaults.data?.chat ?? FALLBACK_PI_AGENT_CONFIG,
        allModels,
      ),
    [allModels, piDefaults.data?.chat],
  );
  const draftWorkerDefaultConfig = useMemo(
    () =>
      normalizeAgentConfig(
        piDefaults.data?.worker ?? FALLBACK_PI_AGENT_CONFIG,
        allModels,
      ),
    [allModels, piDefaults.data?.worker],
  );
  const persistedAgentConfig = useMemo(
    () =>
      normalizeAgentConfig(
        chatAgentConfig ?? FALLBACK_PI_AGENT_CONFIG,
        allModels,
      ),
    [allModels, chatAgentConfig],
  );
  const [agentConfig, setAgentConfig] = useState<PiAgentConfig>(
    isDraft ? draftDefaultConfig : persistedAgentConfig,
  );
  const lastAppliedDraftConfigRef = useRef<PiAgentConfig | null>(null);

  useEffect(() => {
    if (isDraft) {
      setAgentConfig((current) => {
        const shouldSync =
          lastAppliedDraftConfigRef.current === null ||
          areAgentConfigsEqual(current, lastAppliedDraftConfigRef.current);

        lastAppliedDraftConfigRef.current = draftDefaultConfig;

        if (!shouldSync) {
          return current;
        }

        logChatDebug("agent-config-sync", {
          source: "draft-defaults",
          chatId,
          agentConfig: draftDefaultConfig,
        });

        return draftDefaultConfig;
      });
      return;
    }

    lastAppliedDraftConfigRef.current = null;
    setAgentConfig(persistedAgentConfig);
    logChatDebug("agent-config-sync", {
      source: "persisted-chat",
      chatId,
      agentConfig: persistedAgentConfig,
    });
  }, [draftDefaultConfig, isDraft, persistedAgentConfig]);

  const initialMessages = useMemo<ChatUiMessage[]>(
    () => piHistoryToUiMessages(dbMessages),
    [dbMessages],
  );
  const persistedMessagesById = useMemo(
    () => new Map(dbMessages.map((message) => [message.id, message])),
    [dbMessages],
  );
  const [messages, setMessages] = useState<ChatUiMessage[]>(initialMessages);
  const streamingAssistantIdRef = useRef<string | null>(null);
  const streamingAssistantCountRef = useRef(0);

  /**
   * Translate a single SSE event from the server into UI message state.
   * Used by both fresh POST streams and reconnect-replay streams. The
   * `isReconnect` flag controls whether buffered user messages are
   * materialized (POST already added them optimistically; reconnect did not).
   */
  const handleStreamEvent = useCallback(
    (event: ChatStreamEvent, ctx: { isReconnect: boolean }) => {
      logChatDebug("stream-event", {
        chatId,
        eventType: event.type,
        isReconnect: ctx.isReconnect,
        event,
      });

      if (event.type === "tool_approval_request") {
        setMessages((current) =>
          applyToolApprovalRequestToMessages(current, event),
        );
        return;
      }

      if (event.type === "tool_approval_resolved") {
        setMessages((current) =>
          applyToolApprovalResolvedToMessages(current, event),
        );
        return;
      }

      if (
        event.type !== "message_start" &&
        event.type !== "message_update" &&
        event.type !== "message_end"
      ) {
        return;
      }

      const streamMessage = event.message as PiSdkMessage;

      if (streamMessage.role === "user") {
        // POST path adds the user bubble optimistically before the stream
        // starts, so buffered user events would be duplicates. On reconnect
        // there is no optimistic add, so we materialize them on message_end
        // and dedupe by text content against current state.
        if (!ctx.isReconnect || event.type !== "message_end") {
          return;
        }

        const replayedUi = piMessageToUiMessage(streamMessage, nanoid());
        if (!replayedUi) {
          return;
        }

        const replayedText = getMessageText(replayedUi);
        setMessages((current) => {
          const alreadyPresent = current.some(
            (m) => m.role === "user" && getMessageText(m) === replayedText,
          );
          if (alreadyPresent) {
            return current;
          }
          return [...current, replayedUi];
        });
        return;
      }

      if (streamMessage.role === "toolResult") {
        // Tool results never become their own bubble — fold them into the
        // matching tool call on the prior assistant message. Only act on
        // message_end so we don't thrash on partials.
        if (event.type !== "message_end") {
          return;
        }

        logChatDebug("tool-result-applied", {
          chatId,
          toolCallId: streamMessage.toolCallId,
          toolName: streamMessage.toolName,
          isError: streamMessage.isError,
        });

        setMessages((current) =>
          applyPiToolResultToMessages(current, streamMessage),
        );
        return;
      }

      if (event.type === "message_start") {
        streamingAssistantCountRef.current += 1;
        streamingAssistantIdRef.current = `${chatId ?? "draft"}-stream-${streamingAssistantCountRef.current}`;
      }

      const assistantMessageId =
        streamingAssistantIdRef.current ??
        `${chatId ?? "draft"}-stream-${streamingAssistantCountRef.current || 1}`;

      const assistantMessage = piMessageToUiMessage(
        streamMessage,
        assistantMessageId,
        { streaming: event.type !== "message_end" },
      );

      if (!assistantMessage) {
        return;
      }

      logChatDebug(
        event.type === "message_end"
          ? "assistant-message-produced"
          : "assistant-message-streaming",
        {
          chatId,
          eventType: event.type,
          assistantMessage: summarizeUiMessage(assistantMessage),
        },
      );

      setMessages((current) => {
        const existingIndex = current.findIndex(
          (message) => message.id === assistantMessageId,
        );

        if (existingIndex === -1) {
          return [...current, assistantMessage];
        }

        const next = [...current];
        next[existingIndex] = assistantMessage;
        return next;
      });

      if (event.type === "message_end") {
        streamingAssistantIdRef.current = null;
      }
    },
    [chatId],
  );

  // Destructure individual values: each callback inside the hook is wrapped
  // in `useCallback` with stable deps, so referencing them directly (instead
  // of `piStream.x`) gives the surrounding effects/callbacks stable
  // dependency identities and avoids re-running on every render.
  const {
    status,
    isActive: isStreamActive,
    startStream: hookStartStream,
    attachToExistingStream,
    stopEverywhere,
  } = usePiChatStream({
    chatId,
    serverUrl: env.VITE_SERVER_URL,
    getHeaders: getChatHeaders,
    onEvent: handleStreamEvent,
    onError: (err) => {
      streamingAssistantIdRef.current = null;
      streamingAssistantCountRef.current = 0;
      toast.error(err.message);
    },
    onStreamComplete: (id) => {
      streamingAssistantIdRef.current = null;
      streamingAssistantCountRef.current = 0;
      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(id),
      });
      // The user is currently viewing this chat (the stream is bound to
      // this view), so the run shouldn't show up as a green "unread"
      // dot in the sidebar. Ack it immediately.
      markChatRead.mutate(id);
    },
  });

  useEffect(() => {
    if (isStreamActive) {
      // While a stream is active (POST or reconnect), the stream is the
      // source of truth for the tail of the conversation. Re-running DB
      // hydration here would clobber the in-progress assistant bubble.
      return;
    }
    setMessages(initialMessages);
    logChatDebug("messages-hydrated-from-db", {
      chatId,
      dbMessageCount: dbMessages.length,
      initialMessages: initialMessages.map(summarizeUiMessage),
    });
  }, [initialMessages, isStreamActive]);

  useEffect(() => {
    logChatDebug("messages-state", {
      chatId,
      status,
      messageCount: messages.length,
      messages: messages.map(summarizeUiMessage),
    });
  }, [chatId, messages, status]);

  const stop = useCallback(() => {
    streamingAssistantIdRef.current = null;
    streamingAssistantCountRef.current = 0;
    logChatDebug("stream-stop", { chatId });
    void stopEverywhere();
  }, [chatId, stopEverywhere]);

  /**
   * Start a fresh POST stream, optimistically appending the user message.
   * Mirrors the old `streamResponse` callback but delegates the network /
   * SSE lifecycle to `usePiChatStream`.
   */
  const startStream = useCallback(
    async (userMessage: ChatUiMessage) => {
      streamingAssistantIdRef.current = null;
      streamingAssistantCountRef.current = 0;

      setMessages((current) =>
        current.some((message) => message.id === userMessage.id)
          ? current
          : [...current, userMessage],
      );

      await hookStartStream(userMessage);
    },
    [hookStartStream],
  );

  // Whenever a chat is mounted (or the URL switches to a new chat id),
  // tell the server to clear any "finished-unread" dot for that chat.
  // Visiting a chat counts as acknowledging it. We only need this once per
  // chat-id mount; the `onStreamComplete` callback handles "ack on
  // completion while already viewing".
  useEffect(() => {
    if (!chatId) return;
    markChatRead.mutate(chatId);
    // markChatRead is a mutation hook, omitted from deps to keep this
    // firing exactly once per chat-id change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Pending submission: if we navigated here from a draft submit, kick off
  // the POST. Runs before the reconnect probe via effect ordering.
  useEffect(() => {
    if (!chatId) {
      return;
    }

    const pendingSubmission = consumePendingChatSubmission(chatId);
    if (!pendingSubmission) {
      return;
    }

    logChatDebug("pending-submission-found", {
      chatId,
      pendingSubmission,
    });

    void startStream({
      id: pendingSubmission.messageId,
      role: "user",
      parts: pendingSubmission.parts,
      createdAt: new Date().toISOString(),
    });
  }, [chatId, startStream]);

  // Reconnect probe: on mount (or chatId change), check whether the server
  // still has an active run for this chat and reattach to its buffered
  // event stream. The probe early-returns inside the hook if a POST has
  // already started in the same render cycle, so this is race-safe.
  useEffect(() => {
    if (!chatId) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const attached = await attachToExistingStream();
        if (cancelled) {
          return;
        }
        logChatDebug("reconnect-probe", { chatId, attached });
      } catch (err) {
        logChatDebug("reconnect-probe-error", { chatId, error: err });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId, attachToExistingStream]);

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const userMsgId = nanoid();
      const parts: UIMessage["parts"] = [];

      if (message.text) {
        parts.push({ type: "text" as const, text: message.text });
      }
      for (const file of message.files) {
        parts.push(file);
      }

      const userMsg = {
        id: userMsgId,
        role: "user" as const,
        parts,
        createdAt: new Date().toISOString(),
      };

      logChatDebug("submit", {
        chatId,
        isDraft,
        agentConfig,
        message: summarizeUiMessage(userMsg),
      });

      if (isDraft) {
        const nextChat = await createChat.mutateAsync({
          projectId,
          agentConfig,
        });

        setPendingChatSubmission(nextChat.id, {
          messageId: userMsgId,
          parts,
        });

        logChatDebug("draft-chat-created", {
          nextChatId: nextChat.id,
          pendingMessageId: userMsgId,
        });

        navigate({
          to: "/projects/$projectId/chat/$chatId",
          params: { projectId, chatId: nextChat.id },
        });
        return;
      }

      if (!chatId) {
        return;
      }
      await startStream(userMsg);
    },
    [agentConfig, chatId, createChat, isDraft, navigate, projectId, startStream],
  );

  /** Edit a user message, persist the new branch, then resubmit from that point. */
  const handleEdit = useCallback(
    async (index: number, newText: string) => {
      if (!chatId) {
        return;
      }

      const messageToEdit = messages[index];
      if (!messageToEdit || messageToEdit.role !== "user") {
        return;
      }

      let didReplaceText = false;
      const nextParts: ChatUiMessage["parts"] = [];

      for (const part of messageToEdit.parts) {
        if (part.type !== "text") {
          nextParts.push(part);
          continue;
        }

        if (didReplaceText) {
          continue;
        }

        didReplaceText = true;
        nextParts.push({ type: "text" as const, text: newText });
      }

      if (!didReplaceText) {
        nextParts.unshift({ type: "text" as const, text: newText });
      }

      const nextMessages = messages
        .slice(0, index + 1)
        .map((message, messageIndex) =>
          messageIndex === index
            ? {
                ...message,
                parts: nextParts,
              }
            : message,
        );

      const persistedMessage = persistedMessagesById.get(messageToEdit.id);
      if (!persistedMessage) {
        toast.error("Chat history is still syncing. Try again.");
        return;
      }

      try {
        await replaceMessages.mutateAsync({
          chatId,
          messages: nextMessages.map((message) => {
            if (message.id === messageToEdit.id) {
              return serializeHistoryMessage(
                updatePersistedUserMessageText(persistedMessage, newText),
              );
            }

            const persisted = persistedMessagesById.get(message.id);
            if (!persisted) {
              throw new Error(`Missing persisted message ${message.id}`);
            }

            return serializeHistoryMessage(persisted);
          }),
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not update chat history",
        );
        return;
      }

      logChatDebug("message-edited", {
        chatId,
        editedMessageId: messageToEdit.id,
        nextMessages: nextMessages.map(summarizeUiMessage),
      });

      setMessages(nextMessages);
      await startStream({
        ...messageToEdit,
        parts: nextParts,
      });
    },
    [chatId, messages, persistedMessagesById, replaceMessages, startStream],
  );

  /** Regenerate any assistant message by its id */
  const handleRegenerate = useCallback(
    async (messageId: string) => {
      if (!chatId) {
        return;
      }

      const messageIndex = messages.findIndex((message) => message.id === messageId);
      if (messageIndex === -1) {
        return;
      }

      try {
        await replaceMessages.mutateAsync({
          chatId,
          messages: messages.slice(0, messageIndex).map((message) => {
            const persisted = persistedMessagesById.get(message.id);
            if (!persisted) {
              throw new Error(`Missing persisted message ${message.id}`);
            }

            return serializeHistoryMessage(persisted);
          }),
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not update chat history",
        );
        return;
      }

      logChatDebug("message-regenerated", {
        chatId,
        messageId,
        retainedMessageCount: messageIndex,
      });

      const nextMessages = messages.slice(0, messageIndex);
      const triggerMessage = [...nextMessages]
        .reverse()
        .find((message) => message.role === "user");
      if (!triggerMessage) {
        return;
      }

      setMessages(nextMessages);
      await startStream(triggerMessage);
    },
    [chatId, messages, persistedMessagesById, replaceMessages, startStream],
  );

  /** Fork into a new chat seeded with the conversation through this message */
  const handleFork = useCallback(
    async (index: number) => {
      if (!chatId) {
        return;
      }

      let nextChat;
      try {
        nextChat = await forkChat.mutateAsync({
          chatId,
          messages: messages.slice(0, index + 1).map((message) => {
            const persisted = persistedMessagesById.get(message.id);
            if (!persisted) {
              throw new Error(`Missing persisted message ${message.id}`);
            }

            return serializeHistoryMessage(persisted);
          }),
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not fork chat",
        );
        return;
      }

      logChatDebug("chat-forked", {
        sourceChatId: chatId,
        nextChatId: nextChat.id,
        retainedMessageCount: index + 1,
      });

      navigate({
        to: "/projects/$projectId/chat/$chatId",
        params: { projectId, chatId: nextChat.id },
      });
    },
    [chatId, forkChat, messages, navigate, persistedMessagesById, projectId],
  );

  const handleModelChange = useCallback(
    async (nextValue: string) => {
      const nextModel = allModels.find((model) => getModelValue(model) === nextValue);
      if (!nextModel) {
        return;
      }

      const nextAgentConfig = {
        ...agentConfig,
        provider: nextModel.provider,
        modelId: nextModel.id,
      };
      const previousAgentConfig = agentConfig;
      setAgentConfig(nextAgentConfig);
      logChatDebug("model-change", {
        chatId,
        previousAgentConfig,
        nextAgentConfig,
        isDraft,
      });

      try {
        if (isDraft) {
          return;
        }

        if (!chatId) {
          return;
        }

        await updateChatAgentConfig.mutateAsync({
          chatId,
          agentConfig: nextAgentConfig,
        });
      } catch (error) {
        setAgentConfig(previousAgentConfig);
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not save chat model",
        );
      }
    },
    [agentConfig, allModels, chatId, isDraft, updateChatAgentConfig],
  );

  /**
   * Apply a permission-mode preset (`plan`/`default`/`auto`/`bypass`) to the
   * current chat. Mirrors `handleThinkingLevelChange`: drafts store the
   * override as the new user default so it "sticks" for the next new chat,
   * persisted chats update only their own row.
   */
  const handlePermissionModeChange = useCallback(
    async (presetId: PermissionModePresetId) => {
      const nextAgentConfig = applyPermissionModePreset(agentConfig, presetId);
      const previousAgentConfig = agentConfig;

      setAgentConfig(nextAgentConfig);
      logChatDebug("permission-mode-change", {
        chatId,
        previousAgentConfig,
        nextAgentConfig,
        isDraft,
      });

      try {
        if (isDraft) {
          await updatePiDefaults.mutateAsync({
            chat: applyPermissionModePreset(draftDefaultConfig, presetId),
            worker: applyPermissionModePreset(
              draftWorkerDefaultConfig,
              presetId,
            ),
          });
          return;
        }

        if (!chatId) {
          return;
        }

        await updateChatAgentConfig.mutateAsync({
          chatId,
          agentConfig: nextAgentConfig,
        });
      } catch (error) {
        setAgentConfig(previousAgentConfig);
        toast.error(
          error instanceof Error
            ? error.message
            : isDraft
              ? "Could not save default permission mode"
              : "Could not save chat permission mode",
        );
      }
    },
    [
      agentConfig,
      chatId,
      draftDefaultConfig,
      draftWorkerDefaultConfig,
      isDraft,
      updateChatAgentConfig,
      updatePiDefaults,
    ],
  );

  const handleThinkingLevelChange = useCallback(
    async (thinkingLevel: PiAgentConfig["thinkingLevel"]) => {
      const nextAgentConfig = {
        ...agentConfig,
        thinkingLevel,
      };
      const previousAgentConfig = agentConfig;

      setAgentConfig(nextAgentConfig);
      logChatDebug("thinking-level-change", {
        chatId,
        previousAgentConfig,
        nextAgentConfig,
        isDraft,
      });

      try {
        if (isDraft) {
          await updatePiDefaults.mutateAsync({
            chat: {
              ...draftDefaultConfig,
              thinkingLevel,
            },
            worker: {
              ...draftWorkerDefaultConfig,
              thinkingLevel,
            },
          });
          return;
        }

        if (!chatId) {
          return;
        }

        await updateChatAgentConfig.mutateAsync({
          chatId,
          agentConfig: nextAgentConfig,
        });
      } catch (error) {
        setAgentConfig(previousAgentConfig);
        toast.error(
          error instanceof Error
            ? error.message
            : isDraft
              ? "Could not save default reasoning effort"
              : "Could not save chat reasoning effort",
        );
      }
    },
    [
      agentConfig,
      chatId,
      draftDefaultConfig,
      draftWorkerDefaultConfig,
      isDraft,
      updateChatAgentConfig,
      updatePiDefaults,
    ],
  );

  const isStreaming = status === "streaming" || status === "submitted";

  /**
   * Send an approve / deny decision for a pending tool call. The optimistic
   * local update happens immediately so the UI doesn't wait on the
   * round-trip; the server will also publish a `tool_approval_resolved`
   * stream event which applies the same transition idempotently.
   */
  const handleResolveApproval = useCallback(
    async (toolCallId: string, approved: boolean, reason?: string) => {
      if (!chatId) {
        return;
      }

      setMessages((current) =>
        applyToolApprovalResolvedToMessages(current, {
          type: "tool_approval_resolved",
          toolCallId,
          toolName: "",
          approved,
          reason,
        }),
      );

      try {
        await trpcClient.chat.resolveToolApproval.mutate({
          chatId,
          toolCallId,
          approved,
          reason,
        });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not send approval decision",
        );
      }
    },
    [chatId],
  );

  /**
   * Multi-turn agent responses produce one PiSdkMessage per turn (thinking +
   * tool calls, then thinking + more tool calls, then the final text). Render
   * them as a single continuous bubble so users see one assistant response,
   * not five fragmented ones. We still keep the underlying `messages` array
   * intact so action handlers (regenerate/fork/edit) can map back to the real
   * persisted messages by index.
   */
  const displayMessages = useMemo(() => {
    type DisplayMessage = {
      message: ChatUiMessage;
      firstIndex: number;
      lastIndex: number;
    };

    const result: DisplayMessage[] = [];
    let i = 0;

    while (i < messages.length) {
      const msg = messages[i]!;

      if (msg.role !== "assistant") {
        result.push({ message: msg, firstIndex: i, lastIndex: i });
        i++;
        continue;
      }

      const firstIndex = i;
      let lastIndex = i;
      const mergedParts: UIMessagePart[] = [...msg.parts];
      i++;

      while (i < messages.length && messages[i]!.role === "assistant") {
        mergedParts.push({ type: "step-start" });
        mergedParts.push(...messages[i]!.parts);
        lastIndex = i;
        i++;
      }

      result.push({
        message:
          firstIndex === lastIndex
            ? msg
            : {
                id: msg.id,
                role: "assistant",
                parts: mergedParts,
                createdAt: msg.createdAt,
              },
        firstIndex,
        lastIndex,
      });
    }

    return result;
  }, [messages]);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      {/* Ambient glow: pinned to bottom of chat pane so blur is not clipped by Conversation overflow */}
      {messages.length === 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[min(55vh,480px)]"
        >
          <div className="absolute bottom-0 left-1/2 h-[320px] w-[min(100%,520px)] max-w-[520px] -translate-x-1/2 translate-y-[20%] rounded-full bg-foreground/[0.03] blur-[100px]" />
        </div>
      )}

      <Conversation className="relative z-10 flex-1">
        <ConversationContent className="mx-auto w-full max-w-2xl px-4 py-6">
          {messages.length === 0 && (
            <div className="relative flex h-full w-full flex-col items-start justify-center py-16">
              {/* Heading */}
              <h1
                className="relative mb-8 text-left text-4xl font-semibold tracking-tight text-foreground/90 animate-in fade-in slide-in-from-bottom-3 duration-500"
                style={{ animationFillMode: "both" }}
              >
                How can I help you?
              </h1>

              <Tabs defaultValue="create" className="relative w-full">
                <TabsList className="relative mb-10 inline-flex h-auto min-h-0 w-full max-w-full flex-wrap items-start justify-start gap-2.5 rounded-none bg-transparent p-0 text-muted-foreground shadow-none">
                  {(
                    [
                      { id: "create" as const, icon: PenLineIcon, label: "Create" },
                      { id: "explore" as const, icon: CompassIcon, label: "Explore" },
                      { id: "code" as const, icon: CodeIcon, label: "Code" },
                      { id: "learn" as const, icon: GraduationCapIcon, label: "Learn" },
                    ] as const
                  ).map((cat, i) => (
                    <TabsTrigger
                      key={cat.id}
                      value={cat.id}
                      className="group relative inline-flex h-auto shrink-0 flex-none items-center gap-2 rounded-full border border-border/30 bg-card/40 px-4 py-2 text-[13px] font-medium text-muted-foreground shadow-none backdrop-blur-sm transition-all duration-300 after:hidden hover:border-border/60 hover:bg-card/70 hover:text-foreground hover:shadow-md data-active:border-border/60 data-active:bg-card/70 data-active:text-foreground data-active:shadow-md dark:data-active:bg-card/70"
                      style={{ animationDelay: `${100 + i * 60}ms`, animationFillMode: "both" }}
                    >
                      <cat.icon className="size-3.5 transition-transform duration-300 group-hover:scale-110" />
                      {cat.label}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {STARTER_TAB_IDS.map((tabId) => (
                  <TabsContent key={tabId} value={tabId} className="mt-0 w-full max-w-md">
                    <div className="flex flex-col">
                      {STARTER_PROMPTS[tabId].map((suggestion, i) => (
                        <button
                          key={suggestion}
                          type="button"
                          className="group flex w-full items-center justify-between rounded-lg px-3 py-3.5 text-left text-[13.5px] text-muted-foreground/80 transition-all duration-200 hover:bg-muted/20 hover:text-foreground animate-in fade-in slide-in-from-bottom-1 duration-300"
                          style={{ animationDelay: `${340 + i * 60}ms`, animationFillMode: "both" }}
                          onClick={() => void handleSubmit({ text: suggestion, files: [] })}
                        >
                          <span>{suggestion}</span>
                          <ArrowRightIcon className="size-3.5 -translate-x-2 text-muted-foreground/40 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-foreground/60 group-hover:opacity-100" />
                        </button>
                      ))}
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          )}

          {displayMessages.map(({ message: msg, firstIndex, lastIndex }) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              isStreaming={isStreaming && lastIndex === messages.length - 1}
              status={status}
              onReload={
                msg.role === "assistant"
                  ? () => {
                      void handleRegenerate(msg.id);
                    }
                  : undefined
              }
              onEdit={
                msg.role === "user"
                  ? (newText: string) => {
                      void handleEdit(firstIndex, newText);
                    }
                  : undefined
              }
              onFork={() => {
                void handleFork(lastIndex);
              }}
              onResolveApproval={handleResolveApproval}
            />
          ))}
        </ConversationContent>

        <ConversationScrollButton />
      </Conversation>

      <div className="bg-background/80 backdrop-blur-md">
        <div className="mx-auto w-full max-w-2xl px-4 py-3">
          <PromptInputProvider>
            <ChatPromptInputArea
              chatId={chatId}
              projectId={projectId}
              onSubmit={handleSubmit}
              status={status}
              onStop={stop}
              agentConfig={agentConfig}
              allModels={allModels}
              onThinkingLevelChange={handleThinkingLevelChange}
              onModelChange={handleModelChange}
              onPermissionModeChange={handlePermissionModeChange}
              builtinHandlers={{
                onFork: () => {
                  if (messages.length > 0) {
                    void handleFork(messages.length - 1);
                  }
                },
                onRegenerate: () => {
                  const lastAssistant = [...messages]
                    .reverse()
                    .find((m) => m.role === "assistant");
                  if (lastAssistant) {
                    void handleRegenerate(lastAssistant.id);
                  }
                },
                onHelp: () => {
                  toast.info(
                    "Slash commands: /clear /help /fork /regenerate · plus your skills",
                  );
                },
              }}
            />
          </PromptInputProvider>
        </div>
      </div>
    </div>
  );
}

type ChatPromptModel = {
  id: string;
  name: string;
  provider: string;
};

interface ChatPromptInputAreaProps {
  chatId: string | null;
  projectId: string;
  onSubmit: (message: PromptInputMessage) => Promise<void> | void;
  status: ChatStatus;
  onStop: () => void;
  agentConfig: PiAgentConfig;
  allModels: readonly ChatPromptModel[];
  onThinkingLevelChange: (
    level: PiAgentConfig["thinkingLevel"],
  ) => Promise<void> | void;
  onModelChange: (value: string) => Promise<void> | void;
  onPermissionModeChange: (
    presetId: PermissionModePresetId,
  ) => Promise<void> | void;
  builtinHandlers: BuiltinHandlers;
}

function ChatPromptInputArea({
  chatId,
  projectId,
  onSubmit,
  status,
  onStop,
  agentConfig,
  allModels,
  onThinkingLevelChange,
  onModelChange,
  onPermissionModeChange,
  builtinHandlers,
}: ChatPromptInputAreaProps) {
  // `agentConfig` stores the three permission fields individually, so pick
  // the preset that matches them (or fall back to "default" as the display
  // value — the UI label becomes "Custom" below).
  const activePresetId = getPermissionModePresetId(agentConfig);
  const controller = usePromptInputController();
  const popoverRef = useRef<SlashCommandPopoverHandle>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const handleTextareaKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      popoverRef.current?.handleKeyDown(event);
    },
    [],
  );

  return (
    <div ref={anchorRef} className="relative">
      <SlashCommandPopover
        ref={popoverRef}
        value={controller.textInput.value}
        setValue={controller.textInput.setInput}
        clearValue={controller.textInput.clear}
        projectId={projectId}
        chatId={chatId}
        handlers={builtinHandlers}
        anchorRef={anchorRef}
      />
      <PromptInput onSubmit={onSubmit}>
        <AttachmentPreviews />
        <PromptInputTextarea
          placeholder="Message..."
          onKeyDown={handleTextareaKeyDown}
        />
        <PromptInputFooter>
          <PromptInputTools>
            <AttachFilesButton />

            <PromptInputSelect
              value={getModelValue({
                provider: agentConfig.provider,
                id: agentConfig.modelId,
              })}
              onValueChange={(value) => {
                void onModelChange(value as string);
              }}
            >
              <PromptInputSelectTrigger className="h-7 w-auto gap-1.5 rounded-md px-2 text-xs">
                <PromptInputSelectValue />
              </PromptInputSelectTrigger>
              <PromptInputSelectContent>
                {allModels.map((model) => (
                  <PromptInputSelectItem
                    key={getModelValue(model)}
                    value={getModelValue(model)}
                  >
                    {model.name}
                  </PromptInputSelectItem>
                ))}
              </PromptInputSelectContent>
            </PromptInputSelect>

            <PromptInputSelect
              value={agentConfig.thinkingLevel}
              onValueChange={(value) => {
                void onThinkingLevelChange(
                  value as PiAgentConfig["thinkingLevel"],
                );
              }}
            >
              <PromptInputSelectTrigger
                aria-label="Reasoning effort"
                className="h-7 w-auto gap-1.5 rounded-md px-2 text-xs"
              >
                <PromptInputSelectValue />
              </PromptInputSelectTrigger>
              <PromptInputSelectContent>
                {THINKING_LEVEL_OPTIONS.map((option) => (
                  <PromptInputSelectItem
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </PromptInputSelectItem>
                ))}
              </PromptInputSelectContent>
            </PromptInputSelect>

            <PromptInputSelect
              // When the stored config doesn't match any preset, drop the
              // select back to an empty value so the trigger renders
              // "Custom" via the placeholder below.
              value={activePresetId ?? ""}
              onValueChange={(value) => {
                if (!value) return;
                void onPermissionModeChange(value as PermissionModePresetId);
              }}
            >
              <PromptInputSelectTrigger
                aria-label="Permission mode"
                className="h-7 w-auto gap-1.5 rounded-md px-2 text-xs"
              >
                <PromptInputSelectValue placeholder="Custom" />
              </PromptInputSelectTrigger>
              <PromptInputSelectContent>
                {PERMISSION_MODE_PRESET_ORDER.map((id) => {
                  const preset = PERMISSION_MODE_PRESETS[id];
                  return (
                    <PromptInputSelectItem key={preset.id} value={preset.id}>
                      {preset.label}
                    </PromptInputSelectItem>
                  );
                })}
              </PromptInputSelectContent>
            </PromptInputSelect>
          </PromptInputTools>

          <PromptInputSubmit status={status} onStop={onStop} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
