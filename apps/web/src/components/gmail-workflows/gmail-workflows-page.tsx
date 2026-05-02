import type { GmailAgentToolName } from "@g-spot/types";
import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@g-spot/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@g-spot/ui/components/select";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { Switch } from "@g-spot/ui/components/switch";
import { cn } from "@g-spot/ui/lib/utils";
import type { OAuthConnection } from "@stackframe/react";
import { useUser } from "@stackframe/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  MailCheck,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { GmailWorkflowEditorDialog } from "./gmail-workflow-editor-dialog";
import { useConfirmDialog } from "@/contexts/confirm-dialog-context";
import { useGoogleProfile } from "@/hooks/use-gmail-options";
import { gmailKeys } from "@/lib/query-keys";
import { queryClient, trpcClient } from "@/utils/trpc";

export type GmailWorkflow = Awaited<
  ReturnType<typeof trpcClient.gmailSync.listAgentWorkflows.query>
>[number];

export type GmailWorkflowTool = {
  name: GmailAgentToolName;
  description: string;
};

const TOOL_DESCRIPTIONS: Record<GmailAgentToolName, string> = {
  gmail_search_threads: "Search synced local mail.",
  gmail_get_thread: "Read stored messages in a thread.",
  gmail_list_labels: "Inspect Gmail label ids.",
  gmail_modify_thread_labels: "Add or remove thread labels.",
  gmail_create_draft: "Create reply or new-message drafts.",
  gmail_update_draft: "Replace an existing draft.",
  gmail_delete_draft: "Remove a draft.",
  gmail_trash_thread: "Move a thread to trash.",
  gmail_send_email: "Send immediately or send a draft.",
};

function AccountLabel({ account }: { account: OAuthConnection }) {
  const profile = useGoogleProfile(account);
  const label =
    profile.data?.email ?? profile.data?.name ?? account.providerAccountId;
  return <span className="truncate">{label}</span>;
}

function useGoogleAccounts() {
  const user = useUser({ or: "redirect" });
  return user.useConnectedAccounts().filter((account) => account.provider === "google");
}

function useSelectedGoogleAccount(accounts: OAuthConnection[]) {
  const [providerAccountId, setProviderAccountId] = useState<string | null>(
    accounts[0]?.providerAccountId ?? null,
  );

  useEffect(() => {
    if (providerAccountId && accounts.some((account) => account.providerAccountId === providerAccountId)) {
      return;
    }
    setProviderAccountId(accounts[0]?.providerAccountId ?? null);
  }, [accounts, providerAccountId]);

  return {
    account:
      accounts.find((account) => account.providerAccountId === providerAccountId)
      ?? null,
    providerAccountId,
    setProviderAccountId,
  };
}

