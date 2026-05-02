import { Skeleton } from "@g-spot/ui/components/skeleton";
import { env } from "@g-spot/env/web";
import type {
  PiAgentConfig,
  PiChatHistoryMessage,
} from "@g-spot/types";
import {
  PaperclipIcon,
  XIcon,
  ArrowRightIcon,
  MessageSquareTextIcon,
  MicIcon,
} from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
import { ChatBranchSelect } from "@/components/chat/chat-branch-select";
import { ChatProjectSelect } from "@/components/chat/chat-project-select";
import { PiModelPicker } from "@/components/pi/pi-model-picker";
import {
  useChatDetail,
  useChatMessages,
  useCreateChatMutation,
  useForkChatMutation,
  useReplaceChatMessagesMutation,
  useUpdateChatAgentConfigMutation,
} from "@/hooks/use-chat-data";
import {
  usePiCatalog,
  usePiDefaults,
} from "@/hooks/use-pi";
import type { BuiltinHandlers } from "@/lib/slash-commands";
import { stackClientApp } from "@/stack/client";
import {
  useProject,
  useUpdateProjectAgentConfigMutation,
} from "@/hooks/use-projects";

import { ChatMessageList } from "./chat-message-list";
import { StreamingMessage } from "./streaming-message";
import { ChatPendingApprovals } from "./chat-pending-approvals";
import { ChatQueuedMessages } from "./chat-queued-messages";
import {
  drainFollowUpQueue,
  enqueueChatMessage,
  type QueuedPart,
} from "@/lib/chat-queue";
import {
  clearStreamingMessage,
  setStreamingMessage,
} from "@/lib/streaming-message-store";
import { perfCount } from "@/lib/chat-perf-log";
import { splitActiveChatMessages } from "@/lib/chat-render-model";

const STARTER_PROMPTS = [
  "Brainstorm ideas for a weekend project I could ship in a day",
  "Compare two common approaches and when each makes sense",
  "Help me refactor this function for readability and fewer edge cases",
  "Give me a short study plan to go from zero to comfortable",
] as const;
import {
  type ChatStatus,
  type ChatStreamEvent,
  type UIMessage,
  type UIMessagePart,
} from "@/lib/chat-ui";
import {
  reduceChatHistory,
  reduceChatStreamEvent,
} from "@/lib/chat-reducer";
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
import { useChatRuntimeStatus } from "@/lib/chat-runtime-statuses";
import { trpc } from "@/utils/trpc";

/** Attach files button — must be a child of PromptInput to access attachments context */
function AttachFilesButton() {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton size="icon-xs" onClick={() => attachments.openFileDialog()}>
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
  focusMessageId?: string;
  searchText?: string;
}

type ChatUiMessage = UIMessage;

function getLastAssistantTurnStartIndex(messages: ChatUiMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "assistant") {
      continue;
    }

    let startIndex = index;
    while (startIndex > 0 && messages[startIndex - 1]?.role === "assistant") {
      startIndex -= 1;
    }
    return startIndex;
  }

  return -1;
}

function stripHistoryMessage(message: PiChatHistoryMessage): Omit<
  PiChatHistoryMessage,
  "id" | "createdAt"
> {
  const { id: _id, createdAt: _createdAt, ...persistedMessage } = message;
  return persistedMessage;
}

function serializeHistoryMessage(message: PiChatHistoryMessage) {
  return {
    id: message.id,
    message: JSON.stringify(stripHistoryMessage(message)),
  };
}

async function getChatHeaders(): Promise<Record<string, string>> {
  const user = await stackClientApp.getUser();
  if (!user) {
    return { "content-type": "application/json" };
  }

  const authHeaders = await user.getAuthHeaders();
  return {
    "content-type": "application/json",
    ...authHeaders,
  };
}

/**
 * Outer wrapper: fetches DB messages, shows loading skeleton,
 * then mounts ChatViewInner only once data is ready.
 * This ensures useChat initializes with the actual messages.
 */
