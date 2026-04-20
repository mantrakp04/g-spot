import { Button } from "@g-spot/ui/components/button";
import { cn } from "@g-spot/ui/lib/utils";
import {
  BrainIcon,
  CheckIcon,
  CopyIcon,
  GitForkIcon,
  PencilIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState, memo } from "react";

import {
  Attachments,
  Attachment,
  AttachmentPreview,
  AttachmentInfo,
} from "@/components/ai-elements/attachments";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from "@/components/ai-elements/message";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import type { DynamicToolUIPart, ToolUIPart, UIMessage, UIMessagePart } from "@/lib/chat-ui";

interface ChatMessageProps {
  message: UIMessage;
  isStreaming: boolean;
  onReload?: () => void;
  onEdit?: (newText: string) => void;
  onFork?: () => void;
  /**
   * Called when the user approves / denies a pending tool call. The message
   * component tracks which tool part is currently gated by walking its own
   * parts; `chat-view.tsx` handles the actual mutation + optimistic update.
   */
  onResolveApproval?: (
    toolCallId: string,
    approved: boolean,
    reason?: string,
  ) => void | Promise<void>;
}

function isToolPart(part: UIMessagePart): part is ToolUIPart | DynamicToolUIPart {
  return "state" in part && (part.type === "dynamic-tool" || part.type.startsWith("tool-"));
}

