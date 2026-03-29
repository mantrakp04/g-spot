import { useState, useEffect, useMemo } from "react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@g-spot/ui/components/avatar";
import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import { Checkbox } from "@g-spot/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@g-spot/ui/components/dialog";
import { Input } from "@g-spot/ui/components/input";
import { Label } from "@g-spot/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@g-spot/ui/components/select";
import { Separator } from "@g-spot/ui/components/separator";
import { Plus, Trash2, X, Github, Mail } from "lucide-react";
import { cn } from "@g-spot/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@stackframe/react";

import type { FilterCondition } from "@g-spot/api/schemas/section-filters";
import type { SectionSource } from "@g-spot/api/schemas/section-filters";
import { getFieldConfig } from "@/lib/filter-fields";
import { trpcClient } from "@/utils/trpc";
import {
  useGitHubRepoSearch,
  useGitHubLabels,
  useGitHubUsers,
  useGitHubProfile,
} from "@/hooks/use-github-options";
import { useGmailLabels, useGoogleProfile } from "@/hooks/use-gmail-options";
import { FilterConditionRow } from "./filter-condition-row";
import { RepoSearchInput } from "./repo-search-input";

type SectionData = {
  id: string;
  name: string;
  source: SectionSource;
  filters: string;
  repos: string;
  accountId: string | null;
  showBadge: boolean;
};

type SectionBuilderProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section?: SectionData;
};

function parseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

const SOURCE_LABELS: Record<SectionSource, string> = {
  github_pr: "GitHub Pull Requests",
  gmail: "Gmail",
};

