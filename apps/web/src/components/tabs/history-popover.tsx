import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@g-spot/ui/components/popover";
import { cn } from "@g-spot/ui/lib/utils";
import { History, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { useChats } from "@/hooks/use-chat-data";
import { useOpenChatTab } from "@/lib/tabs-store";

type HistoryPopoverProps = {
  projectId: string;
};

export function HistoryPopover({ projectId }: HistoryPopoverProps) {
  const [open, setOpen] = useState(false);
  const chatsQuery = useChats(open ? projectId : null);
  const openChat = useOpenChatTab();

  const chats = useMemo(
    () => chatsQuery.data?.pages.flatMap((p) => p.chats) ?? [],
    [chatsQuery.data],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Recent chats"
        className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <History className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-0 p-1">
        <div className="px-2 pb-2 pt-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Recent chats
        </div>
        <div className="max-h-80 overflow-y-auto">
          {chatsQuery.isLoading ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">Loading…</div>
          ) : chats.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">No chats yet.</div>
          ) : (
            chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => {
                  openChat(projectId, chat.id, chat.title || "Untitled");
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                  "hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Sparkles className="size-3 shrink-0 opacity-60" />
                <span className="min-w-0 flex-1 truncate">
                  {chat.title || "Untitled"}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
