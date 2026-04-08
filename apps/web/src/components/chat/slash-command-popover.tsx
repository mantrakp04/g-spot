import { cn } from "@g-spot/ui/lib/utils";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { useSkillsForChat } from "@/hooks/use-skills-for-chat";
import {
  filterSlashCommands,
  mergeSlashCommands,
  parseSlashQuery,
  type BuiltinHandlers,
  type SlashCommand,
  type SlashCommandContext,
} from "@/lib/slash-commands";

interface SlashCommandPopoverProps {
  /** Current textarea value, observed via PromptInputProvider. */
  value: string;
  setValue: (next: string) => void;
  clearValue: () => void;
  projectId: string | null;
  chatId: string | null;
  handlers: BuiltinHandlers;
  /**
   * Element the popover is anchored above. The popover renders in a portal
   * outside of any backdrop-filter / opacity stacking context, and reads this
   * ref's bounding rect to position itself.
   */
  anchorRef: RefObject<HTMLElement | null>;
}

export interface SlashCommandPopoverHandle {
  /**
   * Forwarded keyboard handler. Must be called from the textarea's onKeyDown
   * BEFORE the textarea's own logic — call e.preventDefault() before returning
   * to suppress Enter-to-submit while the popover is steering input.
   */
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Whether the popover is currently visible (and capturing input). */
  isOpen: boolean;
}

type AnchorRect = { left: number; top: number; width: number };

export const SlashCommandPopover = forwardRef<
  SlashCommandPopoverHandle,
  SlashCommandPopoverProps
>(function SlashCommandPopover(
  { value, setValue, clearValue, projectId, chatId, handlers, anchorRef },
  ref,
) {
  const skillsQuery = useSkillsForChat(projectId);
  const skills = useMemo(() => skillsQuery.data ?? [], [skillsQuery.data]);

  const allCommands = useMemo(
    () => mergeSlashCommands(skills, projectId),
    [projectId, skills],
  );

  const slashState = parseSlashQuery(value);
  const commandContext: SlashCommandContext = useMemo(
    () => ({
      clearInput: clearValue,
      setInput: setValue,
      projectId,
      chatId,
      handlers,
    }),
    [clearValue, setValue, projectId, chatId, handlers],
  );

  const visibleCommands = useMemo(() => {
    if (!slashState) return [];
    const filtered = filterSlashCommands(allCommands, slashState.query);
    return filtered.filter((command) =>
      command.kind === "action" && command.isAvailable
        ? command.isAvailable(commandContext)
        : true,
    );
  }, [allCommands, commandContext, slashState]);

  const isOpen = slashState !== null && visibleCommands.length > 0;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);

  // Reset selection when the visible set changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [visibleCommands.length, isOpen]);

  // Observe the anchor's position so the popover follows the textarea as it
  // grows / the page scrolls.
  useLayoutEffect(() => {
    if (!isOpen) {
      setAnchorRect(null);
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) return;

    const update = () => {
      const rect = anchor.getBoundingClientRect();
      setAnchorRect({
        left: rect.left,
        top: rect.top,
        width: rect.width,
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchorRef, isOpen]);

  const runCommand = useCallback(
    (command: SlashCommand) => {
      if (command.kind === "action") {
        void command.run(commandContext);
        clearValue();
        return;
      }
      // Skill insert: replace the slash text with the skill content.
      setValue(command.content);
    },
    [clearValue, commandContext, setValue],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!isOpen || visibleCommands.length === 0) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((i) => (i + 1) % visibleCommands.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex(
          (i) => (i - 1 + visibleCommands.length) % visibleCommands.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        const command = visibleCommands[selectedIndex];
        if (command) runCommand(command);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        clearValue();
      }
    },
    [clearValue, isOpen, runCommand, selectedIndex, visibleCommands],
  );

  useImperativeHandle(
    ref,
    () => ({ handleKeyDown, isOpen }),
    [handleKeyDown, isOpen],
  );

  if (!isOpen || !anchorRect || typeof document === "undefined") {
    return null;
  }

  // Anchor the popover so its bottom edge sits 8px above the prompt input.
  const style: React.CSSProperties = {
    position: "fixed",
    left: anchorRect.left,
    bottom: `${window.innerHeight - anchorRect.top + 8}px`,
    width: anchorRect.width,
    zIndex: 9999,
  };

  return createPortal(
    <div
      role="listbox"
      aria-label="Slash commands"
      style={style}
      className={cn(
        "max-h-72 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10",
        // Belt-and-suspenders: even if --popover has alpha in the active theme,
        // a backdrop blur keeps content underneath unreadable.
        "backdrop-blur-md",
      )}
    >
      {visibleCommands.map((command, index) => {
        const isActive = index === selectedIndex;
        const groupLabel =
          command.source === "builtin"
            ? "Command"
            : command.source === "skill-project"
              ? "Project skill"
              : "Global skill";
        return (
          <button
            key={`${command.source}:${command.name}`}
            type="button"
            role="option"
            aria-selected={isActive}
            onMouseEnter={() => setSelectedIndex(index)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runCommand(command)}
            className={cn(
              "flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left text-xs transition-colors",
              isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted",
            )}
          >
            <code className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-[11px]">
              /{command.name}
            </code>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {command.description}
            </span>
            <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
              {groupLabel}
            </span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
});
