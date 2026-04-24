import { Button } from "@g-spot/ui/components/button";
import { cn } from "@g-spot/ui/lib/utils";
import { CheckIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";

import type { DynamicToolUIPart, ToolUIPart, UIMessage, UIMessagePart } from "@/lib/chat-ui";
import { combineActiveStreamingMessages } from "@/lib/chat-active-turn";
import {
  getStreamingMessage,
  subscribeStreamingMessage,
} from "@/lib/streaming-message-store";

type PendingApproval = {
  toolCallId: string;
  toolName: string;
  reason?: string;
  input?: unknown;
};

function formatScalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  return JSON.stringify(value);
}

function formatParams(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (value === undefined) return "";
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value
      .map((item) => {
        if (item !== null && typeof item === "object") {
          return `${pad}-\n${formatParams(item, indent + 1)}`;
        }
        return `${pad}- ${formatScalar(item)}`;
      })
      .join("\n");
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${pad}{}`;
    return entries
      .map(([k, v]) => {
        if (v !== null && typeof v === "object") {
          return `${pad}${k}:\n${formatParams(v, indent + 1)}`;
        }
        return `${pad}${k}: ${formatScalar(v)}`;
      })
      .join("\n");
  }
  return `${pad}${formatScalar(value)}`;
}

type ChatPendingApprovalsProps = {
  chatId: string | null;
  className?: string;
  messages: readonly UIMessage[];
  activeMessages?: readonly UIMessage[];
  onResolveApproval: (
    toolCallId: string,
    approved: boolean,
    reason?: string,
  ) => void | Promise<void>;
};

function isToolPart(part: UIMessagePart): part is ToolUIPart | DynamicToolUIPart {
  return (
    "state" in part &&
    (part.type === "dynamic-tool" || part.type.startsWith("tool-"))
  );
}

function collectPending(message: UIMessage | null, seen: Set<string>, out: PendingApproval[]) {
  if (!message) return;
  for (const part of message.parts) {
    if (!isToolPart(part)) continue;
    if (part.state !== "approval-requested") continue;
    const toolCallId = part.toolCallId;
    if (!toolCallId || seen.has(toolCallId)) continue;
    seen.add(toolCallId);
    const toolName =
      part.toolName ??
      (part.type.startsWith("tool-") ? part.type.slice("tool-".length) : "tool");
    out.push({
      toolCallId,
      toolName,
      reason: part.approval?.reason,
      input: part.input,
    });
  }
}

export function ChatPendingApprovals({
  chatId,
  className,
  messages,
  activeMessages = [],
  onResolveApproval,
}: ChatPendingApprovalsProps) {
  const streaming = useSyncExternalStore(
    (listener) =>
      chatId ? subscribeStreamingMessage(chatId, listener) : () => {},
    () => (chatId ? getStreamingMessage(chatId) : null),
    () => null,
  );

  const pending = useMemo(() => {
    const seen = new Set<string>();
    const out: PendingApproval[] = [];
    for (const m of messages) collectPending(m, seen, out);
    collectPending(
      combineActiveStreamingMessages(activeMessages, streaming),
      seen,
      out,
    );
    return out;
  }, [messages, activeMessages, streaming]);

  if (pending.length === 0) return null;

  return (
    <div className={cn("mx-auto w-full max-w-2xl", className)}>
      <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
        {pending.map((p) => {
          const paramsText = formatParams(p.input);
          return (
            <div
              key={p.toolCallId}
              className="flex flex-col gap-2 rounded-sm px-1.5 py-1"
            >
              <div className="flex items-start gap-2">
                <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-xs font-medium text-foreground">
                    {p.toolName}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {p.reason ?? "Approve this tool call before it can run?"}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    className="gap-1 text-xs"
                    onClick={() =>
                      void onResolveApproval(p.toolCallId, false, "User denied.")
                    }
                  >
                    <XIcon className="size-3" />
                    Deny
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    className="gap-1 text-xs"
                    onClick={() => void onResolveApproval(p.toolCallId, true)}
                  >
                    <CheckIcon className="size-3" />
                    Approve
                  </Button>
                </div>
              </div>
              {paramsText ? (
                <pre className="max-h-48 overflow-auto rounded-sm border border-border/50 bg-background/60 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words font-mono">
                  {paramsText}
                </pre>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
