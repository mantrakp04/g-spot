import { Sparkles } from "lucide-react";

import { Button } from "@g-spot/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@g-spot/ui/components/tooltip";
import { cn } from "@g-spot/ui/lib/utils";

export function SectionFilterAiButton({
  disabled,
  isPending,
  onClick,
}: {
  disabled?: boolean;
  isPending?: boolean;
  onClick: () => void;
}) {
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled || isPending}
              aria-label="Build filters with Pi"
              onClick={onClick}
              className={cn(
                "absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground hover:text-foreground",
                !disabled && !isPending && "animate-pulse",
              )}
            />
          }
        >
          <Sparkles className={cn("size-3.5", isPending && "animate-spin")} />
        </TooltipTrigger>
        <TooltipContent side="top">Build filters with Pi</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
