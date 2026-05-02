import { useEffect, useMemo, useState } from "react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@g-spot/ui/components/command";
import { Badge } from "@g-spot/ui/components/badge";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bot, Brain, Database, Github, Mail, MessageSquare, NotebookText, Search, User } from "lucide-react";

import { trpcClient } from "@/utils/trpc";

type SearchResult = Awaited<ReturnType<typeof trpcClient.search.global.query>>[number];

const KIND_ICON = {
  memory: Brain,
  note: NotebookText,
  chat: MessageSquare,
  email: Mail,
  contact: User,
  github: Github,
  sql: Database,
} satisfies Record<SearchResult["kind"], unknown>;

function useDebouncedValue(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function resultValue(result: SearchResult) {
  return [result.kind, result.title, result.subtitle, result.preview].join(" ");
}

function SqlRows({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) {
    return <div className="px-3 py-2 text-xs text-muted-foreground">No rows.</div>;
  }
  const columns = Object.keys(rows[0] ?? {}).slice(0, 8);
  return (
    <div className="max-h-56 overflow-auto border-t bg-muted/20 p-2 text-[11px]">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-muted-foreground">
            {columns.map((column) => <th key={column} className="px-2 py-1 font-medium">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-border/40">
              {columns.map((column) => (
                <td key={column} className="max-w-52 truncate px-2 py-1">{String(row[column] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sqlRows, setSqlRows] = useState<Record<string, unknown>[] | null>(null);
  const [agentAnswer, setAgentAnswer] = useState<string | null>(null);
  const [agentResults, setAgentResults] = useState<SearchResult[]>([]);
  const debouncedQuery = useDebouncedValue(query, 120);
  const navigate = useNavigate();

  useHotkeys([
    {
      hotkey: "Mod+K",
      callback: () => setOpen((value) => !value),
      options: { meta: { name: "Search everything" } },
    },
  ]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSqlRows(null);
      setAgentAnswer(null);
      setAgentResults([]);
    }
  }, [open]);

  const searchQuery = useQuery({
    queryKey: ["global-search", debouncedQuery],
    queryFn: () => trpcClient.search.global.query({ query: debouncedQuery }),
    enabled: open && debouncedQuery.trim().length >= 2,
  });

  const rawSqlMutation = useMutation({
    mutationFn: (sql: string) => trpcClient.search.rawSql.mutate({ sql }),
    onSuccess: (data) => setSqlRows(data.rows),
  });

  const askMutation = useMutation({
    mutationFn: (text: string) => trpcClient.search.ask.mutate({ query: text }),
    onSuccess: (data) => {
      const results = data.results ?? [];
      setAgentResults(results);
      setAgentAnswer(results.length > 0 ? null : "No structured results returned. Try a more specific search.");
    }, 
  });

  const grouped = useMemo(() => {
    const groups = new Map<SearchResult["kind"], SearchResult[]>();
    for (const result of searchQuery.data ?? []) {
      const list = groups.get(result.kind) ?? [];
      list.push(result);
      groups.set(result.kind, list);
    }
    return [...groups.entries()];
  }, [searchQuery.data]);

  const runSql = (sql: string) => {
    setSqlRows(null);
    setAgentAnswer(null);
    setAgentResults([]);
    rawSqlMutation.mutate(sql);
  };

  const askAgent = () => {
    const text = query.trim();
    if (!text) return;
    setSqlRows(null);
    setAgentAnswer(null);
    setAgentResults([]);
    askMutation.mutate(text);
  };

  const openResult = (result: SearchResult) => {
    if (result.kind === "sql") {
      const sql = result.target.sql;
      if (sql) runSql(sql);
      return;
    }

    setOpen(false);
    if (result.kind === "note") {
      void navigate({ to: "/notes", search: { noteId: result.target.noteId ?? undefined, q: result.target.query ?? undefined } });
      return;
    }
    if (result.kind === "chat") {
      const projectId = result.target.projectId;
      const chatId = result.target.chatId;
      if (projectId && chatId) {
        void navigate({
          to: "/projects/$projectId/chat/$chatId",
          params: { projectId, chatId },
          search: { messageId: result.target.messageId ?? undefined, q: result.target.query ?? undefined },
        });
      }
      return;
    }
    if (result.kind === "email" || result.kind === "contact") {
      void navigate({
        to: "/",
        search: {
          gmailThreadId: result.target.gmailThreadId ?? undefined,
          providerAccountId: result.target.providerAccountId ?? undefined,
          q: result.target.query ?? undefined,
        },
      });
      return;
    }
    if (result.kind === "github") {
      void navigate({ to: "/", hash: result.target.sectionId ? `section-${result.target.sectionId}` : undefined });
      return;
    }
    if (result.kind === "memory") {
      void navigate({
        to: "/memory",
        search: { memoryId: result.target.memoryId ?? undefined },
      });
    }
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search everything" description="Search notes, memory, chat, mail, contacts, GitHub, or ask SQL.">
      <Command shouldFilter={false} loop>
        <CommandInput
          autoFocus
          value={query}
          onValueChange={(value) => {
            setQuery(value);
            setSqlRows(null);
            setAgentAnswer(null);
            setAgentResults([]);
          }}
          placeholder="Search everything, ask a question, or paste SELECT…"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              askAgent();
            }
          }}
        />
        <CommandList className="max-h-[28rem]">
          <CommandEmpty>
            {searchQuery.isFetching ? "Searching…" : "No matches. Press ⌘↵ to ask the database agent."}
          </CommandEmpty>

          {query.trim().length >= 2 ? (
            <CommandGroup heading="Smart query">
              <CommandItem value={`ask ${query}`} onSelect={askAgent} className="gap-3">
                <Bot className="size-4 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">Ask database agent</div>
                  <div className="truncate text-muted-foreground">Natural language over the live SQLite schema · ⌘↵</div>
                </div>
                {askMutation.isPending ? <Badge variant="secondary">thinking</Badge> : null}
              </CommandItem>
            </CommandGroup>
          ) : null}

          {searchQuery.isFetching ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-4/5" />
            </div>
          ) : null}

          {agentResults.length > 0 ? (
            <CommandGroup heading="Agent results">
              {agentResults.map((result) => {
                const Icon = KIND_ICON[result.kind] as typeof Search;
                return (
                  <CommandItem key={result.id} value={`agent ${resultValue(result)}`} onSelect={() => openResult(result)} className="gap-3">
                    <Icon className="size-4 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{result.title}</div>
                      <div className="truncate text-muted-foreground">{result.subtitle}</div>
                      {result.preview ? <div className="truncate text-muted-foreground/80">{result.preview}</div> : null}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}

          {grouped.map(([kind, results]) => {
            const Icon = KIND_ICON[kind] as typeof Search;
            return (
              <CommandGroup key={kind} heading={kind}>
                {results.map((result) => (
                  <CommandItem key={result.id} value={resultValue(result)} onSelect={() => openResult(result)} className="gap-3">
                    <Icon className="size-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{result.title}</div>
                      <div className="truncate text-muted-foreground">{result.subtitle}</div>
                      {result.preview ? <div className="truncate text-muted-foreground/80">{result.preview}</div> : null}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}

          {(sqlRows || agentAnswer) ? <CommandSeparator /> : null}
          {rawSqlMutation.isPending ? <div className="px-3 py-2 text-xs text-muted-foreground">Running SQL…</div> : null}
          {sqlRows ? <SqlRows rows={sqlRows} /> : null}
          {agentAnswer ? <div className="whitespace-pre-wrap border-t bg-muted/20 p-3 text-xs leading-relaxed">{agentAnswer}</div> : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