export function GmailWorkflowsPage() {
  const accounts = useGoogleAccounts();
  const { account, providerAccountId, setProviderAccountId } =
    useSelectedGoogleAccount(accounts);
  const confirm = useConfirmDialog();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<GmailWorkflow | null>(
    null,
  );

  const toolkitQuery = useQuery({
    queryKey: gmailKeys.agentToolkit(),
    queryFn: () => trpcClient.gmailSync.getAgentToolkit.query(),
  });
  const workflowsQuery = useQuery({
    queryKey: gmailKeys.agentWorkflows(providerAccountId),
    queryFn: () =>
      trpcClient.gmailSync.listAgentWorkflows.query({
        providerAccountId: providerAccountId!,
      }),
    enabled: !!providerAccountId,
  });

  const tools = useMemo<GmailWorkflowTool[]>(() => {
    return (toolkitQuery.data?.tools ?? []).map((tool) => ({
      name: tool.name,
      description: TOOL_DESCRIPTIONS[tool.name],
    }));
  }, [toolkitQuery.data]);

  const upsertWorkflow = useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.gmailSync.upsertAgentWorkflow.mutate>[0]) =>
      trpcClient.gmailSync.upsertAgentWorkflow.mutate(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: gmailKeys.agentWorkflows(providerAccountId),
      });
    },
  });

  const deleteWorkflow = useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.gmailSync.deleteAgentWorkflow.mutate>[0]) =>
      trpcClient.gmailSync.deleteAgentWorkflow.mutate(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: gmailKeys.agentWorkflows(providerAccountId),
      });
    },
  });

  function openCreate() {
    setEditingWorkflow(null);
    setEditorOpen(true);
  }

  function openEdit(workflow: GmailWorkflow) {
    setEditingWorkflow(workflow);
    setEditorOpen(true);
  }

  async function saveWorkflow(
    workflow: Parameters<typeof upsertWorkflow.mutateAsync>[0]["workflow"],
  ) {
    if (!providerAccountId) return;
    await upsertWorkflow.mutateAsync({ providerAccountId, workflow });
    toast.success("Workflow saved");
    setEditorOpen(false);
  }

  async function toggleWorkflow(workflow: GmailWorkflow, enabled: boolean) {
    if (!providerAccountId) return;
    await upsertWorkflow.mutateAsync({
      providerAccountId,
      workflow: {
        id: workflow.id,
        name: workflow.name,
        enabled,
        prompt: workflow.prompt,
        disabledToolNames: workflow.disabledToolNames,
      },
    });
  }

  async function removeWorkflow(workflow: GmailWorkflow) {
    if (!providerAccountId) return;
    const confirmed = await confirm({
      title: "Delete workflow?",
      description: `Delete "${workflow.name}"?`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    await deleteWorkflow.mutateAsync({
      providerAccountId,
      workflowId: workflow.id,
    });
    toast.success("Workflow deleted");
  }

  const workflows = workflowsQuery.data ?? [];
  const isBusy = upsertWorkflow.isPending || deleteWorkflow.isPending;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-5xl space-y-6 px-5 py-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-5">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-md border border-border/70 bg-muted/40">
                <Workflow className="size-4" />
              </div>
              <h1 className="font-semibold text-xl tracking-tight">
                Gmail workflows
              </h1>
            </div>
            <p className="max-w-2xl text-muted-foreground text-sm leading-relaxed">
              Incremental-sync agents for labeling, triage, and draft work.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {accounts.length > 0 ? (
              <Select
                value={providerAccountId ?? ""}
                onValueChange={setProviderAccountId}
              >
                <SelectTrigger className="w-64 bg-background">
                  <SelectValue>
                    {(value: string | null) => {
                      const selected = accounts.find(
                        (item) => item.providerAccountId === value,
                      );
                      return selected ? (
                        <AccountLabel account={selected} />
                      ) : null;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((item) => (
                    <SelectItem
                      key={item.providerAccountId}
                      value={item.providerAccountId}
                    >
                      <AccountLabel account={item} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button
              onClick={openCreate}
              className="gap-2"
              disabled={!account || toolkitQuery.isLoading}
            >
              <Plus className="size-4" />
              New workflow
            </Button>
          </div>
        </header>

        {accounts.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No Gmail account connected</CardTitle>
            </CardHeader>
            <CardContent>
              <Button render={<Link to="/settings/connections" />} nativeButton={false}>
                Connect Gmail
              </Button>
            </CardContent>
          </Card>
        ) : workflowsQuery.isLoading || toolkitQuery.isLoading ? (
          <div className="grid gap-3">
            <Skeleton className="h-28 rounded-lg" />
            <Skeleton className="h-28 rounded-lg" />
          </div>
        ) : workflows.length === 0 ? (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle>No workflows yet</CardTitle>
            </CardHeader>
            <CardContent>
              <Button onClick={openCreate} className="gap-2">
                <Plus className="size-4" />
                Create workflow
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {workflows.map((workflow) => {
              const disabledCount = workflow.disabledToolNames.length;
              return (
                <Card
                  key={workflow.id}
                  className={cn(
                    "border-border/70 transition-colors",
                    workflow.enabled && "border-emerald-500/30",
                  )}
                >
                  <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">
                          {workflow.name}
                        </CardTitle>
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-full",
                            workflow.enabled
                              ? "border-emerald-500/25 text-emerald-500"
                              : "text-muted-foreground",
                          )}
                        >
                          {workflow.enabled ? "Enabled" : "Paused"}
                        </Badge>
                        <Badge variant="secondary" className="rounded-full">
                          incremental sync
                        </Badge>
                      </div>
                      <p className="line-clamp-2 max-w-3xl text-muted-foreground text-sm leading-relaxed">
                        {workflow.prompt || "No prompt configured."}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <Switch
                        checked={workflow.enabled}
                        onCheckedChange={(enabled) =>
                          void toggleWorkflow(workflow, enabled)
                        }
                        disabled={isBusy}
                        aria-label="Toggle workflow"
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(workflow)}
                        aria-label="Edit workflow"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => void removeWorkflow(workflow)}
                        aria-label="Delete workflow"
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="gap-1 rounded-full">
                      <MailCheck className="size-3" />
                      {tools.length - disabledCount} tools active
                    </Badge>
                    <Badge variant="outline" className="gap-1 rounded-full">
                      <ShieldCheck className="size-3" />
                      {disabledCount} disabled
                    </Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <GmailWorkflowEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        workflow={editingWorkflow}
        tools={tools}
        isPending={isBusy}
        onSave={saveWorkflow}
      />
    </div>
  );
}
