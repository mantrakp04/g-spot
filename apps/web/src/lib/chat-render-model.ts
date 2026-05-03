import type {
  DynamicToolUIPart,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
} from "@/lib/chat-ui";

function isToolPart(
  part: UIMessagePart,
): part is ToolUIPart | DynamicToolUIPart {
  return (
    "state" in part &&
    (part.type === "dynamic-tool" || part.type.startsWith("tool-"))
  );
}

export type ThoughtGroupEntry = {
  key: string;
  part:
    | ToolUIPart
    | DynamicToolUIPart
    | Extract<UIMessagePart, { type: "reasoning" }>;
};

export type AssistantThoughtRenderItem =
  | { kind: "part"; key: string; part: UIMessagePart }
  | { kind: "tool-group"; key: string; entries: ThoughtGroupEntry[] };

export type PendingApprovalRef = {
  toolCallId: string;
  toolName: string;
  reason?: string;
  input?: unknown;
};

export type PreparedUserEntry = {
  kind: "user";
  message: UIMessage;
  index: number;
  text: string;
};

export type PreparedAssistantEntry = {
  kind: "assistant-turn";
  message: UIMessage;
  firstIndex: number;
  lastIndex: number;
  responseParts: UIMessagePart[];
  copyText: string;
  thoughtItems: AssistantThoughtRenderItem[] | null;
};

export type PreparedEntry = PreparedUserEntry | PreparedAssistantEntry;

export type ChatRenderState = {
  finalEntries: PreparedEntry[];
  streamingMessages: UIMessage[];
  pendingApprovals: PendingApprovalRef[];
  lastAssistantTurnStartIndex: number;
};

function isResponsePart(part: UIMessagePart): boolean {
  return (part.type === "text" && Boolean(part.text)) || part.type === "file";
}

function isThoughtPart(
  part: UIMessagePart,
): part is ThoughtGroupEntry["part"] {
  return part.type === "reasoning" || isToolPart(part);
}

function visibleAssistantParts(
  parts: UIMessagePart[],
  includeAuxiliary: boolean,
): UIMessagePart[] {
  return parts.filter(
    (part) => isResponsePart(part) || (includeAuxiliary && isThoughtPart(part)),
  );
}

function joinTextParts(parts: UIMessagePart[]): string {
  let out = "";
  for (const p of parts) {
    if (p.type === "text") out += p.text;
  }
  return out;
}

function buildThoughtItems(
  turnMessages: UIMessage[],
  responseMessageId: string,
): AssistantThoughtRenderItem[] {
  const items: AssistantThoughtRenderItem[] = [];
  let group: ThoughtGroupEntry[] = [];
  let groupKey = "";
  let groupHasTool = false;

  const flushGroup = () => {
    if (!group.length) return;
    if (groupHasTool) {
      items.push({ kind: "tool-group", key: groupKey, entries: group });
    } else {
      for (const entry of group) {
        items.push({ kind: "part", key: entry.key, part: entry.part });
      }
    }
    group = [];
    groupKey = "";
    groupHasTool = false;
  };

  for (const message of turnMessages) {
    for (let i = 0; i < message.parts.length; i += 1) {
      const part = message.parts[i]!;
      const key = `${message.id}-thought-${i}`;

      if (isThoughtPart(part)) {
        if (!group.length) groupKey = `${key}-tool-group`;
        group.push({ key, part });
        groupHasTool ||= isToolPart(part);
        continue;
      }

      flushGroup();

      // The final assistant message owns the visible answer. Earlier visible
      // response parts are still part of the persisted thought/history block.
      if (message.id !== responseMessageId && isResponsePart(part)) {
        items.push({ kind: "part", key, part });
      }
    }
  }

  flushGroup();
  return items;
}

function collectPendingApprovals(
  messages: readonly UIMessage[],
  seen: Set<string>,
  out: PendingApprovalRef[],
) {
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolPart(part)) continue;
      if (part.state !== "approval-requested") continue;
      const toolCallId = part.toolCallId;
      if (!toolCallId || seen.has(toolCallId)) continue;
      seen.add(toolCallId);
      const toolName =
        part.toolName ??
        (part.type.startsWith("tool-")
          ? part.type.slice("tool-".length)
          : "tool");
      out.push({
        toolCallId,
        toolName,
        reason: part.approval?.reason,
        input: part.input,
      });
    }
  }
}

