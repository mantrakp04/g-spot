import { TableCell, TableRow } from "@g-spot/ui/components/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@g-spot/ui/components/tooltip";
import { cn } from "@g-spot/ui/lib/utils";
import { Paperclip } from "lucide-react";

import type { GmailThread } from "@/lib/gmail/types";
import { GmailSenderAvatar } from "./gmail-sender-avatar";

function formatDate(date: string): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);

  if (days === 0) {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;

  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

type GmailThreadRowProps = {
  thread: GmailThread;
  isSelected?: boolean;
  onClick?: (thread: GmailThread) => void;
};

export function GmailThreadRow({ thread, isSelected, onClick }: GmailThreadRowProps) {
  return (
    <TableRow
      className={cn("group cursor-pointer", isSelected && "bg-accent")}
      onClick={() => onClick?.(thread)}
    >
      {/* Unread indicator + Avatar + From */}
      <TableCell className="w-48 min-w-[10rem] pl-3">
        <div className="flex items-center gap-2.5">
          <div className="flex shrink-0 items-center gap-2">
            {thread.isUnread ? (
              <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />
            ) : (
              <span className="size-1.5 shrink-0 rounded-full bg-transparent" />
            )}
            <GmailSenderAvatar
              size="sm"
              name={thread.from.name}
              email={thread.from.email}
              avatarUrl={thread.avatarUrl}
            />
          </div>
          <Tooltip>
            <TooltipTrigger render={
              <span
                className={cn(
                  "truncate text-sm",
                  thread.isUnread ? "font-medium" : "text-muted-foreground",
                )}
              >
                {thread.from.name}
              </span>
            } />
            <TooltipContent side="bottom" align="start">
              {thread.from.name} &lt;{thread.from.email}&gt;
            </TooltipContent>
          </Tooltip>
        </div>
      </TableCell>

      {/* Subject + snippet */}
      <TableCell className="w-full max-w-0">
        <div className="flex items-center gap-2 overflow-hidden">
          <span
            className={cn(
              "shrink-0 text-sm",
              thread.isUnread ? "font-medium" : "text-muted-foreground",
            )}
          >
            {thread.subject}
          </span>
          {thread.snippet && (
            <span className="hidden min-w-0 truncate text-xs text-muted-foreground/60 lg:inline">
              &mdash; {thread.snippet}
            </span>
          )}
        </div>
      </TableCell>

      {/* Attachment indicator */}
      <TableCell className="hidden sm:table-cell">
        {thread.hasAttachment && (
          <Paperclip className="size-3 text-muted-foreground" />
        )}
      </TableCell>

      {/* Date */}
      <TableCell className="pr-3 text-right">
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDate(thread.date)}
        </span>
      </TableCell>
    </TableRow>
  );
}
