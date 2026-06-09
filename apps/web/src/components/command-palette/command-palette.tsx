import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@g-spot/ui/components/command";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import {
  File,
  MessageSquare,
  SquareTerminal,
  TerminalSquare,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { useNewChat } from "@/hooks/use-new-chat";
import {
  matchEntry,
  matchTerm,
  splitQueryTerms,
  toHighlightSegments,
} from "@/lib/fuzzy-score";
import { fsKeys } from "@/lib/query-keys";
import {
  rightSidebarCollapsedAtom,
  sidebarsSwappedAtom,
} from "@/lib/sidebars-store";
import { focusSurface } from "@/lib/surface-focus";
import {
  useCloseActiveTab,
  useFocusTab,
  useOpenFileTab,
  useOpenTerminalTab,
  useReopenClosedTab,
  useSplitActivePane,
  useTabs,
  type Tab,
} from "@/lib/tabs-store";
import { trpcClient } from "@/utils/trpc";

type CommandPaletteProps = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const INITIAL_RESULT_LIMIT = 50;
const FILE_RESULT_LIMIT = 60;
const TAB_RESULT_LIMIT = 20;
const COMMAND_PREFIX = ">";

type IndexedFile = {
  path: string;
  name: string;
  dir: string;
  lowerPath: string;
  lowerName: string;
};

type PaletteCommand = {
  id: string;
  title: string;
  keywords?: string;
  shortcut?: string;
  run: () => void | Promise<void>;
};

function getFileParts(path: string) {
  const slash = path.lastIndexOf("/");
  return {
    name: slash === -1 ? path : path.slice(slash + 1),
    dir: slash === -1 ? "" : path.slice(0, slash),
  };
}

function scoreFile(
  file: IndexedFile,
  terms: string[],
): { score: number; nameIndices: number[] } | null {
  let score = 0;
  const nameIndices: number[] = [];
  for (const term of terms) {
    const nameMatch = matchTerm(file.lowerName, term);
    if (nameMatch) {
      score += nameMatch.score;
      nameIndices.push(...nameMatch.indices);
      continue;
    }
    const pathMatch = matchTerm(file.lowerPath, term);
    if (!pathMatch) return null;
    score += pathMatch.score * 0.25;
  }
  return { score: score - file.path.length / 1000, nameIndices };
}

function tabIcon(tab: Tab) {
  switch (tab.kind) {
    case "terminal":
      return TerminalSquare;
    case "file":
    case "diff":
      return File;
    default:
      return MessageSquare;
  }
}

function useProjectCommands(projectId: string): PaletteCommand[] {
  const { newChat } = useNewChat();
  const openTerminal = useOpenTerminalTab();
  const reopenClosedTab = useReopenClosedTab();
  const closeActiveTab = useCloseActiveTab();
  const splitActivePane = useSplitActivePane();
  const setRightCollapsed = useSetAtom(rightSidebarCollapsedAtom);
  const setSwapped = useSetAtom(sidebarsSwappedAtom);

  return useMemo<PaletteCommand[]>(
    () => [
      {
        id: "new-chat",
        title: "New Chat",
        keywords: "create agent",
        shortcut: "⌘T",
        run: async () => {
          const { id } = await newChat(projectId);
          focusSurface(id);
        },
      },
      {
        id: "new-terminal",
        title: "New Terminal",
        keywords: "shell console",
        shortcut: "⌥⌘T",
        run: () => {
          const id = openTerminal(projectId);
          focusSurface(id);
        },
      },
      {
        id: "reopen-closed-tab",
        title: "Reopen Closed Tab",
        keywords: "restore undo",
        shortcut: "⌘⇧T",
        run: reopenClosedTab,
      },
      {
        id: "close-tab",
        title: "Close Active Tab",
        shortcut: "⌘W",
        run: closeActiveTab,
      },
      {
        id: "split-right",
        title: "Split Right",
        keywords: "pane vertical",
        shortcut: "⌘D",
        run: () => splitActivePane("horizontal"),
      },
      {
        id: "split-down",
        title: "Split Down",
        keywords: "pane horizontal",
        shortcut: "⌘⇧D",
        run: () => splitActivePane("vertical"),
      },
      {
        id: "toggle-right-sidebar",
        title: "Toggle Right Sidebar",
        keywords: "panel hide show",
        run: () => setRightCollapsed((value) => !value),
      },
      {
        id: "swap-sidebars",
        title: "Swap Sidebar Sides",
        keywords: "move left right",
        run: () => setSwapped((value) => !value),
      },
    ],
    [
      closeActiveTab,
      newChat,
      openTerminal,
      projectId,
      reopenClosedTab,
      setRightCollapsed,
      setSwapped,
      splitActivePane,
    ],
  );
}

