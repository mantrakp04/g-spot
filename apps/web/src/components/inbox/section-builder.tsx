import { useState, useEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { Octokit } from "octokit";

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
import { useUser } from "@stackframe/react";

import type { FilterCondition, SectionSource } from "@g-spot/types/filters";
import {
  useCreateSectionMutation,
  useDeleteSectionMutation,
  useUpdateSectionMutation,
} from "@/hooks/use-sections";
import {
  useGitHubRepoSearch,
  useGitHubLabels,
  useGitHubProfile,
} from "@/hooks/use-github-options";
import { useGmailLabels, useGoogleProfile } from "@/hooks/use-gmail-options";
import { useSectionFilterSuggestions } from "@/hooks/use-filter-suggestions";
import { getInitials, getOAuthToken } from "@/lib/oauth";
import { githubKeys, googleKeys } from "@/lib/query-keys";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";
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
  github_pr: "GitHub PRs",
  github_issue: "GitHub Issues",
  gmail: "Gmail",
};

export function SectionBuilder({
  open,
  onOpenChange,
  section,
}: SectionBuilderProps) {
  const isEdit = !!section;
  const user = useUser();
  const accounts = user?.useConnectedAccounts() ?? [];

  // Form state
  const [name, setName] = useState("");
  const [source, setSource] = useState<SectionSource>("github_pr");
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [filterSearchQueries, setFilterSearchQueries] = useState<string[]>([]);
  const [repos, setRepos] = useState<string[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [showBadge, setShowBadge] = useState(true);
  const isGitHubSource = source === "github_pr" || source === "github_issue";

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      const nextFilters = section ? parseJson<FilterCondition[]>(section.filters, []) : [];
      setName(section?.name ?? "");
      setSource(section?.source ?? "github_pr");
      setFilters(nextFilters);
      setFilterSearchQueries(Array.from({ length: nextFilters.length }, () => ""));
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
      if (isGitHubSource && githubAccounts.length > 0) {
        setAccountId(githubAccounts[0].providerAccountId);
      } else if (source === "gmail" && googleAccounts.length > 0) {
        setAccountId(googleAccounts[0].providerAccountId);
      }
    }
  }, [source, githubAccounts, googleAccounts, accountId, isGitHubSource]);

  // Get the selected connected account object
  const selectedAccount = useMemo(() => {
    if (!accountId) return null;
    return accounts.find((a) => a.providerAccountId === accountId) ?? null;
  }, [accounts, accountId]);

  // Fetch profile info for the selected account (avatar display)
  const { data: githubProfile } = useGitHubProfile(
    isGitHubSource ? selectedAccount : null,
  );
  const { data: googleProfile } = useGoogleProfile(
    source === "gmail" ? selectedAccount : null,
  );

  // Fetch profile labels for ALL relevant accounts so the dropdown shows names, not IDs.
  // Uses the same queryKey + return shape as useGitHubProfile / useGoogleProfile to share cache.
  const relevantAccountsList = isGitHubSource ? githubAccounts : googleAccounts;
  const profileQueries = useQueries({
    queries: relevantAccountsList.map((a) =>
      isGitHubSource
        ? {
            queryKey: githubKeys.profile(a.providerAccountId),
            queryFn: async () => {
              const token = await getOAuthToken(a);
              const octokit = new Octokit({ auth: token });
              const { data } = await octokit.rest.users.getAuthenticated();
              return { login: data.login, avatarUrl: data.avatar_url, name: data.name };
            },
            enabled: true,
            ...persistedStaleWhileRevalidateQueryOptions,
          }
        : {
            queryKey: googleKeys.profile(a.providerAccountId),
            queryFn: async () => {
              const token = await getOAuthToken(a);
              const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!res.ok) throw new Error("Failed to fetch Google profile");
              const data = await res.json() as { name?: string; email?: string; picture?: string };
              return {
                name: data.name ?? data.email ?? "Google Account",
                email: data.email ?? "",
                picture: data.picture ?? "",
              };
            },
            enabled: true,
            ...persistedStaleWhileRevalidateQueryOptions,
          },
    ),
  });

  const profileLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (let i = 0; i < relevantAccountsList.length; i++) {
      const account = relevantAccountsList[i];
      const q = profileQueries[i];
      if (!q?.data) continue;
      const d = q.data as Record<string, string>;
      // GitHub profiles have `login`, Google profiles have `email`
      const label = d.login ?? d.email ?? d.name ?? account.providerAccountId;
      map.set(account.providerAccountId, label);
    }
    return map;
  }, [profileQueries, relevantAccountsList]);

  // Repo search with dynamic query + infinite pagination
  const [repoQuery, setRepoQuery] = useState("");
  const {
    data: repoSearchData,
    isLoading: loadingRepos,
    hasNextPage: hasMoreRepos,
    isFetchingNextPage: fetchingMoreRepos,
    fetchNextPage: fetchMoreRepos,
  } = useGitHubRepoSearch(isGitHubSource ? selectedAccount : null, repoQuery);

  const repoSearchResults = useMemo(
    () => repoSearchData?.pages.flatMap((p) => p.repos) ?? [],
    [repoSearchData],
  );

  // Other options
  const { data: labelOptions, isLoading: loadingLabels } =
    useGitHubLabels(isGitHubSource ? selectedAccount : null, repos);
  const { data: gmailLabelOptions, isLoading: loadingGmailLabels } =
    useGmailLabels(source === "gmail" ? selectedAccount : null);
  const suggestionStates = useSectionFilterSuggestions({
    source,
    account: selectedAccount,
    filters,
    repos,
    searchQueries: filterSearchQueries,
    repoOptions: repoSearchResults.map((repo) => ({
      value: repo.value,
      label: repo.label,
    })),
    githubLabelOptions: labelOptions,
    gmailLabelOptions,
  });

  const createMutation = useCreateSectionMutation();
  const updateMutation = useUpdateSectionMutation();
  const deleteMutation = useDeleteSectionMutation();

  function addCondition() {
    const defaultField = source === "gmail" ? "from" : "status";
    setFilters((prev) => [
      ...prev,
      { field: defaultField, operator: "is" as const, value: "", logic: "and" as const },
    ]);
    setFilterSearchQueries((prev) => [...prev, ""]);
  }

  function updateCondition(index: number, updated: FilterCondition) {
    setFilters((prev) => prev.map((c, i) => (i === index ? updated : c)));
    setFilterSearchQueries((prev) =>
      prev.map((query, i) => (i === index ? "" : query)),
    );
  }

  function removeCondition(index: number) {
    setFilters((prev) => prev.filter((_, i) => i !== index));
    setFilterSearchQueries((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const validFilters = filters.filter((f) => f.value.trim() !== "");

    if (isEdit && section) {
      await updateMutation.mutateAsync({
        id: section.id,
        name: trimmedName,
        filters: validFilters,
        repos,
        accountId,
        showBadge,
      });
    } else {
      await createMutation.mutateAsync({
        name: trimmedName,
        source,
        filters: validFilters,
        repos,
        accountId,
        showBadge,
      });
    }

    onOpenChange(false);
  }

  async function handleDelete() {
    if (!section) return;
    await deleteMutation.mutateAsync(section.id);
    onOpenChange(false);
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const relevantAccounts =
    isGitHubSource ? githubAccounts : googleAccounts;

  // Account display name
  function getAccountLabel(providerAccountId: string): string {
    return profileLabelMap.get(providerAccountId) ?? providerAccountId;
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
                    setFilterSearchQueries([]);
                    setRepos([]);
                    setAccountId(null);
                  }}
                >
                  <SelectTrigger className="h-9">
                    <div className="flex items-center gap-2">
                      {isGitHubSource ? (
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
                      GitHub PRs
                    </SelectItem>
                    <SelectItem value="github_issue">
                      <Github className="size-3.5" />
                      GitHub Issues
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
                              isGitHubSource
                                ? githubProfile?.avatarUrl
                                : googleProfile?.picture
                            }
                          />
                          <AvatarFallback className="text-[8px]">
                            {getInitials(getAccountLabel(accountId ?? ""))}
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
          {isGitHubSource && selectedAccount && (
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
                const { options, isLoading } = suggestionStates[index] ?? {};
                const supportsTypedSuggestions =
                  (source === "github_pr"
                    && ["author", "reviewer", "assignee", "mentions", "involves"].includes(condition.field))
                  || (source === "github_issue"
                    && ["author", "assignee", "mentions", "involves"].includes(condition.field));
                return (
                  <FilterConditionRow
                    key={index}
                    condition={condition}
                    source={isEdit ? section!.source : source}
                    index={index}
                    onChange={(updated) => updateCondition(index, updated)}
                    onSearchChange={
                      supportsTypedSuggestions
                        ? (query) =>
                            setFilterSearchQueries((prev) =>
                              prev.map((current, currentIndex) =>
                                currentIndex === index ? query : current,
                              ),
                            )
                        : undefined
                    }
                    onRemove={() => removeCondition(index)}
                    dynamicOptions={options}
                    isLoadingOptions={
                      isLoading
                      || (isGitHubSource && condition.field === "label" && loadingLabels)
                      || (source === "gmail" && condition.field === "label" && loadingGmailLabels)
                      || (isGitHubSource && condition.field === "repo" && loadingRepos)
                    }
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
              onClick={() => void handleDelete()}
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
              onClick={() => void handleSave()}
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
