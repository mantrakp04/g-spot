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
  previousMessages?: UIMessage[];
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
  previousMessages,
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
            previousMessages={previousMessages}
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
  previousMessages,
  variant,
  showActions,
  showThoughts,
  onReload,
  onFork,
}: {
  message: UIMessage;
  previousMessages?: UIMessage[];
  variant: "final" | "streaming";
  showActions: boolean;
  showThoughts: boolean;
  onReload?: () => void;
  onFork?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [openStreamingAccordions, setOpenStreamingAccordions] = useState<
    Record<string, boolean>
  >({});
  const showPersistedThoughts = variant === "final" && showThoughts;
  const responseParts = useMemo(
    () => getVisibleAssistantParts(message.parts, showPersistedThoughts),
    [message.parts, showPersistedThoughts],
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

  const handleStreamingAccordionOpenChange = useCallback(
    (id: string, open: boolean) => {
      setOpenStreamingAccordions((current) => ({ ...current, [id]: open }));
    },
    [],
  );

  return (
    <>
      <MessageContent className="w-full gap-1.5 text-sm leading-relaxed">
        {variant === "streaming" ? (
          <MessageParts
            messageId={message.id}
            parts={message.parts}
            incrementalTextParts
            renderAuxiliaryParts
            openAccordions={openStreamingAccordions}
            onAccordionOpenChange={handleStreamingAccordionOpenChange}
          />
        ) : (
          <>
            {showPersistedThoughts && previousMessages?.length ? (
              <AssistantThoughts messages={previousMessages} />
            ) : null}
            <MessageParts
              messageId={message.id}
              parts={responseParts}
              renderAuxiliaryParts={showPersistedThoughts}
            />
          </>
        )}
      </MessageContent>
      {showActions && (
        <MessageActions className="mt-1 opacity-0 transition-opacity duration-200 group-hover/msg:opacity-100">
          <MessageAction tooltip="Copy" onClick={handleCopy}>
            <span className="t-icon-swap" data-state={copied ? "b" : "a"}>
              <CopyIcon className="t-icon size-3.5" data-icon="a" />
              <CheckIcon
                className="t-icon size-3.5 text-emerald-400"
                data-icon="b"
              />
            </span>
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

function getVisibleAssistantParts(
  parts: UIMessagePart[],
  includeAuxiliaryParts: boolean,
) {
  return parts.filter(
    (part) =>
      (part.type === "text" && part.text) ||
      part.type === "file" ||
      (includeAuxiliaryParts && (part.type === "reasoning" || isToolPart(part))),
  );
}

type AssistantThoughtRenderItem =
  | {
      kind: "part";
      key: string;
      part: UIMessagePart;
    }
  | {
      kind: "tool-group";
      key: string;
      parts: (ToolUIPart | DynamicToolUIPart)[];
    };

function AssistantThoughts({ messages }: { messages: UIMessage[] }) {
  const items = getAssistantThoughtRenderItems(messages);
  const previousPartCount = items.reduce(
    (count, item) => count + (item.kind === "tool-group" ? item.parts.length : 1),
    0,
  );

  return (
    <ChainOfThought>
      <ChainOfThoughtHeader>
        {previousPartCount} previous {previousPartCount === 1 ? "message" : "messages"}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {items.map((item) =>
          item.kind === "tool-group" ? (
            <ToolCallThoughtGroup
              key={item.key}
              groupId={item.key}
              parts={item.parts}
            />
          ) : (
            <div key={item.key} className="text-foreground">
              <MessageParts
                messageId={item.key}
                parts={[item.part]}
                renderAuxiliaryParts
              />
            </div>
          ),
        )}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}

function getAssistantThoughtRenderItems(
  messages: UIMessage[],
): AssistantThoughtRenderItem[] {
  const items: AssistantThoughtRenderItem[] = [];
  let pendingToolParts: (ToolUIPart | DynamicToolUIPart)[] = [];
  let pendingToolGroupKey = "";

  const flushToolGroup = () => {
    if (!pendingToolParts.length) return;

    items.push({
      kind: "tool-group",
      key: pendingToolGroupKey,
      parts: pendingToolParts,
    });
    pendingToolParts = [];
    pendingToolGroupKey = "";
  };

  for (const message of messages) {
    const parts = getVisibleAssistantParts(message.parts, true);

    for (const [index, part] of parts.entries()) {
      const key = `${message.id}-thought-${index}`;

      if (isToolPart(part)) {
        if (!pendingToolParts.length) {
          pendingToolGroupKey = `${key}-tool-group`;
        }
        pendingToolParts.push(part);
        continue;
      }

      flushToolGroup();
      items.push({ kind: "part", key, part });
    }
  }

  flushToolGroup();

  return items;
}

function ToolCallThoughtGroup({
  groupId,
  parts,
}: {
  groupId: string;
  parts: (ToolUIPart | DynamicToolUIPart)[];
}) {
  return (
    <ChainOfThought>
      <ChainOfThoughtHeader>
        Ran {parts.length} {parts.length === 1 ? "command" : "commands"}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {parts.map((part, index) => (
          <ToolThoughtPart key={`${groupId}-${part.toolCallId ?? index}`} part={part} />
        ))}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}

const thoughtMessageClassName =
  "text-muted-foreground/65 text-xs [&_p]:my-1 [&_pre]:my-1 [&_ul]:my-1 [&_ol]:my-1";

function CollapsibleThoughtMessage({
  className,
  defaultOpen = false,
  onOpenChange,
  open,
  text,
  title,
}: {
  className?: string;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  text: string;
  title: string;
}) {
  return (
    <ChainOfThought
      className={className}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      open={open}
    >
      <ChainOfThoughtHeader>{title}</ChainOfThoughtHeader>
      {text && (
        <ChainOfThoughtContent>
          <MessageResponse className={thoughtMessageClassName}>
            {text}
          </MessageResponse>
        </ChainOfThoughtContent>
      )}
    </ChainOfThought>
  );
}

function ToolThoughtPart({
  onOpenChange,
  open,
  part,
}: {
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  part: ToolUIPart | DynamicToolUIPart;
}) {
  const denialText =
    part.state === "approval-responded" && part.approval?.approved === false
      ? part.approval?.reason ?? "You denied this tool call."
      : null;

  return (
    <Tool onOpenChange={onOpenChange} open={open}>
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
          <ToolOutput
            errorText={part.errorText}
            input={part.input}
            output={part.output}
            toolName={part.toolName}
          />
        )}
      </ToolContent>
    </Tool>
  );
}

function MessageParts({
  incrementalTextParts = false,
  messageId,
  onAccordionOpenChange,
  openAccordions,
  parts,
  renderAuxiliaryParts = false,
}: {
  incrementalTextParts?: boolean;
  messageId: string;
  onAccordionOpenChange?: (id: string, open: boolean) => void;
  openAccordions?: Record<string, boolean>;
  parts: UIMessagePart[];
  renderAuxiliaryParts?: boolean;
}) {
  return (
    <>
      {parts.map((part, i) => {
        const accordionId = `${part.type}-${i}`;
        const key = `${messageId}-response-${accordionId}`;

        return (
          <MessagePart
            key={key}
            accordionId={accordionId}
            id={key}
            incrementalTextParts={incrementalTextParts}
            isActive={i === parts.length - 1}
            onAccordionOpenChange={onAccordionOpenChange}
            open={openAccordions?.[accordionId] ?? false}
            part={part}
            renderAuxiliaryParts={renderAuxiliaryParts}
          />
        );
      })}
    </>
  );
}

type MessagePartProps = {
  accordionId: string;
  id: string;
  incrementalTextParts: boolean;
  isActive: boolean;
  onAccordionOpenChange?: (id: string, open: boolean) => void;
  open: boolean;
  part: UIMessagePart;
  renderAuxiliaryParts: boolean;
};

const MessagePart = memo(
  function MessagePart({
    accordionId,
    id,
    incrementalTextParts,
    isActive,
    onAccordionOpenChange,
    open,
    part,
    renderAuxiliaryParts,
  }: MessagePartProps) {
    const handleOpenChange = useCallback(
      (nextOpen: boolean) => onAccordionOpenChange?.(accordionId, nextOpen),
      [accordionId, onAccordionOpenChange],
    );

    if (part.type === "text") {
      return part.text ? (
        incrementalTextParts ? (
          <IncrementalMessageResponse text={part.text} />
        ) : (
          <MessageResponse>{part.text}</MessageResponse>
        )
      ) : null;
    }

    if (part.type === "file") {
      return <FileAttachment id={id} part={part} />;
    }

    if (renderAuxiliaryParts && part.type === "reasoning") {
      return (
        <InlineReasoningPart
          isActive={isActive}
          onOpenChange={handleOpenChange}
          open={open}
          text={part.text}
        />
      );
    }

    if (renderAuxiliaryParts && isToolPart(part)) {
      return (
        <ToolThoughtPart
          onOpenChange={handleOpenChange}
          open={open}
          part={part}
        />
      );
    }

    return null;
  },
  areMessagePartPropsEqual,
);

MessagePart.displayName = "MessagePart";

function areMessagePartPropsEqual(prev: MessagePartProps, next: MessagePartProps) {
  return (
    prev.accordionId === next.accordionId &&
    prev.id === next.id &&
    prev.incrementalTextParts === next.incrementalTextParts &&
    prev.isActive === next.isActive &&
    prev.onAccordionOpenChange === next.onAccordionOpenChange &&
    prev.open === next.open &&
    prev.renderAuxiliaryParts === next.renderAuxiliaryParts &&
    getPartRenderSignature(prev.part) === getPartRenderSignature(next.part)
  );
}

function getPartRenderSignature(part: UIMessagePart) {
  if (part.type === "text" || part.type === "reasoning") {
    return `${part.type}:${part.text}`;
  }

  if (part.type === "file") {
    return [
      part.type,
      part.url,
      part.mediaType,
      part.filename,
      part.fileId,
      part.extractedText,
    ].join("\u0000");
  }

  if (isToolPart(part)) {
    return [
      part.type,
      part.state,
      part.toolCallId,
      part.toolName,
      safeRenderStringify(part.input),
      safeRenderStringify(part.output),
      part.errorText,
      part.approval?.id,
      part.approval?.approved,
      part.approval?.reason,
    ].join("\u0000");
  }

  return part.type;
}

function safeRenderStringify(value: unknown) {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const FrozenMarkdownSegment = memo(
  function FrozenMarkdownSegment({ text }: { text: string }) {
    return <MessageResponse>{text}</MessageResponse>;
  },
  (prev, next) => prev.text === next.text,
);

FrozenMarkdownSegment.displayName = "FrozenMarkdownSegment";

function IncrementalMessageResponse({ text }: { text: string }) {
  const { committed, live } = useIncrementalMarkdownSegments(text);

  return (
    <>
      {committed.map((segment, index) => (
        <FrozenMarkdownSegment key={index} text={segment} />
      ))}
      {live ? <MessageResponse>{live}</MessageResponse> : null}
    </>
  );
}

function useIncrementalMarkdownSegments(text: string) {
  const stateRef = useRef({
    committed: [] as string[],
    live: "",
    seen: "",
  });

  return useMemo(() => {
    const state = stateRef.current;

    if (text.startsWith(state.seen)) {
      state.live += text.slice(state.seen.length);
    } else {
      state.committed = [];
      state.live = text;
    }

    state.seen = text;

    const commitIndex = findStreamingCommitIndex(state.live);
    if (commitIndex > 0) {
      state.committed = [...state.committed, state.live.slice(0, commitIndex)];
      state.live = state.live.slice(commitIndex);
    }

    return {
      committed: state.committed,
      live: state.live,
    };
  }, [text]);
}

function findStreamingCommitIndex(text: string) {
  let inFence = false;
  let lineStart = 0;
  let commitIndex = 0;

  for (let index = 0; index < text.length;) {
    const nextLineBreak = text.indexOf("\n", index);
    const lineEnd = nextLineBreak === -1 ? text.length : nextLineBreak;
    const line = text.slice(lineStart, lineEnd).trimStart();

    if (line.startsWith("```") || line.startsWith("~~~")) {
      inFence = !inFence;
    }

    if (!inFence && nextLineBreak !== -1 && text[nextLineBreak + 1] === "\n") {
      commitIndex = nextLineBreak + 2;
      index = commitIndex;
      lineStart = index;
      continue;
    }

    if (nextLineBreak === -1) {
      break;
    }

    index = nextLineBreak + 1;
    lineStart = index;
  }

  return commitIndex;
}

function InlineReasoningPart({
  isActive,
  onOpenChange,
  open,
  text,
}: {
  isActive: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  text: string;
}) {
  return (
    <CollapsibleThoughtMessage
      defaultOpen={false}
      onOpenChange={onOpenChange}
      open={open}
      text={text}
      title={isActive ? "Thinking" : "Thought"}
    />
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
