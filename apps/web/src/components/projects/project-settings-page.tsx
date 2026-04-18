import type { PiAgentConfig, PiCredentialSummary } from "@g-spot/types";
import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@g-spot/ui/components/card";
import { Input } from "@g-spot/ui/components/input";
import { Label } from "@g-spot/ui/components/label";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@g-spot/ui/components/tabs";
import { Textarea } from "@g-spot/ui/components/textarea";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PiAgentConfigForm } from "@/components/pi/pi-agent-config-form";
import { PiAddonsView } from "@/components/pi/pi-addons-page";
import { SkillsView } from "@/components/skills/skills-page";
import { usePiCatalog } from "@/hooks/use-pi";
import {
  useDeleteProjectMutation,
  useProject,
  useProjectChatCount,
  useUpdateProjectAgentConfigMutation,
  useUpdateProjectMutation,
} from "@/hooks/use-projects";
import {
  areAgentConfigsEqual,
  normalizeAgentConfig,
} from "@/lib/pi-agent-config";

export type ProjectSettingsTab = "general" | "agent" | "addons" | "skills";

const TAB_VALUES: ProjectSettingsTab[] = ["general", "agent", "addons", "skills"];

export function isProjectSettingsTab(value: unknown): value is ProjectSettingsTab {
  return typeof value === "string" && (TAB_VALUES as string[]).includes(value);
}

interface ProjectSettingsPageProps {
  projectId: string;
  tab: ProjectSettingsTab;
  onTabChange: (tab: ProjectSettingsTab) => void;
}