export function SectionBuilder({
  open,
  onOpenChange,
  section,
}: SectionBuilderProps) {
  const isEdit = !!section;
  const queryClient = useQueryClient();
  const user = useUser();
  const accounts = user?.useConnectedAccounts() ?? [];

  // Form state
  const [name, setName] = useState("");
  const [source, setSource] = useState<SectionSource>("github_pr");
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [repos, setRepos] = useState<string[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [showBadge, setShowBadge] = useState(true);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setName(section?.name ?? "");
      setSource(section?.source ?? "github_pr");
      setFilters(section ? parseJson(section.filters, []) : []);
      setRepos(section ? parseJson(section.repos, []) : []);
      setAccountId(section?.accountId ?? null);
      setShowBadge(section?.showBadge ?? true);
    }
  }, [open, section]);

  // Connected accounts by provider
  const githubAccounts = accounts.filter((a) => a.provider === "github");
  const googleAccounts = accounts.filter((a) => a.provider === "google");

  // Auto-select the first account if none selected
  useEffect(() => {
    if (!accountId) {
      if (source === "github_pr" && githubAccounts.length > 0) {
        setAccountId(githubAccounts[0].providerAccountId);
      } else if (source === "gmail" && googleAccounts.length > 0) {
        setAccountId(googleAccounts[0].providerAccountId);
      }
    }
  }, [source, githubAccounts, googleAccounts, accountId]);

  // Get the selected connected account object
  const selectedAccount = useMemo(() => {
    if (!accountId) return null;
    return accounts.find((a) => a.providerAccountId === accountId) ?? null;
  }, [accounts, accountId]);

  // Fetch profile info for display
  const { data: githubProfile } = useGitHubProfile(
    source === "github_pr" ? selectedAccount : null,
  );
  const { data: googleProfile } = useGoogleProfile(
    source === "gmail" ? selectedAccount : null,
  );

  // Repo search with dynamic query + infinite pagination
  const [repoQuery, setRepoQuery] = useState("");
  const {
    data: repoSearchData,
    isLoading: loadingRepos,
    hasNextPage: hasMoreRepos,
    isFetchingNextPage: fetchingMoreRepos,
    fetchNextPage: fetchMoreRepos,
  } = useGitHubRepoSearch(source === "github_pr" ? selectedAccount : null, repoQuery);

  const repoSearchResults = useMemo(
    () => repoSearchData?.pages.flatMap((p) => p.repos) ?? [],
    [repoSearchData],
  );

  // Other options
  const { data: labelOptions, isLoading: loadingLabels } =
    useGitHubLabels(source === "github_pr" ? selectedAccount : null, repos);
  const { data: userOptions, isLoading: loadingUsers } =
    useGitHubUsers(source === "github_pr" ? selectedAccount : null, "");
  const { data: gmailLabelOptions, isLoading: loadingGmailLabels } =
    useGmailLabels(source === "gmail" ? selectedAccount : null);

  function getOptionsForCondition(condition: FilterCondition) {
    const fieldConfig = getFieldConfig(source, condition.field);
    if (!fieldConfig?.optionsKey) return { options: undefined, loading: false };

    switch (fieldConfig.optionsKey) {
      case "repos":
        return { options: repoSearchResults.map((r) => ({ value: r.value, label: r.label })), loading: loadingRepos };
      case "labels":
        return { options: labelOptions, loading: loadingLabels };
      case "users":
        return { options: userOptions, loading: loadingUsers };
      case "gmail_labels":
        return { options: gmailLabelOptions, loading: loadingGmailLabels };
      default:
        return { options: undefined, loading: false };
    }
  }

  // Mutations
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [["sections", "list"]] });

  const createMutation = useMutation({
    mutationFn: (input: {
      name: string;
      source: SectionSource;
      filters: FilterCondition[];
      repos: string[];
      accountId: string | null;
      showBadge: boolean;
    }) => trpcClient.sections.create.mutate(input),
    onSuccess: () => {
      invalidate();
      onOpenChange(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      filters?: FilterCondition[];
      repos?: string[];
      accountId?: string | null;
      showBadge?: boolean;
    }) => trpcClient.sections.update.mutate(input),
    onSuccess: () => {
      invalidate();
      onOpenChange(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => trpcClient.sections.delete.mutate({ id }),
    onSuccess: () => {
      invalidate();
      onOpenChange(false);
    },
  });

  function addCondition() {
    const defaultField = source === "github_pr" ? "status" : "from";
    setFilters((prev) => [
      ...prev,
      { field: defaultField, operator: "is" as const, value: "", logic: "and" as const },
    ]);
  }

  function updateCondition(index: number, updated: FilterCondition) {
    setFilters((prev) => prev.map((c, i) => (i === index ? updated : c)));
  }

  function removeCondition(index: number) {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const validFilters = filters.filter((f) => f.value.trim() !== "");

    if (isEdit && section) {
      updateMutation.mutate({
        id: section.id,
        name: trimmedName,
        filters: validFilters,
        repos,
        accountId,
        showBadge,
      });
    } else {
      createMutation.mutate({
        name: trimmedName,
        source,
        filters: validFilters,
        repos,
        accountId,
        showBadge,
      });
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const relevantAccounts =
    source === "github_pr" ? githubAccounts : googleAccounts;

  // Account display name
  function getAccountLabel(providerAccountId: string): string {
    if (source === "github_pr" && githubProfile && selectedAccount?.providerAccountId === providerAccountId) {
      return githubProfile.login;
    }
    if (source === "gmail" && googleProfile && selectedAccount?.providerAccountId === providerAccountId) {
      return googleProfile.email || googleProfile.name;
    }
    return providerAccountId;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Update "${section.name}"` : "New section"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Section name */}
          <div className="space-y-1.5">
            <Label htmlFor="section-name" className="text-xs font-medium text-muted-foreground">
              Section name
            </Label>
            <Input
              id="section-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Needs your review"
              className="h-9"
            />
          </div>

          {/* Source + Account in a row */}
          <div className="flex gap-3">
            {/* Source selector */}
            {!isEdit && (
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Source</Label>
                <Select
                  value={source}
                  onValueChange={(v) => {
                    if (!v) return;
                    setSource(v as SectionSource);
                    setFilters([]);
                    setRepos([]);
                    setAccountId(null);
                  }}
                >
                  <SelectTrigger className="h-9">
                    <div className="flex items-center gap-2">
                      {source === "github_pr" ? (
                        <Github className="size-3.5" />
                      ) : (
                        <Mail className="size-3.5" />
                      )}
                      <span className="text-sm">{SOURCE_LABELS[source]}</span>
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="github_pr">
                      <Github className="size-3.5" />
                      GitHub Pull Requests
                    </SelectItem>
                    <SelectItem value="gmail">
                      <Mail className="size-3.5" />
                      Gmail
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Account selector */}
            <div className={cn("space-y-1.5", !isEdit ? "flex-1" : "w-full")}>
              <Label className="text-xs font-medium text-muted-foreground">Account</Label>
              {relevantAccounts.length > 0 ? (
                <Select
                  value={accountId ?? ""}
                  onValueChange={(v) => v && setAccountId(v)}
                >
                  <SelectTrigger className="h-9">
                    <div className="flex items-center gap-2">
                      {selectedAccount && (
                        <Avatar className="size-4">
                          <AvatarImage
                            src={
                              source === "github_pr"
                                ? githubProfile?.avatarUrl
                                : googleProfile?.picture
                            }
                          />
                          <AvatarFallback className="text-[8px]">
                            {getAccountLabel(accountId ?? "").slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <span className="truncate text-sm">
                        {accountId ? getAccountLabel(accountId) : "Select account"}
                      </span>
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {relevantAccounts.map((a) => (
                      <SelectItem key={a.providerAccountId} value={a.providerAccountId}>
                        {getAccountLabel(a.providerAccountId)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex h-9 items-center rounded-md border border-dashed border-border/60 px-3 text-xs text-muted-foreground">
                  No account connected.{" "}
                  <a href="/settings/connections" className="ml-1 underline hover:text-foreground">
                    Connect
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Repositories (GitHub only) */}
          {source === "github_pr" && selectedAccount && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Repositories</Label>

              {repos.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {repos.map((repo) => (
                    <Badge
                      key={repo}
                      variant="secondary"
                      className="gap-1.5 py-1 pr-1 pl-2 text-xs"
                    >
                      {repo}
                      <button
                        type="button"
                        onClick={() =>
                          setRepos((prev) => prev.filter((r) => r !== repo))
                        }
                        className="rounded-sm p-0.5 hover:bg-foreground/10"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <RepoSearchInput
                repoOptions={repoSearchResults}
                isLoading={loadingRepos}
                onSelect={(repo) => {
                  if (!repos.includes(repo)) {
                    setRepos((prev) => [...prev, repo]);
                  }
                }}
                onSearchChange={setRepoQuery}
                hasNextPage={hasMoreRepos}
                isFetchingNextPage={fetchingMoreRepos}
                fetchNextPage={fetchMoreRepos}
              />
            </div>
          )}

          <Separator />

          {/* Filters */}
          <div className="space-y-1">
            <Label className="text-xs font-medium text-muted-foreground">Filters</Label>

            {filters.length === 0 && (
              <p className="py-2 text-xs text-muted-foreground/60">
                No filters — all items will be shown.
              </p>
            )}

            <div className="space-y-0">
              {filters.map((condition, index) => {
                const { options, loading } = getOptionsForCondition(condition);
                return (
                  <FilterConditionRow
                    key={index}
                    condition={condition}
                    source={isEdit ? section!.source : source}
                    index={index}
                    onChange={(updated) => updateCondition(index, updated)}
                    onRemove={() => removeCondition(index)}
                    dynamicOptions={options}
                    isLoadingOptions={loading}
                  />
                );
              })}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 w-full gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={addCondition}
            >
              <Plus className="size-3" />
              Add condition
            </Button>
          </div>

          {/* Badge count */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="show-badge"
              checked={showBadge}
              onCheckedChange={(checked) => setShowBadge(checked === true)}
            />
            <Label htmlFor="show-badge" className="text-xs font-normal">
              Items in this section add to the inbox badge count
            </Label>
          </div>
        </div>

        <Separator />

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          {isEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => section && deleteMutation.mutate(section.id)}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="size-3.5" />
              Delete section
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isSaving || !name.trim()}
            >
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
