import type { ReactNode } from "react";

import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@g-spot/ui/components/popover";
import { cn } from "@g-spot/ui/lib/utils";
import { DatabaseZap, SlidersHorizontal, Sparkles } from "lucide-react";

import { ChatModelPreferenceControl } from "@/components/chat/chat-model-preference-control";
import {
  CHAT_MODELS,
  useDefaultChatModelPreference,
  useDefaultWorkerModelPreference,
} from "@/hooks/use-chat-preferences";

export function ChatSidebarSettings() {
  const {
    defaultChatModel,
    setDefaultChatModel,
    isSaving: isSavingChatModel,
  } = useDefaultChatModelPreference();
  const {
    defaultWorkerModel,
    setDefaultWorkerModel,
    isSaving: isSavingWorkerModel,
  } = useDefaultWorkerModelPreference();
  const activeChatModel =
    CHAT_MODELS.find((model) => model.id === defaultChatModel) ?? CHAT_MODELS[0];
  const activeWorkerModel =
    CHAT_MODELS.find((model) => model.id === defaultWorkerModel) ?? CHAT_MODELS[0];

  return (
    <Popover>
      <PopoverTrigger
        render={(
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Chat settings"
          />
        )}
      >
        <SlidersHorizontal className="size-3" />
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="w-[20rem] gap-0 overflow-hidden rounded-sm border border-border/70 bg-popover p-0 shadow-xl"
      >
        <div className="border-b border-border/60 bg-[linear-gradient(180deg,rgba(127,127,127,0.10),rgba(127,127,127,0.02))] px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <PopoverHeader className="gap-1">
              <PopoverTitle className="flex items-center gap-1.5 text-sm">
                <Sparkles className="size-3.5 text-muted-foreground" />
                Chat settings
              </PopoverTitle>
              <PopoverDescription>
                Tune the model used for new chats and the worker used for automatic title refreshes.
              </PopoverDescription>
            </PopoverHeader>

            <Badge
              variant="secondary"
              className="rounded-full border border-border/60 bg-background/70 px-2 py-0 text-[10px] tracking-[0.14em] uppercase"
            >
              AI
            </Badge>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <SidebarChip>
              <Sparkles className="size-3" />
              New chats
            </SidebarChip>
            <SidebarChip>
              <Sparkles className="size-3" />
              Title worker
            </SidebarChip>
            <SidebarChip>
              <DatabaseZap className="size-3" />
              Stack metadata
            </SidebarChip>
          </div>
        </div>

        <div className="space-y-3 px-3 py-3">
          <div className="rounded-sm border border-border/60 bg-background/70 p-3">
            <ChatModelPreferenceControl
              fieldId="sidebar-default-chat-model"
              label="Default chat model"
              value={defaultChatModel}
              isSaving={isSavingChatModel}
              onChange={setDefaultChatModel}
              successMessage="Default chat model updated"
              errorMessage="Could not save default chat model"
              description="Fresh draft chats start on this model."
              triggerClassName="bg-background"
            />
          </div>

          <div className="rounded-sm border border-border/60 bg-background/70 p-3">
            <ChatModelPreferenceControl
              fieldId="sidebar-default-worker-model"
              label="Default worker model"
              value={defaultWorkerModel}
              isSaving={isSavingWorkerModel}
              onChange={setDefaultWorkerModel}
              successMessage="Default worker model updated"
              errorMessage="Could not save default worker model"
              description="Used when g-spot refreshes chat titles for you."
              triggerClassName="bg-background"
            />
          </div>

          <div className="grid gap-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
            <div className="flex items-center justify-between gap-3">
              <span>Chat default</span>
              <span className={cn("font-medium text-foreground/80")}>
                {activeChatModel.label}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Worker default</span>
              <span className={cn("font-medium text-foreground/80")}>
                {activeWorkerModel.label}
              </span>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SidebarChip({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-1 text-[10px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}
