import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@g-spot/ui/components/dropdown-menu";
import { Plus, Sparkles, TerminalSquare } from "lucide-react";

type NewTabMenuProps = {
  onNewChat: () => void;
  onNewTerminal: () => void;
  disabled?: boolean;
};

export function NewTabMenu({ onNewChat, onNewTerminal, disabled }: NewTabMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label="New tab"
        className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
      >
        <Plus className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-48">
        <DropdownMenuItem onClick={onNewChat}>
          <Sparkles />
          <span>Chat</span>
          <DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onNewTerminal}>
          <TerminalSquare />
          <span>Terminal</span>
          <DropdownMenuShortcut>⌘⇧T</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
