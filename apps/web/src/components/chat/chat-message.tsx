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
import type {
  AssistantThoughtRenderItem,
  ThoughtGroupEntry,
} from "@/lib/chat-render-model";
import {
  registerPartRenderer,
  renderPart,
} from "@/components/chat/part-renderer-registry";

interface ChatMessageProps {
  message: UIMessage;
  variant: "final" | "streaming";
  /** Pre-derived visible parts of an assistant turn. Required for variant="final". */
  responseParts?: UIMessagePart[];
  /** Pre-joined assistant text used by the copy action. */
  copyText?: string;
  /** Pre-grouped previous-turn thoughts. `null` means no thoughts panel. */
  thoughtItems?: AssistantThoughtRenderItem[] | null;
  /** Pre-joined user text used by the edit textarea. */
  userText?: string;
  showThoughts?: boolean;
  onReload?: () => void;
  onEdit?: (newText: string) => void;
  onFork?: () => void;
}

function isToolPart(part: UIMessagePart): part is ToolUIPart | DynamicToolUIPart {
  return "state" in part && (part.type === "dynamic-tool" || part.type.startsWith("tool-"));
}

function joinUserText(parts: UIMessagePart[]) {
  let out = "";
  for (const p of parts) {
    if (p.type === "text") out += p.text;
  }
  return out;
}

function isReasoningPart(
  part: UIMessagePart,
): part is Extract<UIMessagePart, { type: "reasoning" }> {
  return part.type === "reasoning";
}