function HighlightedText({
  text,
  indices,
}: {
  text: string;
  indices: number[];
}) {
  return (
    <>
      {toHighlightSegments(text, indices).map((segment, i) =>
        segment.match ? (
          <mark key={i} className="bg-transparent font-semibold text-primary">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}

export function CommandPalette({
  projectId,
  open,
  onOpenChange,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const navigate = useNavigate();
  const focusTab = useFocusTab();
  const openFile = useOpenFileTab();
  const tabs = useTabs();
  const commands = useProjectCommands(projectId);

  const commandMode = deferredQuery.trimStart().startsWith(COMMAND_PREFIX);

  const filesQuery = useQuery({
    queryKey: fsKeys.listAll(projectId),
    queryFn: () => trpcClient.fs.listAll.query({ projectId }),
    enabled: open && !commandMode,
    staleTime: 30_000,
  });

  const index = useMemo<IndexedFile[]>(() => {
    return (filesQuery.data?.files ?? []).map((path) => {
      const { name, dir } = getFileParts(path);
      return {
        path,
        name,
        dir,
        lowerPath: path.toLowerCase(),
        lowerName: name.toLowerCase(),
      };
    });
  }, [filesQuery.data?.files]);

  const close = () => onOpenChange(false);

  const commandResults = useMemo(() => {
    if (!commandMode) return [];
    const terms = splitQueryTerms(deferredQuery.trimStart().slice(COMMAND_PREFIX.length));
    if (terms.length === 0) {
      return commands.map((command) => ({ command, titleIndices: [] as number[] }));
    }
    const scored: { command: PaletteCommand; score: number; titleIndices: number[] }[] = [];
    for (const command of commands) {
      const result = matchEntry(command.title, command.keywords ?? "", terms);
      if (result) scored.push({ command, score: result.score, titleIndices: result.titleIndices });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map(({ command, titleIndices }) => ({ command, titleIndices }));
  }, [commandMode, commands, deferredQuery]);

  const tabResults = useMemo(() => {
    if (commandMode) return [];
    const terms = splitQueryTerms(deferredQuery);
    if (terms.length === 0) {
      return tabs.slice(0, TAB_RESULT_LIMIT).map((tab) => ({ tab, titleIndices: [] as number[] }));
    }
    const scored: { tab: Tab; score: number; titleIndices: number[] }[] = [];
    for (const tab of tabs) {
      const result = matchEntry(tab.title || "Untitled", tab.kind, terms);
      if (result) scored.push({ tab, score: result.score, titleIndices: result.titleIndices });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, TAB_RESULT_LIMIT).map(({ tab, titleIndices }) => ({ tab, titleIndices }));
  }, [commandMode, deferredQuery, tabs]);

  const fileResults = useMemo(() => {
    if (commandMode) return [];
    const terms = splitQueryTerms(deferredQuery);
    if (terms.length === 0) {
      return index
        .slice(0, INITIAL_RESULT_LIMIT)
        .map((file) => ({ file, nameIndices: [] as number[] }));
    }
    const scored: { file: IndexedFile; score: number; nameIndices: number[] }[] = [];
    for (const file of index) {
      const result = scoreFile(file, terms);
      if (result) scored.push({ file, ...result });
    }
    scored.sort((a, b) => b.score - a.score || a.file.path.length - b.file.path.length);
    return scored
      .slice(0, FILE_RESULT_LIMIT)
      .map(({ file, nameIndices }) => ({ file, nameIndices }));
  }, [commandMode, deferredQuery, index]);

  const handleSwitchToTab = (tab: Tab) => {
    focusTab(tab.id);
    focusSurface(tab.id);
    void navigate({ to: "/agent/$projectId", params: { projectId: tab.projectId } });
    close();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) setQuery("");
      }}
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search files & tabs…  (type › for commands)"
      />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>
          {commandMode
            ? "No matching command."
            : filesQuery.isLoading
              ? "Indexing files…"
              : "No results."}
        </CommandEmpty>

        {commandMode && commandResults.length > 0 && (
          <CommandGroup heading="Commands">
            {commandResults.map(({ command, titleIndices }) => (
              <CommandItem
                key={command.id}
                value={`command:${command.id}`}
                onSelect={() => {
                  void command.run();
                  close();
                }}
              >
                <SquareTerminal className="size-3.5 text-muted-foreground" />
                <span className="flex-1">
                  <HighlightedText text={command.title} indices={titleIndices} />
                </span>
                {command.shortcut && (
                  <CommandShortcut>{command.shortcut}</CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!commandMode && tabResults.length > 0 && (
          <CommandGroup heading="Switch to">
            {tabResults.map(({ tab, titleIndices }) => {
              const Icon = tabIcon(tab);
              return (
                <CommandItem
                  key={`tab:${tab.id}`}
                  value={`tab:${tab.id}`}
                  onSelect={() => handleSwitchToTab(tab)}
                >
                  <Icon className="size-3.5 text-muted-foreground" />
                  <span className="truncate">
                    <HighlightedText text={tab.title || "Untitled"} indices={titleIndices} />
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {!commandMode && fileResults.length > 0 && (
          <CommandGroup heading="Files">
            {fileResults.map(({ file, nameIndices }) => (
              <CommandItem
                key={`file:${file.path}`}
                value={`file:${file.path}`}
                onSelect={() => {
                  openFile(projectId, file.path);
                  close();
                }}
              >
                <File className="size-3.5 text-muted-foreground" />
                <span className="truncate">
                  <HighlightedText text={file.name} indices={nameIndices} />
                </span>
                {file.dir && (
                  <span className="ml-2 truncate text-[10px] text-muted-foreground">
                    {file.dir}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