export function ChatView({ chatId, projectId, focusMessageId, searchText }: ChatViewProps) {
  const { data: chat, isLoading: isLoadingChat } = useChatDetail(chatId ?? "");
  const { data: dbMessages, isLoading: isLoadingMessages } = useChatMessages(chatId ?? "");
  const projectQuery = useProject(projectId);
  const projectName = projectQuery.data?.name ?? "g-spot";

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
      projectName={projectName}
      projectAgentConfig={projectQuery.data?.agentConfig ?? null}
      chatAgentConfig={chat?.agentConfig ?? null}
      dbMessages={dbMessages ?? []}
      focusMessageId={focusMessageId}
      searchText={searchText}
    />
  );
}

interface ChatViewInnerProps {
  chatId: string | null;
  projectId: string;
  projectName: string;
  projectAgentConfig: PiAgentConfig | null;
  chatAgentConfig: PiAgentConfig | null;
  dbMessages: PiChatHistoryMessage[];
  focusMessageId?: string;
  searchText?: string;
}

function ChatViewInner({
  chatId,
  projectId,
  projectName,
  projectAgentConfig,
  chatAgentConfig,
  dbMessages,
  focusMessageId,
  searchText,
}: ChatViewInnerProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const piCatalog = usePiCatalog();
  const piDefaults = usePiDefaults();
  const createChat = useCreateChatMutation();
  const updateChatAgentConfig = useUpdateChatAgentConfigMutation();
  const updateProjectAgentConfig = useUpdateProjectAgentConfigMutation();
  const replaceMessages = useReplaceChatMessagesMutation();
  const forkChat = useForkChatMutation();
  const isDraft = chatId === null;
  const handleNewChat = useCallback(() => {
    void navigate({
      to: "/projects/$projectId",
      params: { projectId },
    });
  }, [navigate, projectId]);
  const allModels = piCatalog.data?.models ?? [];
  const configuredProviders = useMemo(
    () =>
      new Set(
        (piCatalog.data?.configuredProviders ?? []).map((provider) => provider.provider),
      ),
    [piCatalog.data?.configuredProviders],
  );
  const oauthProviders = useMemo(
    () => new Set((piCatalog.data?.oauthProviders ?? []).map((provider) => provider.id)),
    [piCatalog.data?.oauthProviders],
  );
  const draftProjectConfig = useMemo(
    () =>
      normalizeAgentConfig(
        projectAgentConfig ?? piDefaults.data?.chat ?? FALLBACK_PI_AGENT_CONFIG,
        allModels,
      ),
    [allModels, piDefaults.data?.chat, projectAgentConfig],
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
    isDraft ? draftProjectConfig : persistedAgentConfig,
  );
  const lastAppliedDraftConfigRef = useRef<PiAgentConfig | null>(null);

  useEffect(() => {
    if (isDraft) {
      setAgentConfig((current) => {
        const shouldSync =
          lastAppliedDraftConfigRef.current === null ||
          areAgentConfigsEqual(current, lastAppliedDraftConfigRef.current);

        lastAppliedDraftConfigRef.current = draftProjectConfig;

        if (!shouldSync) {
          return current;
        }

        logChatDebug("agent-config-sync", {
          source: "draft-project",
          chatId,
          agentConfig: draftProjectConfig,
        });

        return draftProjectConfig;
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
  }, [draftProjectConfig, isDraft, persistedAgentConfig]);

  const persistDraftProjectAgentConfig = useCallback(
    async (nextAgentConfig: PiAgentConfig) => {
      await updateProjectAgentConfig.mutateAsync({
        id: projectId,
        agentConfig: nextAgentConfig,
      });
      lastAppliedDraftConfigRef.current = nextAgentConfig;
    },
    [projectId, updateProjectAgentConfig],
  );

  const initialMessages = useMemo<ChatUiMessage[]>(
    () => reduceChatHistory(dbMessages),
    [dbMessages],
  );
  const persistedMessagesById = useMemo(
    () => new Map(dbMessages.map((message) => [message.id, message])),
    [dbMessages],
  );
  const [messages, setMessages] = useState<ChatUiMessage[]>(initialMessages);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  /**
   * Buffer of the in-flight assistant message's raw parts during a turn.
   * Accumulated across `message_start` → `message_update` and flushed into
   * `messages` on `message_end`. The per-frame view is published to
   * <StreamingMessage /> via the streaming-message store, so token updates
   * don't re-render <ChatMessageList />.
   */
  const streamingBufferRef = useRef<ChatUiMessage | null>(null);

  useEffect(() => {
    streamingBufferRef.current = null;
    if (!chatId) return;

    clearStreamingMessage(chatId);
    return () => clearStreamingMessage(chatId);
  }, [chatId]);

  /**
   * Translate a single streamed chat event from the server into UI message
   * state. Used by both fresh socket starts and reconnect replays.
   */
  const handleStreamEvent = useCallback(
    (event: ChatStreamEvent, ctx: { chatId: string; isReconnect: boolean }) => {
      if (ctx.chatId !== chatId) {
        logChatDebug("stream-event-stale-chat", {
          currentChatId: chatId,
          eventChatId: ctx.chatId,
          eventType: event.type,
        });
        return;
      }

      perfCount("stream-event." + event.type);
      logChatDebug("stream-event", {
        chatId,
        eventType: event.type,
        isReconnect: ctx.isReconnect,
        event,
      });

      const streamingId =
        streamingBufferRef.current?.id ??
        `${chatId ?? "draft"}-stream-${Date.now()}`;

      const reduction = reduceChatStreamEvent({
        messages: messagesRef.current,
        streamingMessage: streamingBufferRef.current,
        event,
        streamingId,
        isReconnect: ctx.isReconnect,
      });

      if (!reduction.messagesChanged && !reduction.streamingChanged) {
        return;
      }

      if (reduction.messagesChanged) {
        const commit = () => {
          messagesRef.current = reduction.messages;
          setMessages(reduction.messages);
        };
        if (event.type === "message_end") {
          flushSync(commit);
        } else {
          commit();
        }
      }

      if (reduction.streamingChanged) {
        streamingBufferRef.current = reduction.streamingMessage;
        if (chatId) {
          if (reduction.streamingMessage) {
            setStreamingMessage(chatId, reduction.streamingMessage);
          } else {
            clearStreamingMessage(chatId);
          }
        }
      }

      if (reduction.streamingMessage) {
        logChatDebug("assistant-message-streaming", {
          chatId,
          eventType: event.type,
          assistantMessage: summarizeUiMessage(reduction.streamingMessage),
        });
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
      streamingBufferRef.current = null;
      if (chatId) clearStreamingMessage(chatId);
      toast.error(err.message);
    },
    onStreamComplete: (id) => {
      if (id === chatId) {
        streamingBufferRef.current = null;
      }
      clearStreamingMessage(id);
      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(id),
      });
      void queryClient.invalidateQueries({
        queryKey: chatKeys.detail(id),
      });
      void queryClient.invalidateQueries({
        queryKey: chatKeys.list(),
      });
      void queryClient.invalidateQueries({
        queryKey: trpc.git.listWorkspaces.queryKey({ projectId }),
      });

      for (const delayMs of [1000, 3000, 6000]) {
        window.setTimeout(() => {
          void queryClient.invalidateQueries({
            queryKey: chatKeys.detail(id),
          });
          void queryClient.invalidateQueries({
            queryKey: chatKeys.list(),
          });
        }, delayMs);
      }
    },
  });
  const runtimeStatus = useChatRuntimeStatus(chatId);
  const isActiveTurn =
    isStreamActive ||
    runtimeStatus === "running" ||
    runtimeStatus === "pending-approval";
  const { finalMessages, streamingMessages } = useMemo(
    () => splitActiveChatMessages(messages, isActiveTurn),
    [messages, isActiveTurn],
  );
  const isStreamActiveRef = useRef(isStreamActive);
  isStreamActiveRef.current = isStreamActive;
  const pendingSubmissionStartedChatIdRef = useRef<string | null>(null);

  const invalidateGitBranches = useCallback(() => {
    if (!projectId) return;
    void queryClient.invalidateQueries({
      queryKey: trpc.git.listWorkspaces.queryKey({ projectId }),
    });
  }, [projectId, queryClient]);

  useEffect(() => {
    // Hydrate only when a fresh DB fetch actually landed (`initialMessages`
    // identity changed). Depending on `isStreamActive` too would re-run on
    // every start/stop flip and clobber optimistic/in-flight state — e.g.
    // the user's own message on stop, before it has been persisted.
    if (isStreamActiveRef.current) {
      return;
    }
    setMessages(initialMessages);
    logChatDebug("messages-hydrated-from-db", {
      chatId,
      dbMessageCount: dbMessages.length,
      initialMessages: initialMessages.map(summarizeUiMessage),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessages]);

  useEffect(() => {
    if (!focusMessageId) return;
    const element = document.querySelector(`[data-chat-message-id="${CSS.escape(focusMessageId)}"]`);
    if (!(element instanceof HTMLElement)) return;
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    element.classList.add("ring-1", "ring-primary/60", "rounded-xl");
    const id = window.setTimeout(() => {
      element.classList.remove("ring-1", "ring-primary/60", "rounded-xl");
    }, 1800);
    return () => window.clearTimeout(id);
  }, [focusMessageId, messages, searchText]);

  useEffect(() => {
    logChatDebug("messages-state", {
      chatId,
      status,
      messageCount: messages.length,
      messages: messages.map(summarizeUiMessage),
    });
  }, [chatId, messages, status]);

  const stop = useCallback(() => {
    streamingBufferRef.current = null;
    if (chatId) clearStreamingMessage(chatId);
    logChatDebug("stream-stop", { chatId });
    void stopEverywhere();

    // `stopEverywhere` doesn't fire `onStreamComplete`, so invalidate the
    // chat queries here. Any assistant turns committed mid-run hold
    // synthetic `-stream-` ids; refetching pulls the real persisted ids so
    // follow-up actions (regenerate / edit / fork) can map messages back
    // to DB rows.
    if (chatId) {
      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(chatId),
      });
      void queryClient.invalidateQueries({
        queryKey: chatKeys.detail(chatId),
      });
    }
  }, [chatId, queryClient, stopEverywhere]);

  /**
   * Start a fresh chat run, optimistically appending the user message.
   */
  const startStream = useCallback(
    async (userMessage: ChatUiMessage) => {
      streamingBufferRef.current = null;
      if (chatId) clearStreamingMessage(chatId);

      setMessages((current) =>
        current.some((message) => message.id === userMessage.id)
          ? current
          : [...current, userMessage],
      );

      await hookStartStream(userMessage);
    },
    [chatId, hookStartStream],
  );

  /**
   * Drain the follow-up queue once the stream goes idle. Fires whenever the
   * status transitions back to "ready" (end-of-turn, error, user-initiated
   * stop). Mode `"all"` concatenates every queued message into one prompt;
   * `"one-at-a-time"` fires them sequentially via subsequent status
   * transitions.
   */
  useEffect(() => {
    if (!chatId) return;
    if (status !== "ready") return;

    const drained = drainFollowUpQueue(chatId, agentConfig.followUpMode);
    if (drained.length === 0) return;

    const parts: UIMessagePart[] = [];
    for (const item of drained) {
      for (const part of item.parts) {
        parts.push(part);
      }
      // Separate concatenated queued messages with a blank line so the
      // model sees them as distinct instructions.
      if (agentConfig.followUpMode === "all" && parts.length > 0) {
        parts.push({ type: "text", text: "\n\n" });
      }
    }

    if (parts.length === 0) return;

    const userMsg: ChatUiMessage = {
      id: nanoid(),
      role: "user",
      parts,
      createdAt: new Date().toISOString(),
    };

    logChatDebug("queue-drain", {
      chatId,
      mode: agentConfig.followUpMode,
      drainedCount: drained.length,
    });

    void startStream(userMsg);
  }, [agentConfig.followUpMode, chatId, startStream, status]);

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

    pendingSubmissionStartedChatIdRef.current = chatId;
    invalidateGitBranches();
    void startStream({
      id: pendingSubmission.messageId,
      role: "user",
      parts: pendingSubmission.parts,
      createdAt: new Date().toISOString(),
    });
  }, [chatId, invalidateGitBranches, startStream]);

  useEffect(() => {
    if (!chatId) {
      return;
    }

    if (pendingSubmissionStartedChatIdRef.current === chatId) {
      pendingSubmissionStartedChatIdRef.current = null;
      return;
    }

    void attachToExistingStream();
  }, [attachToExistingStream, chatId]);

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

      // Busy → enqueue as a follow-up. The drain effect picks it up when the
      // current stream completes. No optimistic append, no stream start — the
      // user sees it in <ChatQueuedMessages /> below the input.
      if (isStreamActive) {
        const queuedParts: QueuedPart[] = parts.filter(
          (part): part is QueuedPart =>
            part.type === "text" || part.type === "file",
        );
        if (queuedParts.length === 0) return;
        enqueueChatMessage(chatId, "followup", queuedParts);
        logChatDebug("queue-enqueued", {
          chatId,
          kind: "followup",
          partsCount: queuedParts.length,
        });
        return;
      }

      invalidateGitBranches();
      await startStream(userMsg);
    },
    [
      agentConfig,
      chatId,
      createChat,
      invalidateGitBranches,
      isDraft,
      isStreamActive,
      navigate,
      projectId,
      startStream,
    ],
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

      const retainedMessages = messages.slice(0, index);
      const editedMessage = {
        ...messageToEdit,
        parts: nextParts,
      };
      const nextMessages = [...retainedMessages, editedMessage];

      try {
        await replaceMessages.mutateAsync({
          chatId,
          messages: retainedMessages.map((message) => {
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

      flushSync(() => {
        setMessages(nextMessages);
      });
      await startStream({
        ...messageToEdit,
        parts: nextParts,
      });
    },
    [chatId, messages, persistedMessagesById, replaceMessages, startStream],
  );

  /** Regenerate an assistant turn from its first message index. */
  const handleRegenerate = useCallback(
    async (messageIndex: number) => {
      if (!chatId) {
        return;
      }

      const messageToRegenerate = messages[messageIndex];
      if (!messageToRegenerate || messageToRegenerate.role !== "assistant") {
        return;
      }

      const nextMessages = messages.slice(0, messageIndex);
      const triggerIndex = (() => {
        for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
          if (nextMessages[index]?.role === "user") {
            return index;
          }
        }
        return -1;
      })();
      if (triggerIndex === -1) {
        return;
      }

      const triggerMessage = nextMessages[triggerIndex]!;
      const retainedMessages = nextMessages.slice(0, triggerIndex);

      try {
        await replaceMessages.mutateAsync({
          chatId,
          messages: retainedMessages.map((message) => {
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
        messageId: messageToRegenerate.id,
        retainedMessageCount: messageIndex,
      });

      flushSync(() => {
        setMessages(nextMessages);
      });
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
          await persistDraftProjectAgentConfig(nextAgentConfig);
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
    [
      agentConfig,
      allModels,
      chatId,
      isDraft,
      persistDraftProjectAgentConfig,
      updateChatAgentConfig,
    ],
  );

  /**
   * Attach this chat to a workspace by name. The name can be a real branch or
   * a worktree slug — the server resolves which kind it is and routes the cwd
   * accordingly. `null` means "use HEAD."
   */
  const handleBranchChange = useCallback(
    async (branch: string | null) => {
      if (agentConfig.branch === branch) {
        return;
      }

      const nextAgentConfig = { ...agentConfig, branch };
      const previousAgentConfig = agentConfig;

      setAgentConfig(nextAgentConfig);
      logChatDebug("branch-change", {
        chatId,
        previousAgentConfig,
        nextAgentConfig,
        isDraft,
      });

      try {
        if (isDraft) {
          await persistDraftProjectAgentConfig(nextAgentConfig);
          return;
        }

        if (!chatId) return;

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
              ? "Could not save default workspace"
              : "Could not save chat workspace",
        );
      }
    },
    [
      agentConfig,
      chatId,
      isDraft,
      persistDraftProjectAgentConfig,
      updateChatAgentConfig,
    ],
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
          await persistDraftProjectAgentConfig(nextAgentConfig);
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
      isDraft,
      persistDraftProjectAgentConfig,
      updateChatAgentConfig,
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
          await persistDraftProjectAgentConfig(nextAgentConfig);
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
      isDraft,
      persistDraftProjectAgentConfig,
      updateChatAgentConfig,
    ],
  );

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

      const reduction = reduceChatStreamEvent({
        messages: messagesRef.current,
        streamingMessage: streamingBufferRef.current,
        event: {
          type: "tool_approval_resolved",
          toolCallId,
          toolName: "",
          approved,
          reason,
        },
        streamingId:
          streamingBufferRef.current?.id ??
          `${chatId ?? "draft"}-stream-${Date.now()}`,
      });

      if (reduction.messagesChanged) {
        messagesRef.current = reduction.messages;
        setMessages(reduction.messages);
      }
      if (reduction.streamingChanged) {
        streamingBufferRef.current = reduction.streamingMessage;
        if (reduction.streamingMessage) {
          setStreamingMessage(chatId, reduction.streamingMessage);
        } else {
          clearStreamingMessage(chatId);
        }
      }

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
   * Handlers bundle passed to the memoized <ChatMessageList />. The bundle
   * identity MUST stay stable across renders so the list memo holds. The
   * action callbacks (handleEdit, handleRegenerate, handleFork,
   * handleResolveApproval) themselves change whenever `messages` changes
   * (tool-result fold-in, etc.), so we route through a ref and keep the
   * bundle itself frozen at mount.
   */
  const latestHandlersRef = useRef({
    handleEdit,
    handleFork,
    handleRegenerate,
    handleResolveApproval,
  });
  latestHandlersRef.current = {
    handleEdit,
    handleFork,
    handleRegenerate,
    handleResolveApproval,
  };
  const listHandlers = useMemo(
    () => ({
      onRegenerate: (index: number) => {
        void latestHandlersRef.current.handleRegenerate(index);
      },
      onEdit: (index: number, newText: string) => {
        void latestHandlersRef.current.handleEdit(index, newText);
      },
      onFork: (index: number) => {
        void latestHandlersRef.current.handleFork(index);
      },
      onResolveApproval: (
        toolCallId: string,
        approved: boolean,
        reason?: string,
      ) =>
        latestHandlersRef.current.handleResolveApproval(
          toolCallId,
          approved,
          reason,
        ),
    }),
    [],
  );

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
            <div className="relative flex min-h-full w-full flex-col justify-center py-16">
              <h1
                className="relative mb-8 text-left text-4xl font-semibold tracking-tight text-foreground/90 animate-in fade-in slide-in-from-bottom-3 duration-500"
                style={{ animationFillMode: "both" }}
              >
                What should we build in {projectName}?
              </h1>

              <div className="w-full">
                <PromptInputProvider>
                  <ChatPromptInputArea
                    chatId={chatId}
                    projectId={projectId}
                    projectName={projectName}
                    onSubmit={handleSubmit}
                    status={status}
                    onStop={stop}
                    agentConfig={agentConfig}
                    allModels={allModels}
                    configuredProviders={configuredProviders}
                    oauthProviders={oauthProviders}
                    onThinkingLevelChange={handleThinkingLevelChange}
                    onModelChange={handleModelChange}
                    onPermissionModeChange={handlePermissionModeChange}
                    onBranchChange={handleBranchChange}
                    builtinHandlers={{
                      onNew: handleNewChat,
                      onFork: () => {
                        if (messages.length > 0) {
                          void handleFork(messages.length - 1);
                        }
                      },
                      onRegenerate: () => {
                        const turnStartIndex =
                          getLastAssistantTurnStartIndex(messages);
                        if (turnStartIndex !== -1) {
                          void handleRegenerate(turnStartIndex);
                        }
                      },
                    }}
                    layout="empty"
                  />
                </PromptInputProvider>

                <div className="mt-4 flex flex-col">
                  {STARTER_PROMPTS.map((suggestion, i) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="group flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground/80 transition-colors hover:bg-muted/20 hover:text-foreground animate-in fade-in slide-in-from-bottom-1 duration-300"
                      style={{ animationDelay: `${220 + i * 60}ms`, animationFillMode: "both" }}
                      onClick={() => void handleSubmit({ text: suggestion, files: [] })}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <MessageSquareTextIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
                        <span className="truncate">{suggestion}</span>
                      </div>
                      <ArrowRightIcon className="size-3 -translate-x-1 text-muted-foreground/40 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-foreground/60 group-hover:opacity-100" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <ChatMessageList
            messages={finalMessages}
            handlers={listHandlers}
          />
          {chatId ? (
            <StreamingMessage
              chatId={chatId}
              messages={streamingMessages}
            />
          ) : null}
        </ConversationContent>

        <ConversationScrollButton />
      </Conversation>

      {messages.length > 0 ? (
        <div className="bg-background">
          <ChatQueuedMessages
            chatId={chatId}
            className="px-3 pt-2"
          />
          <ChatPendingApprovals
            chatId={chatId}
            className="px-3 pt-2"
            messages={finalMessages}
            streamingMessages={streamingMessages}
            onResolveApproval={listHandlers.onResolveApproval}
          />
          <div className="mx-auto w-full max-w-2xl px-3 py-2">
            <PromptInputProvider>
              <ChatPromptInputArea
                chatId={chatId}
                projectId={projectId}
                projectName={projectName}
                onSubmit={handleSubmit}
                status={status}
                onStop={stop}
                agentConfig={agentConfig}
                allModels={allModels}
                configuredProviders={configuredProviders}
                oauthProviders={oauthProviders}
                onThinkingLevelChange={handleThinkingLevelChange}
                onModelChange={handleModelChange}
                onPermissionModeChange={handlePermissionModeChange}
                onBranchChange={handleBranchChange}
                builtinHandlers={{
                  onNew: handleNewChat,
                  onFork: () => {
                    if (messages.length > 0) {
                      void handleFork(messages.length - 1);
                    }
                  },
                  onRegenerate: () => {
                    const turnStartIndex =
                      getLastAssistantTurnStartIndex(messages);
                    if (turnStartIndex !== -1) {
                      void handleRegenerate(turnStartIndex);
                    }
                  },
                }}
                layout="docked"
              />
            </PromptInputProvider>
          </div>
        </div>
      ) : null}
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
  projectName: string;
  onSubmit: (message: PromptInputMessage) => Promise<void> | void;
  status: ChatStatus;
  onStop: () => void;
  agentConfig: PiAgentConfig;
  allModels: readonly ChatPromptModel[];
  configuredProviders: ReadonlySet<string>;
  oauthProviders: ReadonlySet<string>;
  onThinkingLevelChange: (
    level: PiAgentConfig["thinkingLevel"],
  ) => Promise<void> | void;
  onModelChange: (value: string) => Promise<void> | void;
  onPermissionModeChange: (
    presetId: PermissionModePresetId,
  ) => Promise<void> | void;
  onBranchChange: (branch: string | null) => Promise<void> | void;
  builtinHandlers: BuiltinHandlers;
  layout: "empty" | "docked";
}

function ChatPromptInputArea({
  chatId,
  projectId,
  projectName,
  onSubmit,
  status,
  onStop,
  agentConfig,
  allModels,
  configuredProviders,
  oauthProviders,
  onThinkingLevelChange,
  onModelChange,
  onPermissionModeChange,
  onBranchChange,
  builtinHandlers,
  layout,
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

      if (event.defaultPrevented) {
        return;
      }

      if (event.key === "Tab" && event.shiftKey) {
        event.preventDefault();

        const currentIndex = activePresetId
          ? PERMISSION_MODE_PRESET_ORDER.indexOf(activePresetId)
          : -1;
        const nextPresetId =
          PERMISSION_MODE_PRESET_ORDER[
            (currentIndex + 1) % PERMISSION_MODE_PRESET_ORDER.length
          ];

        void onPermissionModeChange(nextPresetId);
      }
    },
    [activePresetId, onPermissionModeChange],
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
          autoFocus={chatId === null}
          className="max-h-[9.6rem] min-h-[3.2rem]"
          placeholder={
            layout === "empty"
              ? `What should we build in ${projectName}?`
              : "Message..."
          }
          onKeyDown={handleTextareaKeyDown}
        />
        <PromptInputFooter>
          <PromptInputTools>
            <AttachFilesButton />

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
              <PromptInputSelectTrigger size="sm" aria-label="Permission mode">
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
          <div className="flex min-w-0 items-center gap-1">
            <PiModelPicker
              value={getModelValue({
                provider: agentConfig.provider,
                id: agentConfig.modelId,
              })}
              models={allModels}
              configuredProviders={configuredProviders}
              oauthProviders={oauthProviders}
              compact
              onValueChange={(value) => {
                void onModelChange(value as string);
              }}
            />

            <PromptInputSelect
              value={agentConfig.thinkingLevel}
              onValueChange={(value) => {
                void onThinkingLevelChange(
                  value as PiAgentConfig["thinkingLevel"],
                );
              }}
            >
              <PromptInputSelectTrigger size="sm" aria-label="Reasoning effort">
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

            <PromptInputSubmit size="icon-xs" status={status} onStop={onStop} />
          </div>
        </PromptInputFooter>
      </PromptInput>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <ChatProjectSelect projectId={projectId} projectName={projectName} />
        <ChatBranchSelect
          projectId={projectId}
          value={agentConfig.branch}
          onValueChange={onBranchChange}
        />
      </div>
    </div>
  );
}
