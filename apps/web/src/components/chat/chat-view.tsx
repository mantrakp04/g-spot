import { Skeleton } from "@g-spot/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@g-spot/ui/components/tabs";
import { env } from "@g-spot/env/web";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
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
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
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
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";

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
  useGenerateChatTitleMutation,
  useChatMessages,
  useCreateChatMutation,
  useForkChatMutation,
  useReplaceChatMessagesMutation,
  useSaveChatMessageMutation,
  useUpdateChatModelMutation,
} from "@/hooks/use-chat-data";
import {
  CHAT_MODELS,
  type ChatModelId,
  DEFAULT_CHAT_MODEL,
  useDefaultChatModelPreference,
  useDefaultWorkerModelPreference,
} from "@/hooks/use-chat-preferences";
import { consumePendingChatSubmission, setPendingChatSubmission } from "@/lib/pending-chat-submissions";
import { useNavigate } from "@tanstack/react-router";

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
}

type ChatUiMessage = UIMessage & {
  createdAt?: Date | string;
};

/**
 * Outer wrapper: fetches DB messages, shows loading skeleton,
 * then mounts ChatViewInner only once data is ready.
 * This ensures useChat initializes with the actual messages.
 */
export function ChatView({ chatId }: ChatViewProps) {
  const { data: chat, isLoading: isLoadingChat } = useChatDetail(chatId ?? "");
  const { data: dbMessages, isLoading: isLoadingMessages } = useChatMessages(chatId ?? "");

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
      key={chatId ?? "draft"}
      chatId={chatId ?? null}
      chatModel={chat?.model ?? null}
      dbMessages={dbMessages ?? []}
    />
  );
}

interface ChatViewInnerProps {
  chatId: string | null;
  chatModel: string | null;
  dbMessages: { id: string; role: string; parts: unknown[]; createdAt: string }[];
}

