import { Button } from "@g-spot/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@g-spot/ui/components/dialog";
import { env } from "@g-spot/env/web";
import { cn } from "@g-spot/ui/lib/utils";
import {
  BrainIcon,
  CheckIcon,
  CopyIcon,
  GitForkIcon,
  PencilIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState, memo, type KeyboardEvent } from "react";

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
import type {
  DynamicToolUIPart,
  FileUIPart,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
} from "@/lib/chat-ui";
import { perfCount } from "@/lib/chat-perf-log";

interface ChatMessageProps {
  message: UIMessage;
  variant: "final" | "streaming";
  showThoughts?: boolean;
  onReload?: () => void;
  onEdit?: (newText: string) => void;
  onFork?: () => void;
}

function isToolPart(part: UIMessagePart): part is ToolUIPart | DynamicToolUIPart {
  return "state" in part && (part.type === "dynamic-tool" || part.type.startsWith("tool-"));
}

export const ChatMessage = memo(function ChatMessage({
  message,
  variant,
  showThoughts,
  onReload,
  onEdit,
  onFork,
}: ChatMessageProps) {
  perfCount("ChatMessage.render", {
    id: message.id,
    role: message.role,
    parts: message.parts.length,
    variant,
  });

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
        {message.role === "user" ? (
          <UserMessageBubble
            message={message}
            onEdit={onEdit}
            onFork={onFork}
          />
        ) : (
          <AssistantMessageBubble
            message={message}
            variant={variant}
            showActions={variant === "final"}
            showThoughts={showThoughts ?? variant === "final"}
            onReload={onReload}
            onFork={onFork}
          />
        )}
      </Message>
    </div>
  );
});

function UserMessageBubble({
  message,
  onEdit,
  onFork,
}: {
  message: UIMessage;
  onEdit?: (newText: string) => void;
  onFork?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentText = message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");

  const handleSaveEdit = useCallback(() => {
    const newText = textareaRef.current?.value.trim();
    if (newText && onEdit) {
      onEdit(newText);
    }
    setEditing(false);
  }, [onEdit]);

  const handleEditKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSaveEdit();
      }
      if (e.key === "Escape") {
        setEditing(false);
      }
    },
    [handleSaveEdit],
  );

  if (editing) {
    return (
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
            onClick={() => setEditing(false)}
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
    );
  }

  return (
    <>
      <MessageContent className="rounded-2xl rounded-br-md bg-secondary/80 px-4 py-3 text-sm backdrop-blur-sm">
        <MessageParts messageId={message.id} parts={message.parts} />
      </MessageContent>
      <MessageActions className="mt-1 justify-end opacity-0 transition-opacity duration-200 group-hover/msg:opacity-100">
        {onEdit && (
          <MessageAction tooltip="Edit" onClick={() => setEditing(true)}>
            <PencilIcon className="size-3.5" />
          </MessageAction>
        )}
        {onFork && (
          <MessageAction tooltip="Fork from here" onClick={onFork}>
            <GitForkIcon className="size-3.5" />
          </MessageAction>
        )}
      </MessageActions>
    </>
  );
}

