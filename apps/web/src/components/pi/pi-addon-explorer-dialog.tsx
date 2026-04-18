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
  Package2,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  useInstallPiAddonMutation,
  usePiCatalogSearch,
  usePopularPiCatalog,
} from "@/hooks/use-pi";

interface PiAddonExplorerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = install into global pi scope; string = install into a project. */
  projectId: string | null;
}

type CatalogType = "extension" | "skill" | "theme" | "prompt";

const TYPE_FILTERS: { key: CatalogType; label: string }[] = [
  { key: "extension", label: "extension" },
  { key: "skill", label: "skill" },
  { key: "theme", label: "theme" },
  { key: "prompt", label: "prompt" },
];

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

function formatDownloads(count: number): string {
  if (!count || count <= 0) return "";
  if (count >= 1_000_000)
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M / mo`;
  if (count >= 1_000)
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K / mo`;
  return `${count}/mo`;
}

export function PiAddonExplorerDialog({
  open,
  onOpenChange,
  projectId,
}: PiAddonExplorerDialogProps) {
  const [query, setQuery] = useState("");
  const [activeTypes, setActiveTypes] = useState<Set<CatalogType>>(new Set());
  const [installedNames, setInstalledNames] = useState<Set<string>>(new Set());
  const debouncedQuery = useDebounced(query, 250);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveTypes(new Set());
      setInstalledNames(new Set());
    }
  }, [open]);

  const trimmedQuery = debouncedQuery.trim();
  const isEmptyQuery = trimmedQuery.length === 0;
  const searchQuery = usePiCatalogSearch(debouncedQuery, 36);
  const popularQuery = usePopularPiCatalog(36, open && isEmptyQuery);
  const install = useInstallPiAddonMutation();

  const activeQuery = isEmptyQuery ? popularQuery : searchQuery;
  const allResults = activeQuery.data ?? [];
  const isLoading = activeQuery.isFetching;
  const errorMessage = activeQuery.error
    ? activeQuery.error instanceof Error
      ? activeQuery.error.message
      : "Could not load Pi packages"
    : null;

  const results = useMemo(() => {
    if (activeTypes.size === 0) return allResults;
    return allResults.filter((pkg) =>
      pkg.types.some((t) => activeTypes.has(t as CatalogType)),
    );
  }, [allResults, activeTypes]);

  const targetLabel = useMemo(
    () => (projectId ? "this project" : "your global scope"),
    [projectId],
  );

  function toggleType(type: CatalogType) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  async function handleInstall(pkg: { name: string }) {
    try {
      await install.mutateAsync({ projectId, source: `npm:${pkg.name}` });
      setInstalledNames((prev) => new Set(prev).add(pkg.name));
      toast.success(`Installed ${pkg.name}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not install add-on",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package2 className="size-4 text-muted-foreground" />
            Explore Pi add-ons
          </DialogTitle>
          <DialogDescription>
            Browse the public{" "}
            <a
              href="https://pi.dev/packages"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground"
            >
              pi.dev
              <ExternalLink className="size-3" />
            </a>{" "}
            directory and install extensions, skills, themes, and prompts into{" "}
            {targetLabel}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Pi packages…"
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {TYPE_FILTERS.map((filter) => {
              const active = activeTypes.has(filter.key);
              return (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => toggleType(filter.key)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs capitalize transition-colors",
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {filter.label}
                </button>
              );
            })}
            {activeTypes.size > 0 ? (
              <button
                type="button"
                onClick={() => setActiveTypes(new Set())}
                className="text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground"
              >
                clear
              </button>
            ) : null}
          </div>
        </div>

        <div className="-mr-2 min-h-[240px] flex-1 overflow-y-auto pr-2">
          {errorMessage ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm">
              {errorMessage}
            </div>
          ) : isLoading && results.length === 0 ? (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full rounded-lg" />
              <Skeleton className="h-20 w-full rounded-lg" />
              <Skeleton className="h-20 w-full rounded-lg" />
            </div>
          ) : results.length === 0 ? (
            <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-center text-muted-foreground text-sm">
              {isEmptyQuery && activeTypes.size === 0 ? (
                <>
                  <p>No Pi packages available right now.</p>
                  <p className="text-xs">Try searching for something specific.</p>
                </>
              ) : (
                <>
                  <p>
                    No packages found
                    {trimmedQuery ? (
                      <>
                        {" "}for &ldquo;{trimmedQuery}&rdquo;
                      </>
                    ) : null}
                    .
                  </p>
                  <p className="text-xs">
                    Try a different keyword or clear filters.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {isEmptyQuery ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-muted-foreground text-xs uppercase tracking-[0.18em]">
                    Most downloaded on pi.dev
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Ranked by monthly installs
                  </p>
                </div>
              ) : null}
              <ul className="space-y-2">
                {results.map((pkg) => {
                  const source = `npm:${pkg.name}`;
                  const alreadyInstalled = installedNames.has(pkg.name);
                  const isInstalling =
                    install.isPending &&
                    install.variables?.source === source &&
                    install.variables?.projectId === projectId;
                  const downloadsLabel = formatDownloads(pkg.monthlyDownloads);
                  return (
                    <li
                      key={pkg.name}
                      className={cn(
                        "flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2.5",
                        alreadyInstalled &&
                          "border-emerald-500/40 bg-emerald-500/5",
                      )}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                            {pkg.name}
                          </code>
                          {pkg.types.map((type) => (
                            <Badge
                              key={type}
                              variant="outline"
                              className="px-1.5 py-0 text-[10px] font-normal capitalize"
                            >
                              {type}
                            </Badge>
                          ))}
                          {downloadsLabel ? (
                            <Badge
                              variant="secondary"
                              className="text-[10px] font-normal"
                            >
                              {downloadsLabel}
                            </Badge>
                          ) : null}
                        </div>
                        {pkg.description ? (
                          <p className="line-clamp-2 text-muted-foreground text-xs leading-relaxed">
                            {pkg.description}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                          {pkg.author ? <span>by {pkg.author}</span> : null}
                          {pkg.npmUrl ? (
                            <a
                              href={pkg.npmUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-1 hover:text-foreground"
                            >
                              npm
                              <ExternalLink className="size-3" />
                            </a>
                          ) : null}
                          {pkg.homepageUrl ? (
                            <a
                              href={pkg.homepageUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-1 hover:text-foreground"
                            >
                              homepage
                              <ExternalLink className="size-3" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={alreadyInstalled ? "outline" : "default"}
                        className="shrink-0 gap-1.5"
                        disabled={alreadyInstalled || isInstalling}
                        onClick={() => void handleInstall(pkg)}
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
