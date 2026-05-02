import { useEffect, useMemo, useState } from "react";

import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import { Label } from "@g-spot/ui/components/label";
import { cn } from "@g-spot/ui/lib/utils";
import { useUser } from "@stackframe/react";
import { Check, Github, Loader2, Mail, PanelsTopLeft, X } from "lucide-react";
import { toast } from "sonner";

import { ConnectedAccountSelect } from "@/components/inbox/connected-account-select";
import { RepoSearchInput } from "@/components/inbox/repo-search-input";
import { useGitHubRepoSearch } from "@/hooks/use-github-options";
import { useCreateSectionMutation } from "@/hooks/use-sections";
import {
  GITHUB_ISSUE_TEMPLATES,
  GITHUB_PR_TEMPLATES,
  GMAIL_TEMPLATES,
  type SectionTemplate,
} from "@/components/onboarding/templates";

export function SectionsStep() {
  const user = useUser();
  const accounts = user?.useConnectedAccounts() ?? [];
  const googleAccounts = useMemo(
    () => accounts.filter((account) => account.provider === "google"),
    [accounts],
  );
  const githubAccounts = useMemo(
    () => accounts.filter((account) => account.provider === "github"),
    [accounts],
  );
  const hasGmail = googleAccounts.length > 0;
  const hasGithub = githubAccounts.length > 0;

  const [gmailAccountId, setGmailAccountId] = useState<string | null>(null);
  const [githubAccountId, setGithubAccountId] = useState<string | null>(null);
  const [githubRepos, setGithubRepos] = useState<string[]>([]);
  const [repoQuery, setRepoQuery] = useState("");

  useEffect(() => {
    if (!gmailAccountId && googleAccounts[0]) {
      setGmailAccountId(googleAccounts[0].providerAccountId);
    }
  }, [gmailAccountId, googleAccounts]);

  useEffect(() => {
    if (!githubAccountId && githubAccounts[0]) {
      setGithubAccountId(githubAccounts[0].providerAccountId);
    }
  }, [githubAccountId, githubAccounts]);

  const githubAccount = useMemo(
    () =>
      githubAccountId
        ? githubAccounts.find(
            (account) => account.providerAccountId === githubAccountId,
          ) ?? null
        : null,
    [githubAccountId, githubAccounts],
  );

  const {
    data: repoPages,
    isLoading: loadingRepos,
    hasNextPage: hasMoreRepos,
    isFetchingNextPage: fetchingMoreRepos,
    fetchNextPage: fetchMoreRepos,
  } = useGitHubRepoSearch(githubAccount, repoQuery);

  const repoSearchResults = useMemo(
    () => repoPages?.pages.flatMap((page) => page.repos) ?? [],
    [repoPages],
  );

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [created, setCreated] = useState<Set<string>>(() => new Set());
  const createMutation = useCreateSectionMutation();

  const toggle = (templateId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(templateId)) next.delete(templateId);
      else next.add(templateId);
      return next;
    });
  };

  const allTemplates = useMemo(
    () => [...GMAIL_TEMPLATES, ...GITHUB_PR_TEMPLATES, ...GITHUB_ISSUE_TEMPLATES],
    [],
  );

  const handleAdd = async () => {
    const targets = allTemplates.filter(
      (template) => selected.has(template.id) && !created.has(template.id),
    );
    if (targets.length === 0) return;

    let successCount = 0;
    for (const template of targets) {
      const isGithub =
        template.source === "github_pr" || template.source === "github_issue";
      const accountId = isGithub ? githubAccountId : gmailAccountId;
      const repos = isGithub ? githubRepos : [];

      try {
        await createMutation.mutateAsync({
          name: template.name,
          source: template.source,
          filters: template.filters,
          showBadge: true,
          repos,
          accountId,
        });
        setCreated((prev) => new Set(prev).add(template.id));
        successCount += 1;
      } catch (error) {
        toast.error(
          `Could not add "${template.name}": ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }

    if (successCount > 0) {
      toast.success(
        `Added ${successCount} section${successCount === 1 ? "" : "s"}`,
      );
    }
  };

  const pendingSelection = [...selected].filter((id) => !created.has(id));

  type Group = {
    id: "gmail" | "github_pr" | "github_issue";
    label: string;
    icon: typeof Mail;
    enabled: boolean;
    hint: string;
    templates: SectionTemplate[];
  };

  const groups: Group[] = [
    {
      id: "gmail",
      label: "Gmail",
      icon: Mail,
      enabled: hasGmail,
      hint: hasGmail ? "" : "Connect a Google account to add Gmail sections",
      templates: GMAIL_TEMPLATES,
    },
    {
      id: "github_pr",
      label: "GitHub PRs",
      icon: Github,
      enabled: hasGithub,
      hint: hasGithub ? "" : "Connect GitHub to add PR sections",
      templates: GITHUB_PR_TEMPLATES,
    },
    {
      id: "github_issue",
      label: "GitHub Issues",
      icon: Github,
      enabled: hasGithub,
      hint: hasGithub ? "" : "Connect GitHub to add issue sections",
      templates: GITHUB_ISSUE_TEMPLATES,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Set up your sections
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sections are filtered views of your inbox. Pick the account (and repos
          for GitHub), then choose templates to add.
        </p>
      </div>

      {!hasGmail && !hasGithub ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-6 text-center">
          <PanelsTopLeft className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No accounts connected yet</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Go back and connect Gmail or GitHub to see starter sections.
          </p>
        </div>
      ) : null}

      <div className="space-y-5">
        {groups.map((group) => {
          const Icon = group.icon;
          const isGmail = group.id === "gmail";
          const isGithubGroup =
            group.id === "github_pr" || group.id === "github_issue";

          return (
            <section
              key={group.id}
              className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4"
            >
              <div className="flex items-center gap-2">
                <Icon className="size-3.5 text-muted-foreground" />
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {group.label}
                </h2>
                {!group.enabled ? (
                  <span className="text-[11px] text-muted-foreground/70">
                    {group.hint}
                  </span>
                ) : null}
              </div>

              {group.enabled && isGmail ? (
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium text-muted-foreground">
                    Account
                  </Label>
                  <ConnectedAccountSelect
                    accounts={accounts}
                    provider="google"
                    value={gmailAccountId}
                    onValueChange={setGmailAccountId}
                    className="h-9"
                  />
                </div>
              ) : null}

              {group.enabled && isGithubGroup && group.id === "github_pr" ? (
                <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr]">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-medium text-muted-foreground">
                      Account
                    </Label>
                    <ConnectedAccountSelect
                      accounts={accounts}
                      provider="github"
                      value={githubAccountId}
                      onValueChange={setGithubAccountId}
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-medium text-muted-foreground">
                      Repositories{" "}
                      <span className="text-muted-foreground/60">
                        (leave empty for all)
                      </span>
                    </Label>
                    {githubRepos.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {githubRepos.map((repo) => (
                          <Badge
                            key={repo}
                            variant="secondary"
                            className="gap-1.5 py-1 pr-1 pl-2 text-xs"
                          >
                            {repo}
                            <button
                              type="button"
                              onClick={() =>
                                setGithubRepos((prev) =>
                                  prev.filter((r) => r !== repo),
                                )
                              }
                              className="rounded-sm p-0.5 hover:bg-foreground/10"
                            >
                              <X className="size-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    <RepoSearchInput
                      repoOptions={repoSearchResults}
                      isLoading={loadingRepos}
                      onSelect={(repo) => {
                        if (!githubRepos.includes(repo)) {
                          setGithubRepos((prev) => [...prev, repo]);
                        }
                      }}
                      onSearchChange={setRepoQuery}
                      hasNextPage={hasMoreRepos}
                      isFetchingNextPage={fetchingMoreRepos}
                      fetchNextPage={() => void fetchMoreRepos()}
                    />
                  </div>
                </div>
              ) : null}

              <div
                className={cn(
                  "grid grid-cols-1 gap-2 sm:grid-cols-2",
                  !group.enabled && "opacity-50",
                )}
              >
                {group.templates.map((template) => {
                  const isSelected = selected.has(template.id);
                  const isCreated = created.has(template.id);
                  const disabled = !group.enabled || isCreated;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggle(template.id)}
                      className={cn(
                        "group relative flex flex-col items-start gap-1 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors",
                        isSelected && !isCreated && "border-primary bg-primary/5",
                        isCreated && "border-emerald-500/40 bg-emerald-500/5",
                        !disabled && "hover:border-border",
                        disabled && "cursor-not-allowed",
                      )}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="text-[13px] font-medium tracking-tight">
                          {template.name}
                        </span>
                        {isCreated ? (
                          <Badge
                            variant="outline"
                            className="gap-1 border-emerald-500/30 bg-emerald-500/10 py-0 text-[10px] text-emerald-500"
                          >
                            <Check className="size-2.5" strokeWidth={3} />
                            Added
                          </Badge>
                        ) : isSelected ? (
                          <Check className="size-3.5 text-primary" />
                        ) : null}
                      </div>
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        {template.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4">
        <p className="text-[12px] text-muted-foreground">
          {pendingSelection.length === 0
            ? created.size > 0
              ? `${created.size} section${created.size === 1 ? "" : "s"} added.`
              : "Select one or more templates to add."
            : `${pendingSelection.length} selected`}
        </p>
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={pendingSelection.length === 0 || createMutation.isPending}
        >
          {createMutation.isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Adding…
            </>
          ) : (
            <>Add selected</>
          )}
        </Button>
      </div>
    </div>
  );
}
