import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@g-spot/ui/components/dialog";
import { Input } from "@g-spot/ui/components/input";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { cn } from "@g-spot/ui/lib/utils";
import {
  Check,
  Download,
  ExternalLink,
  Loader2,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  useCatalogSearch,
  useInstallSkillFromSourceMutation,
  usePopularCatalog,
} from "@/hooks/use-skills";

interface SkillExplorerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = install into global skills; string = install into a project. */
  projectId: string | null;
}

/**
 * A lightweight debounce hook local to this file — pulling in a third-party
 * util would be overkill for the one caller.
 */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

function formatInstalls(count: number): string {
  if (!count || count <= 0) return "";
  if (count >= 1_000_000)
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M installs`;
  if (count >= 1_000)
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K installs`;
  return `${count} install${count === 1 ? "" : "s"}`;
}

// Helpful shortcuts once the user wants to pivot away from the default
// leaderboard.
const SUGGESTED_QUERIES = [
  "testing",
  "react",
  "typescript",
  "design",
  "database",
  "auth",
] as const;

export function SkillExplorerDialog({
  open,
  onOpenChange,
  projectId,
}: SkillExplorerDialogProps) {
  const [query, setQuery] = useState("");
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const debouncedQuery = useDebounced(query, 250);

  // Reset ephemeral state every time the dialog reopens so the second visit
  // isn't polluted by the first visit's selections.
  useEffect(() => {
    if (open) {
      setQuery("");
      setInstalledIds(new Set());
    }
  }, [open]);

  const trimmedQuery = debouncedQuery.trim();
  const isEmptyQuery = trimmedQuery.length === 0;
  const hasSearchQuery = trimmedQuery.length >= 2;
  const searchQuery = useCatalogSearch(debouncedQuery, 12);
  const popularQuery = usePopularCatalog(12, open && isEmptyQuery);
  const install = useInstallSkillFromSourceMutation(projectId);

  const activeQuery = hasSearchQuery
    ? searchQuery
    : isEmptyQuery
      ? popularQuery
      : null;
  const results = activeQuery?.data ?? [];
  const isLoading = activeQuery?.isFetching ?? false;
  const errorMessage = activeQuery?.error
    ? activeQuery.error instanceof Error
      ? activeQuery.error.message
      : isEmptyQuery
        ? "Could not load popular skills"
        : "Search failed"
    : null;

  const targetLabel = useMemo(
    () => (projectId ? "this project" : "your global skills"),
    [projectId],
  );

  async function handleInstall(item: {
    id: string;
    source: string;
    skillId: string;
    name: string;
  }) {
    if (!item.source) {
      toast.error("This skill has no source repository");
      return;
    }
    try {
      const res = await install.mutateAsync({
        source: item.source,
        skillSlug: item.skillId,
      });
      setInstalledIds((prev) => new Set(prev).add(item.id));
      const renameNote = res.renamedFrom
        ? ` (renamed to /${res.name})`
        : "";
      toast.success(`Installed ${item.name}${renameNote}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not install skill";
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-muted-foreground" />
            Explore skills
          </DialogTitle>
          <DialogDescription>
            Browse the public{" "}
            <a
              href="https://skills.sh"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground"
            >
              skills.sh
              <ExternalLink className="size-3" />
            </a>{" "}
            directory and install skills directly into {targetLabel}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search skills…"
              className="pl-9"
            />
          </div>

          {isEmptyQuery ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">Try:</span>
              {SUGGESTED_QUERIES.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion}
                  onClick={() => setQuery(suggestion)}
                  className="rounded-full border border-border/70 px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="-mr-2 min-h-[240px] flex-1 overflow-y-auto pr-2">
          {!isEmptyQuery && !hasSearchQuery ? (
            <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-center text-muted-foreground text-sm">
              <Search className="size-5 opacity-60" />
              <p>Type at least 2 characters to search skills.sh</p>
            </div>
          ) : errorMessage ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm">
              {errorMessage}
            </div>
          ) : isLoading && results.length === 0 ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          ) : results.length === 0 ? (
            <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-center text-muted-foreground text-sm">
              {isEmptyQuery ? (
                <>
                  <p>No popular skills available right now.</p>
                  <p className="text-xs">Try searching for something specific.</p>
                </>
              ) : (
                <>
                  <p>No skills found for &ldquo;{debouncedQuery}&rdquo;</p>
                  <p className="text-xs">Try a different keyword.</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {isEmptyQuery ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-muted-foreground text-xs uppercase tracking-[0.18em]">
                    Most popular on skills.sh
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Ranked by installs
                  </p>
                </div>
              ) : null}
              <ul className="space-y-2">
                {results.map((item) => {
                  const alreadyInstalled = installedIds.has(item.id);
                  const isInstalling =
                    install.isPending &&
                    install.variables?.skillSlug === item.skillId;
                  const installsLabel = formatInstalls(item.installs);
                  return (
                    <li
                      key={item.id}
                      className={cn(
                        "flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2.5",
                        alreadyInstalled &&
                          "border-emerald-500/40 bg-emerald-500/5",
                      )}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                            /{item.name}
                          </code>
                          {installsLabel ? (
                            <Badge
                              variant="secondary"
                              className="text-[10px] font-normal"
                            >
                              {installsLabel}
                            </Badge>
                          ) : null}
                        </div>
                        {item.source ? (
                          <a
                            href={`https://skills.sh/${item.id}`}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
                          >
                            {item.source}
                            <ExternalLink className="size-3" />
                          </a>
                        ) : null}
                      </div>
                      <Button
                        size="sm"
                        variant={alreadyInstalled ? "outline" : "default"}
                        className="shrink-0 gap-1.5"
                        disabled={alreadyInstalled || isInstalling}
                        onClick={() => void handleInstall(item)}
                      >
                        {alreadyInstalled ? (
                          <>
                            <Check className="size-3.5" />
                            Installed
                          </>
                        ) : isInstalling ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin" />
                            Installing
                          </>
                        ) : (
                          <>
                            <Download className="size-3.5" />
                            Install
                          </>
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
