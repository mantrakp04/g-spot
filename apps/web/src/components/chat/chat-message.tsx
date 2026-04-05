import { Button } from "@g-spot/ui/components/button";
import { cn } from "@g-spot/ui/lib/utils";
import type { UIMessage } from "ai";
import type { ChatStatus } from "ai";
import {
  CheckIcon,
  CopyIcon,
  GitForkIcon,
  PencilIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useRef, useState, memo } from "react";

import {
  Attachments,
  Attachment,
  AttachmentPreview,
  AttachmentInfo,
} from "@/components/ai-elements/attachments";
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";

interface ChatMessageProps {
  message: UIMessage;
  isStreaming: boolean;
  status: ChatStatus;
  onReload?: () => void;
  onEdit?: (newText: string) => void;
  onFork?: () => void;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  isStreaming,
  status,
  onReload,
  onEdit,
  onFork,
}: ChatMessageProps) {
  const showAssistantActions =
    message.role === "assistant" && status !== "streaming";
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
            {message.parts.map((part, i) => {
              const key = `${message.id}-${part.type}-${i}`;
              switch (part.type) {
                case "text":
                  return part.text ? (
                    <MessageResponse
                      key={key}
                      isAnimating={
                        isStreaming &&
                        message.role === "assistant" &&
                        i === message.parts.length - 1
                      }
                    >
                      {part.text}
                    </MessageResponse>
                  ) : null;

                case "reasoning":
                  return (
                    <Reasoning
                      key={key}
                      isStreaming={isStreaming && message.role === "assistant"}
                    >
                      <ReasoningTrigger />
                      <ReasoningContent>{part.text}</ReasoningContent>
                    </Reasoning>
                  );

                case "tool-invocation":
                  return (
                    <Tool key={key}>
                      <ToolHeader
                        type="tool-invocation"
                        state={part.state}
                        title={"toolName" in part ? String(part.toolName) : undefined}
                      />
                      <ToolContent>
                        {"args" in part && <ToolInput input={part.args} />}
                        {"output" in part && (
                          <ToolOutput
                            output={part.output}
                            errorText={"errorText" in part ? String(part.errorText) : undefined}
                          />
                        )}
                      </ToolContent>
                    </Tool>
                  );

                case "file":
                  return (
                    <Attachments key={key} variant="inline">
                      <Attachment data={{ ...part, id: key }}>
                        <AttachmentPreview />
                        <AttachmentInfo />
                      </Attachment>
                    </Attachments>
                  );

                case "step-start":
                  return null;

                default:
                  return null;
              }
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
        {message.role === "assistant" && showAssistantActions && !isStreaming && (
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