export function collectPendingApprovalsFrom(
  ...buckets: ReadonlyArray<readonly UIMessage[] | UIMessage | null | undefined>
): PendingApprovalRef[] {
  const seen = new Set<string>();
  const out: PendingApprovalRef[] = [];
  for (const bucket of buckets) {
    if (!bucket) continue;
    if (Array.isArray(bucket)) {
      collectPendingApprovals(bucket, seen, out);
    } else {
      collectPendingApprovals([bucket as UIMessage], seen, out);
    }
  }
  return out;
}

function makeAssistantEntry(
  turnMessages: UIMessage[],
  firstIndex: number,
  lastIndex: number,
  showPersistedThoughts: boolean,
): PreparedAssistantEntry {
  const last = turnMessages[turnMessages.length - 1]!;
  const responseParts = visibleAssistantParts(last.parts, false);
  const copyText = joinTextParts(last.parts);
  const thoughtItems = showPersistedThoughts
    ? buildThoughtItems(turnMessages, last.id)
    : null;
  return {
    kind: "assistant-turn",
    message: last,
    firstIndex,
    lastIndex,
    responseParts,
    copyText,
    thoughtItems,
  };
}

export type CreateChatRenderStateOptions = {
  isActiveTurn: boolean;
  /** When true, finalized assistant turns include grouped thought items. */
  showPersistedThoughts?: boolean;
};

/**
 * Single forward pass over `messages` producing everything the UI needs:
 * finalized render entries (with derived parts/text/thought items already
 * prepared), the active-turn streaming tail, pending approvals, and the
 * starting index of the last assistant turn.
 */
export function createChatRenderState(
  messages: UIMessage[],
  options: CreateChatRenderStateOptions,
): ChatRenderState {
  const { isActiveTurn, showPersistedThoughts = true } = options;

  const finalEntries: PreparedEntry[] = [];
  const seenApprovals = new Set<string>();
  const pendingApprovals: PendingApprovalRef[] = [];

  let lastAssistantTurnStartIndex = -1;
  let i = 0;

  while (i < messages.length) {
    const message = messages[i]!;
    if (message.role !== "assistant") {
      collectPendingApprovals([message], seenApprovals, pendingApprovals);
      finalEntries.push({
        kind: "user",
        message,
        index: i,
        text: joinTextParts(message.parts),
      });
      i += 1;
      continue;
    }

    const firstIndex = i;
    const turn: UIMessage[] = [];
    while (i < messages.length && messages[i]!.role === "assistant") {
      const m = messages[i]!;
      collectPendingApprovals([m], seenApprovals, pendingApprovals);
      turn.push(m);
      i += 1;
    }
    lastAssistantTurnStartIndex = firstIndex;
    finalEntries.push(
      makeAssistantEntry(turn, firstIndex, i - 1, showPersistedThoughts),
    );
  }

  // Active turn: trailing assistant block (everything after the last user)
  // becomes streaming, removed from finalEntries.
  let streamingMessages: UIMessage[] = [];
  if (isActiveTurn) {
    let lastUserEntryIdx = -1;
    for (let j = finalEntries.length - 1; j >= 0; j -= 1) {
      if (finalEntries[j]!.kind === "user") {
        lastUserEntryIdx = j;
        break;
      }
    }

    if (lastUserEntryIdx === -1) {
      // No user yet — every assistant turn so far is "streaming".
      for (const e of finalEntries) {
        if (e.kind === "assistant-turn") {
          streamingMessages.push(...messages.slice(e.firstIndex, e.lastIndex + 1));
        }
      }
      finalEntries.length = 0;
    } else {
      const tail = finalEntries.splice(lastUserEntryIdx + 1);
      for (const e of tail) {
        if (e.kind === "assistant-turn") {
          streamingMessages.push(...messages.slice(e.firstIndex, e.lastIndex + 1));
        }
      }
    }
  }

  return {
    finalEntries,
    streamingMessages,
    pendingApprovals,
    lastAssistantTurnStartIndex,
  };
}

export function getLastAssistantTurnStartIndex(messages: UIMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "assistant") continue;
    let startIndex = index;
    while (startIndex > 0 && messages[startIndex - 1]?.role === "assistant") {
      startIndex -= 1;
    }
    return startIndex;
  }
  return -1;
}