function ChatViewInner({
  chatId,
  chatModel,
  dbMessages,
}: ChatViewInnerProps) {
  const navigate = useNavigate();
  const { defaultChatModel, setDefaultChatModel } = useDefaultChatModelPreference();
  const { defaultWorkerModel } = useDefaultWorkerModelPreference();
  const createChat = useCreateChatMutation();
  const saveMessage = useSaveChatMessageMutation();
  const updateChatModel = useUpdateChatModelMutation();
  const generateTitle = useGenerateChatTitleMutation();
  const replaceMessages = useReplaceChatMessagesMutation();
  const forkChat = useForkChatMutation();
  const isDraft = chatId === null;
  const persistedChatModel = useMemo(
    () =>
      chatModel && CHAT_MODELS.some((candidate) => candidate.id === chatModel)
        ? (chatModel as ChatModelId)
        : DEFAULT_CHAT_MODEL,
    [chatModel],
  );
  const [model, setModel] = useState<ChatModelId>(
    isDraft ? defaultChatModel : persistedChatModel,
  );

  useEffect(() => {
    if (isDraft) {
      setModel(defaultChatModel);
      return;
    }

    setModel(persistedChatModel);
  }, [defaultChatModel, isDraft, persistedChatModel]);

  const initialMessages = useMemo<ChatUiMessage[]>(
    () =>
      dbMessages.map((m) => ({
        id: m.id,
        role: m.role as UIMessage["role"],
        parts: m.parts as UIMessage["parts"],
        createdAt: new Date(m.createdAt),
      })),
    [dbMessages],
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${env.VITE_SERVER_URL}/api/chat`,
        headers: async () => {
          const user = await stackClientApp.getUser();
          if (!user) return {} as Record<string, string>;
          const { accessToken } = await user.getAuthJson();
          return accessToken
            ? ({ "x-stack-access-token": accessToken } as Record<string, string>)
            : ({} as Record<string, string>);
        },
        body: () => ({ chatId: chatId ?? "", model }),
      }),
    [chatId, model],
  );

  const { messages, sendMessage, regenerate, stop, status } = useChat<ChatUiMessage>({
    id: chatId ?? "draft",
    transport,
    messages: initialMessages,
    onFinish: ({ messages: nextMessages, isAbort, isDisconnect, isError }) => {
      if (isAbort || isDisconnect || isError || !chatId) {
        return;
      }

      void generateTitle
        .mutateAsync({
          chatId,
          model: defaultWorkerModel,
          messages: nextMessages.map((message) => ({
            role: message.role,
            parts: message.parts,
          })),
        })
        .catch(() => {
          // Title refresh is best-effort and should never block the chat flow.
        });
    },
  });

  useEffect(() => {
    if (!chatId || dbMessages.length === 0) {
      return;
    }

    const pendingSubmission = consumePendingChatSubmission(chatId);
    if (!pendingSubmission) {
      return;
    }

    if (!dbMessages.some((message) => message.id === pendingSubmission.messageId)) {
      return;
    }

    void sendMessage({
      messageId: pendingSubmission.messageId,
      parts: pendingSubmission.parts,
    });
  }, [chatId, dbMessages, sendMessage]);

  const serializeMessage = useCallback(
    (message: ChatUiMessage) => ({
      id: message.id,
      message: JSON.stringify({
        ...message,
        createdAt:
          message.createdAt instanceof Date
            ? message.createdAt.toISOString()
            : typeof message.createdAt === "string"
              ? message.createdAt
              : new Date().toISOString(),
      }),
    }),
    [],
  );

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

      if (isDraft) {
        const nextChat = await createChat.mutateAsync({
          model,
          initialMessage: {
            id: userMsgId,
            message: JSON.stringify(userMsg),
          },
        });

        setPendingChatSubmission(nextChat.id, {
          messageId: userMsgId,
          parts,
        });

        navigate({
          to: "/chat/$chatId",
          params: { chatId: nextChat.id },
        });
        return;
      }

      if (!chatId) {
        return;
      }

      saveMessage.mutate({
        chatId,
        message: {
          id: userMsgId,
          message: JSON.stringify(userMsg),
        },
      });

      await sendMessage({
        text: message.text,
        files: message.files,
      });
    },
    [chatId, createChat, isDraft, model, navigate, saveMessage, sendMessage],
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

      await replaceMessages.mutateAsync({
        chatId,
        messages: nextMessages.map(serializeMessage),
      });

      await sendMessage({
        parts: nextParts,
        messageId: messageToEdit.id,
      });
    },
    [chatId, messages, replaceMessages, sendMessage, serializeMessage],
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

      await replaceMessages.mutateAsync({
        chatId,
        messages: messages.slice(0, messageIndex).map(serializeMessage),
      });

      await regenerate({ messageId });
    },
    [chatId, messages, regenerate, replaceMessages, serializeMessage],
  );

  /** Fork into a new chat seeded with the conversation through this message */
  const handleFork = useCallback(
    async (index: number) => {
      if (!chatId) {
        return;
      }

      const nextChat = await forkChat.mutateAsync({
        chatId,
        messages: messages.slice(0, index + 1).map(serializeMessage),
      });

      navigate({
        to: "/chat/$chatId",
        params: { chatId: nextChat.id },
      });
    },
    [chatId, forkChat, messages, navigate, serializeMessage],
  );

  const handleModelChange = useCallback(
    async (nextValue: string) => {
      const nextModel = nextValue as ChatModelId;
      const previousModel = model;
      setModel(nextModel);

      try {
        if (isDraft) {
          await setDefaultChatModel(nextModel);
          return;
        }

        if (!chatId) {
          return;
        }

        await updateChatModel.mutateAsync({
          chatId,
          model: nextModel,
        });
      } catch (error) {
        setModel(previousModel);
        toast.error(
          error instanceof Error
            ? error.message
            : isDraft
              ? "Could not save default chat model"
              : "Could not save chat model",
        );
      }
    },
    [chatId, isDraft, model, setDefaultChatModel, updateChatModel],
  );

  const isStreaming = status === "streaming" || status === "submitted";

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

          {messages.map((msg: UIMessage, i: number) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              isStreaming={isStreaming && i === messages.length - 1}
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
                      void handleEdit(i, newText);
                    }
                  : undefined
              }
              onFork={() => {
                void handleFork(i);
              }}
            />
          ))}
        </ConversationContent>

        <ConversationScrollButton />
      </Conversation>

      <div className="bg-background/80 backdrop-blur-md">
        <div className="mx-auto w-full max-w-2xl px-4 py-3">
          <PromptInput onSubmit={handleSubmit}>
            <AttachmentPreviews />
            <PromptInputTextarea placeholder="Message..." />
            <PromptInputFooter>
              <PromptInputTools>
                <AttachFilesButton />

                <PromptInputSelect
                  value={model}
                  onValueChange={(value) => {
                    void handleModelChange(value as string);
                  }}
                >
                  <PromptInputSelectTrigger className="h-7 w-auto gap-1.5 rounded-md px-2 text-xs">
                    <PromptInputSelectValue />
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent>
                    {CHAT_MODELS.map((m) => (
                      <PromptInputSelectItem key={m.id} value={m.id}>
                        {m.label}
                      </PromptInputSelectItem>
                    ))}
                  </PromptInputSelectContent>
                </PromptInputSelect>
              </PromptInputTools>

              <PromptInputSubmit status={status} onStop={stop} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