export const ChatMessage = memo(function ChatMessage({
  message,
  isStreaming,
  onReload,
  onEdit,
  onFork,
  onResolveApproval,
}: ChatMessageProps) {
  const showAssistantActions = message.role === "assistant" && !isStreaming;
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleCopy = useCallback(() => {
    const text = message.parts
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [message.parts]);

  const handleStartEdit = useCallback(() => {
    setEditing(true);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  const handleSaveEdit = useCallback(() => {
    const newText = textareaRef.current?.value.trim();
    if (newText && onEdit) {
      onEdit(newText);
    }
    setEditing(false);
  }, [onEdit]);

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSaveEdit();
      }
      if (e.key === "Escape") {
        handleCancelEdit();
      }
    },
    [handleSaveEdit, handleCancelEdit],
  );

  const currentText = message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");

  /**
   * Split assistant parts into "thought" (reasoning + tool invocations +
   * intermediate text/steps) and "response" (the trailing text/file parts
   * that form the agent's final answer). The response is the suffix of
   * text/file parts; everything before that goes into ChainOfThought.
   */
  const { thoughtParts, responseParts } = useMemo(() => {
    if (message.role !== "assistant") {
      return { thoughtParts: [], responseParts: message.parts };
    }

    let splitAt = message.parts.length;
    for (let i = message.parts.length - 1; i >= 0; i--) {
      const p = message.parts[i]!;
      if (p.type === "text" || p.type === "file") {
        splitAt = i;
        continue;
      }
      break;
    }

    return {
      thoughtParts: message.parts.slice(0, splitAt),
      responseParts: message.parts.slice(splitAt),
    };
  }, [message.parts, message.role]);

  const hasThought = thoughtParts.some(
    (p) => p.type === "reasoning" || isToolPart(p),
  );

  return (
    <div
      className={cn(
        "group/msg relative",
        message.role === "user" && "flex justify-end",
      )}
    >
      <Message
        from={message.role}
        className={cn(
          message.role === "user" && "max-w-[80%]",
          message.role === "assistant" && "max-w-full",
        )}
      >
        {/* Edit mode for user messages */}
        {message.role === "user" && editing ? (
          <div className="flex w-full flex-col gap-2">
            <textarea
              ref={textareaRef}
              defaultValue={currentText}
              onKeyDown={handleEditKeyDown}
              className="field-sizing-content min-h-16 w-full resize-none rounded-lg border border-border bg-secondary/80 px-4 py-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring/50"
              autoFocus
            />
            <div className="flex justify-end gap-1.5">
              <Button
                size="xs"
                variant="ghost"
                onClick={handleCancelEdit}
                className="gap-1 text-xs"
              >
                <XIcon className="size-3" />
                Cancel
              </Button>
              <Button
                size="xs"
                variant="default"
                onClick={handleSaveEdit}
                className="gap-1 text-xs"
              >
                <CheckIcon className="size-3" />
                Save & Submit
              </Button>
            </div>
          </div>
        ) : (
          <MessageContent
            className={cn(
              message.role === "user" &&
                "rounded-2xl rounded-br-md bg-secondary/80 px-4 py-3 text-sm backdrop-blur-sm",
              message.role === "assistant" &&
                "text-sm leading-relaxed",
            )}
          >
            {message.role === "assistant" && hasThought && (
              // Always default open so the swap from the streaming overlay
              // to the finalized list item is visually invariant. ChainOfThought
              // remains user-collapsible.
              <ChainOfThought defaultOpen>
                <ChainOfThoughtHeader>
                  {isStreaming && responseParts.length === 0
                    ? "Thinking..."
                    : "Chain of Thought"}
                </ChainOfThoughtHeader>
                <ChainOfThoughtContent>
                  {thoughtParts.map((part, i) => {
                    const key = `${message.id}-thought-${part.type}-${i}`;

                    if (isToolPart(part)) {
                      const stepStatus: "pending" | "active" | "complete" =
                        part.state === "input-streaming"
                          ? "pending"
                          : part.state === "input-available" ||
                              part.state === "approval-requested" ||
                              part.state === "approval-responded"
                            ? "active"
                            : "complete";
                      const toolName =
                        part.toolName ??
                        (part.type.startsWith("tool-")
                          ? part.type.slice("tool-".length)
                          : "tool");
                      const toolCallId = part.toolCallId;
                      const isAwaitingApproval =
                        part.state === "approval-requested" &&
                        !!toolCallId &&
                        !!onResolveApproval;
                      const denialText =
                        part.state === "approval-responded" &&
                        part.approval?.approved === false
                          ? part.approval?.reason ?? "You denied this tool call."
                          : null;

                      return (
                        <ChainOfThoughtStep
                          key={key}
                          icon={WrenchIcon}
                          label={toolName}
                          status={stepStatus}
                        >
                          <Tool>
                            {part.type === "dynamic-tool" ? (
                              <ToolHeader
                                type={part.type}
                                state={part.state}
                                toolName={part.toolName}
                              />
                            ) : (
                              <ToolHeader type={part.type} state={part.state} />
                            )}
                            <ToolContent>
                              {part.input !== undefined && (
                                <ToolInput input={part.input} />
                              )}
                              {isAwaitingApproval && (
                                <div className="flex flex-col gap-2 border-t p-3">
                                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                                    <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
                                    <span>
                                      {part.approval?.reason ??
                                        `Approve ${toolName} before it can run?`}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-end gap-1.5">
                                    <Button
                                      size="xs"
                                      variant="ghost"
                                      className="gap-1 text-xs"
                                      onClick={() => {
                                        if (!toolCallId) return;
                                        void onResolveApproval?.(
                                          toolCallId,
                                          false,
                                          "User denied.",
                                        );
                                      }}
                                    >
                                      <XIcon className="size-3" />
                                      Deny
                                    </Button>
                                    <Button
                                      size="xs"
                                      variant="default"
                                      className="gap-1 text-xs"
                                      onClick={() => {
                                        if (!toolCallId) return;
                                        void onResolveApproval?.(
                                          toolCallId,
                                          true,
                                        );
                                      }}
                                    >
                                      <CheckIcon className="size-3" />
                                      Approve
                                    </Button>
                                  </div>
                                </div>
                              )}
                              {denialText && (
                                <div className="border-t p-3 text-xs text-muted-foreground">
                                  {denialText}
                                </div>
                              )}
                              {(part.output !== undefined || part.errorText) && (
                                <ToolOutput
                                  output={part.output}
                                  errorText={part.errorText}
                                />
                              )}
                            </ToolContent>
                          </Tool>
                        </ChainOfThoughtStep>
                      );
                    }

                    if (part.type === "reasoning") {
                      return (
                        <ChainOfThoughtStep
                          key={key}
                          icon={BrainIcon}
                          label="Thinking"
                          status={
                            isStreaming && i === thoughtParts.length - 1
                              ? "active"
                              : "complete"
                          }
                          description={
                            <MessageResponse className="text-muted-foreground text-xs [&_p]:my-1 [&_pre]:my-1 [&_ul]:my-1 [&_ol]:my-1">
                              {part.text}
                            </MessageResponse>
                          }
                        />
                      );
                    }

                    if (part.type === "text" && part.text) {
                      return (
                        <ChainOfThoughtStep
                          key={key}
                          label="Note"
                          description={
                            <MessageResponse className="text-muted-foreground text-xs [&_p]:my-1 [&_pre]:my-1 [&_ul]:my-1 [&_ol]:my-1">
                              {part.text}
                            </MessageResponse>
                          }
                        />
                      );
                    }

                    return null;
                  })}
                </ChainOfThoughtContent>
              </ChainOfThought>
            )}

            {responseParts.map((part, i) => {
              const key = `${message.id}-response-${part.type}-${i}`;

              if (part.type === "text") {
                return part.text ? (
                  // Typewriter animation removed: it runs only on the streaming
                  // overlay and stops mid-character when the overlay swaps for
                  // the finalized list item, causing a visible jump.
                  <MessageResponse key={key}>
                    {part.text}
                  </MessageResponse>
                ) : null;
              }

              if (part.type === "file") {
                return (
                  <Attachments key={key} variant="inline">
                    <Attachment data={{ ...part, id: key }}>
                      <AttachmentPreview />
                      <AttachmentInfo />
                    </Attachment>
                  </Attachments>
                );
              }

              return null;
            })}
          </MessageContent>
        )}

        {/* User message actions */}
        {message.role === "user" && !editing && (
          <MessageActions className="mt-1 justify-end opacity-0 transition-opacity duration-200 group-hover/msg:opacity-100">
            {onEdit && (
              <MessageAction tooltip="Edit" onClick={handleStartEdit}>
                <PencilIcon className="size-3.5" />
              </MessageAction>
            )}
            {onFork && (
              <MessageAction tooltip="Fork from here" onClick={onFork}>
                <GitForkIcon className="size-3.5" />
              </MessageAction>
            )}
          </MessageActions>
        )}

        {/* Assistant message actions */}
        {showAssistantActions && (
          <MessageActions className="mt-1 opacity-0 transition-opacity duration-200 group-hover/msg:opacity-100">
            <MessageAction tooltip="Copy" onClick={handleCopy}>
              {copied ? (
                <CheckIcon className="size-3.5 text-emerald-400" />
              ) : (
                <CopyIcon className="size-3.5" />
              )}
            </MessageAction>
            {onReload && (
              <MessageAction tooltip="Regenerate" onClick={onReload}>
                <RefreshCwIcon className="size-3.5" />
              </MessageAction>
            )}
            {onFork && (
              <MessageAction tooltip="Fork from here" onClick={onFork}>
                <GitForkIcon className="size-3.5" />
              </MessageAction>
            )}
          </MessageActions>
        )}
      </Message>
    </div>
  );
});
