import type { PiWorkMode } from "@g-spot/types";
import { Button } from "@g-spot/ui/components/button";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@g-spot/ui/components/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@g-spot/ui/components/popover";
import { ChevronDownIcon, GitBranchIcon, MonitorIcon } from "lucide-react";
import { useState } from "react";

import { WORK_MODE_OPTIONS } from "@/lib/pi-agent-config";

type ChatWorkModeSelectProps = {
  value: PiWorkMode;
  onValueChange: (value: PiWorkMode) => void;
  disabled?: boolean;
};

function getLabel(value: PiWorkMode) {
  return WORK_MODE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function ChatWorkModeSelect({
  value,
  onValueChange,
  disabled = false,
}: ChatWorkModeSelectProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            disabled={disabled}
          />
        }
      >
        {value === "local" ? <MonitorIcon /> : <GitBranchIcon />}
        <span className="truncate">{getLabel(value)}</span>
        <ChevronDownIcon className="opacity-60" />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-44 overflow-hidden p-0"
        sideOffset={6}
      >
        <Command className="bg-transparent">
          <CommandList>
            <CommandGroup className="p-1">
              {WORK_MODE_OPTIONS.map((option) => {
                const isSelected = option.value === value;
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    data-checked={isSelected}
                    onSelect={() => {
                      setOpen(false);
                      if (isSelected) return;
                      onValueChange(option.value as PiWorkMode);
                    }}
                  >
                    {option.value === "local" ? (
                      <MonitorIcon className="text-muted-foreground" />
                    ) : (
                      <GitBranchIcon className="text-muted-foreground" />
                    )}
                    <span>{option.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