function AssistantMessageBubble({
  message,
  variant,
  showActions,
  showThoughts,
  onReload,
  onFork,
}: {
  message: UIMessage;
  variant: "final" | "streaming";
  showActions: boolean;
  showThoughts: boolean;
  onReload?: () => void;
  onFork?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const { thoughtParts, responseParts } = useMemo(
    () =>
      !showThoughts
        ? { thoughtParts: [], responseParts: getVisibleMessageParts(message.parts) }
        : getAssistantDisplayParts(message.parts),
    [message.parts, showThoughts],
  );
  const hasThought = thoughtParts.some(
    (p) => p.type === "reasoning" || isToolPart(p),
  );

  const handleCopy = useCallback(() => {
    const text = message.parts
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [message.parts]);

  return (
    <>
      <MessageContent className="text-sm leading-relaxed">
        {showThoughts && hasThought && (
          <AssistantThoughts messageId={message.id} parts={thoughtParts} />
        )}
        <MessageParts messageId={message.id} parts={responseParts} />
      </MessageContent>
      {showActions && (
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
    </>
  );
}

function getAssistantDisplayParts(parts: UIMessagePart[]) {
  return {
    thoughtParts: parts.filter(
      (part) => part.type === "reasoning" || isToolPart(part),
    ),
    responseParts: getVisibleMessageParts(parts),
  };
}

function getVisibleMessageParts(parts: UIMessagePart[]) {
  return parts.filter(
    (part) => part.type === "text" || part.type === "file",
  );
}

function AssistantThoughts({
  messageId,
  parts,
}: {
  messageId: string;
  parts: UIMessagePart[];
}) {
  return (
    <ChainOfThought defaultOpen>
      <ChainOfThoughtHeader>
        Chain of Thought
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {parts.map((part, i) => (
          <ThoughtPart
            key={`${messageId}-thought-${part.type}-${i}`}
            part={part}
          />
        ))}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}

function ThoughtPart({ part }: { part: UIMessagePart }) {
  if (isToolPart(part)) {
    return <ToolThoughtPart part={part} />;
  }

  if (part.type === "reasoning") {
    return (
      <ChainOfThoughtStep
        icon={BrainIcon}
        label="Thinking"
        status="complete"
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
}

function ToolThoughtPart({
  part,
}: {
  part: ToolUIPart | DynamicToolUIPart;
}) {
  const denialText =
    part.state === "approval-responded" && part.approval?.approved === false
      ? part.approval?.reason ?? "You denied this tool call."
      : null;

  return (
    <Tool>
      {part.type === "dynamic-tool" ? (
        <ToolHeader
          type={part.type}
          state={part.state}
          toolName={part.toolName}
          input={part.input}
        />
      ) : (
        <ToolHeader type={part.type} state={part.state} input={part.input} />
      )}
      <ToolContent>
        {part.input !== undefined && <ToolInput input={part.input} />}
        {denialText && (
          <div className="text-xs text-muted-foreground">{denialText}</div>
        )}
        {(part.output !== undefined || part.errorText) && (
          <ToolOutput output={part.output} errorText={part.errorText} />
        )}
      </ToolContent>
    </Tool>
  );
}

function MessageParts({
  messageId,
  parts,
}: {
  messageId: string;
  parts: UIMessagePart[];
}) {
  return (
    <>
      {parts.map((part, i) => {
        const key = `${messageId}-response-${part.type}-${i}`;

        if (part.type === "text") {
          return part.text ? (
            <MessageResponse key={key}>
              {part.text}
            </MessageResponse>
          ) : null;
        }

        if (part.type === "file") {
          return <FileAttachment key={key} id={key} part={part} />;
        }

        return null;
      })}
    </>
  );
}

function FileAttachment({ id, part }: { id: string; part: FileUIPart }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<FilePreview>(() =>
    getFilePreviewFromPart(part),
  );
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const canPreview = !!preview.text || !!preview.fileId;
  const kind = getFileKind(preview);

  const loadPreview = useCallback(async () => {
    if (preview.text || !preview.fileId) {
      return;
    }

    setPreviewLoading(true);
    setPreviewError("");

    try {
      const response = await fetch(
        `${env.VITE_SERVER_URL}/api/files/${preview.fileId}/extracted-text`,
      );
      if (!response.ok) {
        throw new Error(await response.text());
      }

      const nextPreview = parseFilePreviewResponse(await response.json());
      setPreview((current) => ({
        ...current,
        ...nextPreview,
      }));
    } catch (error) {
      setPreviewError(
        error instanceof Error ? error.message : "Could not load preview",
      );
    } finally {
      setPreviewLoading(false);
    }
  }, [preview.fileId, preview.text]);

  const openPreview = useCallback(() => {
    if (!canPreview) {
      return;
    }

    setPreviewOpen(true);
    void loadPreview();
  }, [canPreview, loadPreview]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!canPreview) {
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPreview();
      }
    },
    [canPreview, openPreview],
  );

  return (
    <>
      <Attachments className="max-w-full" variant="inline">
        <Attachment
          aria-label={canPreview ? `Preview ${preview.filename}` : undefined}
          className="max-w-full"
          data={{ ...part, id }}
          onClick={openPreview}
          onKeyDown={handleKeyDown}
          role={canPreview ? "button" : undefined}
          tabIndex={canPreview ? 0 : undefined}
          title={canPreview ? `Preview ${preview.filename}` : preview.filename}
        >
          <AttachmentPreview />
          <AttachmentInfo />
        </Attachment>
      </Attachments>
      {canPreview && (
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] max-w-[min(920px,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)] p-0">
            <DialogHeader className="border-b border-border px-4 pt-4 pb-3 pr-11">
              <DialogTitle className="truncate">{preview.filename}</DialogTitle>
              <DialogDescription className="truncate">
                {formatPreviewDescription(preview, kind)}
              </DialogDescription>
            </DialogHeader>
            {previewLoading ? (
              <div className="min-h-32 px-4 pb-4">
                <div className="h-3 w-4/5 rounded bg-muted" />
                <div className="mt-2 h-3 w-3/5 rounded bg-muted" />
                <div className="mt-2 h-3 w-2/3 rounded bg-muted" />
              </div>
            ) : previewError ? (
              <div className="px-4 pb-4 text-xs text-destructive">
                {previewError}
              </div>
            ) : (
              <pre className="min-h-0 overflow-auto px-4 pb-4 text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono text-muted-foreground">
                {preview.text}
              </pre>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

type FilePreview = {
  fileId?: string;
  filename: string;
  mediaType?: string;
  localPath?: string;
  text: string;
};

function getFilePreviewFromPart(part: FileUIPart): FilePreview {
  return {
    fileId: part.fileId,
    filename: part.filename ?? "attachment",
    mediaType: part.mediaType,
    text: part.extractedText ?? "",
  };
}

function parseFilePreviewResponse(value: unknown): Partial<FilePreview> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const data = value as {
    fileId?: unknown;
    filename?: unknown;
    mediaType?: unknown;
    localPath?: unknown;
    text?: unknown;
  };

  return {
    fileId: typeof data.fileId === "string" ? data.fileId : undefined,
    filename: typeof data.filename === "string" ? data.filename : undefined,
    mediaType: typeof data.mediaType === "string" ? data.mediaType : undefined,
    localPath: typeof data.localPath === "string" ? data.localPath : undefined,
    text: typeof data.text === "string" ? data.text : undefined,
  };
}

function getFileKind(file: Pick<FilePreview, "filename" | "mediaType">) {
  const fromMediaType = file.mediaType
    ?.split("/")
    .pop()
    ?.split(".")
    .pop()
    ?.toUpperCase();
  if (fromMediaType) {
    return fromMediaType;
  }

  return file.filename.split(".").pop()?.toUpperCase() ?? "";
}

function formatPreviewDescription(
  preview: Pick<FilePreview, "localPath">,
  kind: string,
) {
  const label = kind ? `${kind} extracted text preview` : "Extracted text preview";
  return preview.localPath ? `${label} · ${preview.localPath}` : label;
}