export function ProjectSettingsPage({
  projectId,
  tab,
  onTabChange,
}: ProjectSettingsPageProps) {
  const navigate = useNavigate();
  const projectQuery = useProject(projectId);
  const chatCountQuery = useProjectChatCount(projectId);
  const updateProject = useUpdateProjectMutation();
  const updateProjectAgentConfig = useUpdateProjectAgentConfigMutation();
  const deleteProject = useDeleteProjectMutation();
  const piCatalog = usePiCatalog();
  const allModels = piCatalog.data?.models ?? [];
  const tools = piCatalog.data?.tools ?? [];
  const configuredProviders = useMemo(
    () =>
      new Set(
        (piCatalog.data?.configuredProviders ?? []).map(
          (provider: PiCredentialSummary) => provider.provider,
        ),
      ),
    [piCatalog.data?.configuredProviders],
  );
  const oauthProviders = useMemo(
    () => new Set((piCatalog.data?.oauthProviders ?? []).map((provider) => provider.id)),
    [piCatalog.data?.oauthProviders],
  );

  const [name, setName] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [appendPrompt, setAppendPrompt] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [agentConfigDraft, setAgentConfigDraft] = useState<PiAgentConfig | null>(
    null,
  );

  useEffect(() => {
    if (projectQuery.data) {
      setName(projectQuery.data.name);
      setCustomInstructions(projectQuery.data.customInstructions ?? "");
      setAppendPrompt(projectQuery.data.appendPrompt ?? "");
      setAgentConfigDraft(
        normalizeAgentConfig(projectQuery.data.agentConfig, allModels),
      );
    }
  }, [allModels, projectQuery.data]);

  const isAgentConfigDirty = useMemo(() => {
    if (!projectQuery.data || !agentConfigDraft) return false;
    return !areAgentConfigsEqual(projectQuery.data.agentConfig, agentConfigDraft);
  }, [agentConfigDraft, projectQuery.data]);

  const isDirty = useMemo(() => {
    if (!projectQuery.data) return false;
    return (
      name !== projectQuery.data.name ||
      customInstructions !== (projectQuery.data.customInstructions ?? "") ||
      appendPrompt !== (projectQuery.data.appendPrompt ?? "")
    );
  }, [appendPrompt, customInstructions, name, projectQuery.data]);

  async function handleSave() {
    if (!projectQuery.data || !isDirty) return;
    try {
      await updateProject.mutateAsync({
        id: projectId,
        name: name.trim(),
        customInstructions:
          customInstructions.trim().length > 0 ? customInstructions : null,
        appendPrompt:
          appendPrompt.trim().length > 0 ? appendPrompt : null,
      });
      toast.success("Project updated");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not update project";
      toast.error(message);
    }
  }

  async function handleSaveAgentConfig() {
    if (!agentConfigDraft || !isAgentConfigDirty) return;
    try {
      await updateProjectAgentConfig.mutateAsync({
        id: projectId,
        agentConfig: agentConfigDraft,
      });
      toast.success("Project agent config updated");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Could not update project agent config";
      toast.error(message);
    }
  }

  async function handleDelete() {
    if (!projectQuery.data) return;
    const chatCount = chatCountQuery.data ?? 0;
    const confirmMessage =
      chatCount > 0
        ? `This will permanently delete the project and all ${chatCount} chat${chatCount === 1 ? "" : "s"} inside it. Continue?`
        : "Permanently delete this project?";
    if (typeof window !== "undefined" && !window.confirm(confirmMessage)) {
      return;
    }
    setDeleting(true);
    try {
      await deleteProject.mutateAsync({ id: projectId, force: chatCount > 0 });
      toast.success("Project deleted");
      await navigate({ to: "/projects" });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not delete project";
      toast.error(message);
      setDeleting(false);
    }
  }

  if (projectQuery.isLoading || !projectQuery.data) {
    return (
      <div className="container mx-auto max-w-3xl space-y-6 px-4 py-12">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const project = projectQuery.data;

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto max-w-3xl space-y-8 px-4 py-12">
        <div className="space-y-3">
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            className="inline-flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back to project
          </Link>
          <header className="space-y-2">
            <h1 className="font-semibold text-2xl tracking-tight">
              {project.name}
            </h1>
            <p className="text-muted-foreground text-sm">
              Project settings, agent config, add-ons, and skills scoped to
              this project.
            </p>
          </header>
        </div>

        <Tabs
          value={tab}
          onValueChange={(next) => onTabChange(next as ProjectSettingsTab)}
        >
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="agent">Agent</TabsTrigger>
            <TabsTrigger value="addons">Add-ons</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-6 pt-6">
            <Card>
              <CardHeader>
                <CardTitle>General</CardTitle>
                <CardDescription>
                  The project name is shown in the sidebar. The path is fixed
                  and cannot be changed.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="path">Path</Label>
                    <Badge
                      variant="outline"
                      className="rounded-full px-2 py-0 text-[10px] uppercase tracking-[0.14em]"
                    >
                      Cannot be changed
                    </Badge>
                  </div>
                  <Input
                    id="path"
                    value={project.path}
                    disabled
                    className="font-mono text-xs"
                  />
                  <p className="text-muted-foreground text-xs">
                    Project path is fixed at creation. To use a different path,
                    create a new project.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Prompt</CardTitle>
                <CardDescription>
                  Custom instructions replace Pi&apos;s default system prompt for
                  every chat in this project. Append prompt is added after.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="custom-instructions">Custom instructions</Label>
                  <Textarea
                    id="custom-instructions"
                    rows={8}
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="append-prompt">Append prompt</Label>
                  <Textarea
                    id="append-prompt"
                    rows={4}
                    value={appendPrompt}
                    onChange={(e) => setAppendPrompt(e.target.value)}
                  />
                </div>
              </CardContent>
              <CardFooter className="justify-end">
                <Button
                  type="button"
                  size="sm"
                  className="gap-2"
                  disabled={!isDirty || updateProject.isPending}
                  onClick={() => void handleSave()}
                >
                  {updateProject.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Save changes
                </Button>
              </CardFooter>
            </Card>

            <Card className="border-destructive/30 bg-destructive/5">
              <CardHeader>
                <CardTitle className="text-destructive">Danger zone</CardTitle>
                <CardDescription>
                  Deleting a project also deletes every chat and message inside it.
                  This cannot be undone.
                </CardDescription>
              </CardHeader>
              <CardFooter className="justify-end">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="gap-2"
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                >
                  {deleting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  Delete project
                  {chatCountQuery.data && chatCountQuery.data > 0 ? (
                    <span className="text-xs opacity-75">
                      ({chatCountQuery.data} chat{chatCountQuery.data === 1 ? "" : "s"})
                    </span>
                  ) : null}
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>

          <TabsContent value="agent" className="pt-6">
            <Card>
              <CardHeader>
                <CardTitle>Agent config</CardTitle>
                <CardDescription>
                  Per-project Pi agent defaults. New chats in this project start
                  from these values — the user-level defaults at{" "}
                  <Link
                    to="/chat/settings"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    /chat/settings
                  </Link>{" "}
                  are only used when a new project is first created.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {agentConfigDraft ? (
                  <PiAgentConfigForm
                    value={agentConfigDraft}
                    onChange={setAgentConfigDraft}
                    models={allModels}
                    tools={tools}
                    configuredProviders={configuredProviders}
                    oauthProviders={oauthProviders}
                    modelLabel="Chat model"
                    modelDescription="Applied to new chats created in this project."
                  />
                ) : (
                  <Skeleton className="h-64 w-full rounded-xl" />
                )}
              </CardContent>
              <CardFooter className="justify-end">
                <Button
                  type="button"
                  size="sm"
                  className="gap-2"
                  disabled={
                    !isAgentConfigDirty || updateProjectAgentConfig.isPending
                  }
                  onClick={() => void handleSaveAgentConfig()}
                >
                  {updateProjectAgentConfig.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Save agent config
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>

          <TabsContent value="addons" className="pt-6">
            <PiAddonsView
              projectId={projectId}
              description="Pi-managed packages and drop-in extensions scoped to this project path. Global add-ons still apply, and this project can add more without changing the rest of the workspace."
            />
          </TabsContent>

          <TabsContent value="skills" className="pt-6">
            <SkillsView
              projectId={projectId}
              description="Skills scoped to this project. They show up in the slash-command menu inside any chat in this project, and shadow any global skill with the same name."
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