export const ChatMessage = memo(function ChatMessage({
  message,
  variant,
  responseParts,
  copyText,
  thoughtItems,
  userText,
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
            text={userText}
            onEdit={onEdit}
            onFork={onFork}
          />
        ) : (
          <AssistantMessageBubble
            message={message}
            responseParts={responseParts}
            copyText={copyText}
            thoughtItems={thoughtItems}
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
  text,
  onEdit,
  onFork,
}: {
  message: UIMessage;
  text?: string;
  onEdit?: (newText: string) => void;
  onFork?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentText = text ?? joinUserText(message.parts);
  const displayParts = useMemo(
    () => orderUserMessagePartsForDisplay(message.parts),
    [message.parts],
  );

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
        <MessageParts messageId={message.id} parts={displayParts} />
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
  responseParts: responsePartsProp,
  copyText: copyTextProp,
  thoughtItems: thoughtItemsProp,
  variant,
  showActions,
  showThoughts,
  onReload,
  onFork,
}: {
  message: UIMessage;
  responseParts?: UIMessagePart[];
  copyText?: string;
  thoughtItems?: AssistantThoughtRenderItem[] | null;
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
    () =>
      responsePartsProp ??
      getVisibleAssistantParts(message.parts, showPersistedThoughts),
    [responsePartsProp, message.parts, showPersistedThoughts],
  );

  const handleCopy = useCallback(() => {
    const text = copyTextProp ?? joinUserText(message.parts);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [copyTextProp, message.parts]);

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
            {showPersistedThoughts && thoughtItemsProp && thoughtItemsProp.length > 0 ? (
              <AssistantThoughts items={thoughtItemsProp} />
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

function orderUserMessagePartsForDisplay(parts: UIMessagePart[]) {
  const textParts: UIMessagePart[] = [];
  const fileParts: UIMessagePart[] = [];
  const otherParts: UIMessagePart[] = [];

  for (const part of parts) {
    if (part.type === "text") {
      textParts.push(part);
    } else if (part.type === "file") {
      fileParts.push(part);
    } else {
      otherParts.push(part);
    }
  }

  return [...textParts, ...fileParts, ...otherParts];
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

function AssistantThoughts({ items }: { items: AssistantThoughtRenderItem[] }) {
  const previousPartCount = items.reduce(
    (count, item) =>
      count + (item.kind === "tool-group" ? item.entries.length : 1),
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
              entries={item.entries}
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

function ToolCallThoughtGroup({
  groupId,
  entries,
}: {
  groupId: string;
  entries: ThoughtGroupEntry[];
}) {
  const toolCount = entries.filter((entry) => isToolPart(entry.part)).length;

  return (
    <ChainOfThought>
      <ChainOfThoughtHeader>
        Ran {toolCount} {toolCount === 1 ? "command" : "commands"}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {entries.map((entry, index) => {
          const entryKey = isToolPart(entry.part)
            ? `${groupId}-${entry.part.toolCallId ?? index}`
            : `${groupId}-${entry.key}`;

          if (isReasoningPart(entry.part)) {
            return (
              <CollapsibleThoughtMessage
                key={entryKey}
                text={entry.part.text}
                title="Thought"
              />
            );
          }

          return <ToolThoughtPart key={entryKey} part={entry.part} />;
        })}
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

    return renderPart(part, {
      id,
      accordionId,
      isActive,
      open,
      onOpenChange: handleOpenChange,
      incrementalTextParts,
      renderAuxiliaryParts,
    });
  },
  areMessagePartPropsEqual,
);

registerPartRenderer(
  (part): part is Extract<UIMessagePart, { type: "text" }> =>
    part.type === "text",
  (part, ctx) => {
    if (!part.text) return null;
    return ctx.incrementalTextParts ? (
      <IncrementalMessageResponse text={part.text} />
    ) : (
      <MessageResponse>{part.text}</MessageResponse>
    );
  },
);

registerPartRenderer(
  (part): part is FileUIPart => part.type === "file",
  (part, ctx) => <FileAttachment id={ctx.id} part={part} />,
);

registerPartRenderer(
  (part): part is Extract<UIMessagePart, { type: "reasoning" }> =>
    part.type === "reasoning",
  (part, ctx) =>
    ctx.renderAuxiliaryParts ? (
      <InlineReasoningPart
        isActive={ctx.isActive}
        onOpenChange={ctx.onOpenChange}
        open={ctx.open}
        text={part.text}
      />
    ) : null,
);

registerPartRenderer(isToolPart, (part, ctx) =>
  ctx.renderAuxiliaryParts ? (
    <ToolThoughtPart
      onOpenChange={ctx.onOpenChange}
      open={ctx.open}
      part={part}
    />
  ) : null,
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
    arePartsEqual(prev.part, next.part)
  );
}

function arePartsEqual(a: UIMessagePart, b: UIMessagePart) {
  if (a === b) return true;
  if (a.type !== b.type) return false;

  if (a.type === "text" || a.type === "reasoning") {
    return a.text === (b as typeof a).text;
  }

  if (a.type === "file") {
    const fb = b as typeof a;
    return (
      a.url === fb.url &&
      a.mediaType === fb.mediaType &&
      a.filename === fb.filename &&
      a.fileId === fb.fileId &&
      a.extractedText === fb.extractedText
    );
  }

  if (isToolPart(a) && isToolPart(b)) {
    return (
      a.state === b.state &&
      a.toolCallId === b.toolCallId &&
      a.toolName === b.toolName &&
      a.input === b.input &&
      a.output === b.output &&
      a.errorText === b.errorText &&
      a.approval?.id === b.approval?.id &&
      a.approval?.approved === b.approval?.approved &&
      a.approval?.reason === b.approval?.reason
    );
  }

  return false;
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

type IncrementalSegments = {
  committed: string[];
  live: string;
};

/** Once committed segments exceed this, the oldest are merged into one frozen
 * chunk to bound React reconciliation work for long streams. */
const MAX_COMMITTED_SEGMENTS = 8;

type IncrementalScanState = {
  seen: string;
  /** The accumulated unfinished tail. */
  live: string;
  /** Where the next scan should resume in `live`. */
  scanIndex: number;
  /** Start of the current (possibly partial) line within `live`. */
  scanLineStart: number;
  /** Whether the current scan position is inside a fenced code block. */
  inFence: boolean;
  committed: string[];
  result: IncrementalSegments;
};

function freshScanState(): IncrementalScanState {
  return {
    seen: "",
    live: "",
    scanIndex: 0,
    scanLineStart: 0,
    inFence: false,
    committed: [],
    result: { committed: [], live: "" },
  };
}

function useIncrementalMarkdownSegments(text: string): IncrementalSegments {
  const stateRef = useRef<IncrementalScanState | null>(null);
  if (!stateRef.current) stateRef.current = freshScanState();
  const state = stateRef.current;

  if (text === state.seen) return state.result;

  if (!text.startsWith(state.seen)) {
    // Stream reset: start over.
    state.seen = "";
    state.live = "";
    state.scanIndex = 0;
    state.scanLineStart = 0;
    state.inFence = false;
    state.committed = [];
  }

  state.live += text.slice(state.seen.length);
  state.seen = text;

  let commitIndex = 0;
  let i = state.scanIndex;
  let lineStart = state.scanLineStart;

  while (i < state.live.length) {
    const nextLineBreak = state.live.indexOf("\n", i);
    if (nextLineBreak === -1) break; // Partial line: defer until a newline arrives.

    const line = state.live.slice(lineStart, nextLineBreak).trimStart();
    if (line.startsWith("```") || line.startsWith("~~~")) {
      state.inFence = !state.inFence;
    }

    if (!state.inFence && state.live[nextLineBreak + 1] === "\n") {
      commitIndex = nextLineBreak + 2;
      i = commitIndex;
      lineStart = i;
      continue;
    }

    i = nextLineBreak + 1;
    lineStart = i;
  }

  if (commitIndex > 0) {
    state.committed = [...state.committed, state.live.slice(0, commitIndex)];
    state.live = state.live.slice(commitIndex);
    state.scanIndex = 0;
    state.scanLineStart = 0;

    if (state.committed.length > MAX_COMMITTED_SEGMENTS) {
      // Merge the older half into one frozen chunk so React only reconciles
      // a handful of <FrozenMarkdownSegment> nodes regardless of stream length.
      const mergeUpTo = Math.floor(state.committed.length / 2);
      const merged = state.committed.slice(0, mergeUpTo).join("");
      state.committed = [merged, ...state.committed.slice(mergeUpTo)];
    }
  } else {
    // No newline past `i` in the current buffer — resume past it next time.
    state.scanIndex = state.live.length;
    state.scanLineStart = lineStart;
  }

  state.result = { committed: state.committed, live: state.live };
  return state.result;
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
  const kind = getFileKind(preview);
  const isImagePreview = isImageFile(preview);
  const canPreview = isImagePreview || !!preview.text || !!preview.fileId;

  const loadPreview = useCallback(async () => {
    if (isImagePreview || preview.text || !preview.fileId) {
      return;
    }

    setPreviewLoading(true);
    setPreviewError("");

    try {
      const response = await fetch(
        `${env.VITE_SERVER_URL}/api/files/${preview.fileId}/extracted-text`,
      );
      if (!response.ok) {
        throw new Error(await readPreviewError(response));
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
  }, [isImagePreview, preview.fileId, preview.text]);

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
            ) : isImagePreview ? (
              <div className="min-h-0 overflow-auto p-4">
                <img
                  alt={preview.filename}
                  className="mx-auto max-h-[calc(100vh-10rem)] max-w-full rounded-md object-contain"
                  src={preview.url}
                />
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
  url?: string;
};

function getFilePreviewFromPart(part: FileUIPart): FilePreview {
  return {
    fileId: part.fileId,
    filename: part.filename ?? "attachment",
    mediaType: part.mediaType,
    text: part.extractedText ?? "",
    url: part.url,
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

function isImageFile(file: Pick<FilePreview, "mediaType" | "url">) {
  return !!file.url && file.mediaType?.startsWith("image/");
}

async function readPreviewError(response: Response) {
  const text = await response.text();
  try {
    const value = JSON.parse(text) as { error?: unknown };
    if (typeof value.error === "string") return value.error;
  } catch {
    // Keep the raw response below.
  }
  return text || "Could not load preview";
}

function formatPreviewDescription(
  preview: Pick<FilePreview, "localPath" | "mediaType" | "url">,
  kind: string,
) {
  const label = isImageFile(preview)
    ? kind
      ? `${kind} image preview`
      : "Image preview"
    : kind
      ? `${kind} extracted text preview`
      : "Extracted text preview";
  return preview.localPath ? `${label} · ${preview.localPath}` : label;
}
