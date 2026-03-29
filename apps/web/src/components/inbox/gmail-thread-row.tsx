import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@g-spot/ui/components/avatar";
import { TableCell, TableRow } from "@g-spot/ui/components/table";
import { cn } from "@g-spot/ui/lib/utils";
import { Paperclip } from "lucide-react";

import type { GmailThread } from "@/lib/gmail/types";

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

export function GmailThreadRow({ thread }: { thread: GmailThread }) {
  return (
    <TableRow className="group cursor-pointer">
      {/* Unread indicator + Avatar + From */}
      <TableCell className="w-48 min-w-[10rem] pl-3">
        <div className="flex items-center gap-2.5">
          <div className="flex shrink-0 items-center gap-2">
            {thread.isUnread ? (
              <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />
            ) : (
              <span className="size-1.5 shrink-0 rounded-full bg-transparent" />
            )}
            <Avatar size="sm">
              <AvatarImage src={thread.avatarUrl ?? undefined} alt={thread.from.name} />
              <AvatarFallback>
                {thread.from.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
          <span
            className={cn(
              "truncate text-sm",
              thread.isUnread ? "font-medium" : "text-muted-foreground",
            )}
          >
            {thread.from.name}
          </span>
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
