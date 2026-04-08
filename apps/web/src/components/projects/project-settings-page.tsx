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
import { Textarea } from "@g-spot/ui/components/textarea";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, Loader2, SparklesIcon, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  useDeleteProjectMutation,
  useProject,
  useProjectChatCount,
  useUpdateProjectMutation,
} from "@/hooks/use-projects";

interface ProjectSettingsPageProps {
  projectId: string;
}

export function ProjectSettingsPage({ projectId }: ProjectSettingsPageProps) {
  const navigate = useNavigate();
  const projectQuery = useProject(projectId);
  const chatCountQuery = useProjectChatCount(projectId);
  const updateProject = useUpdateProjectMutation();
  const deleteProject = useDeleteProjectMutation();

  const [name, setName] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [appendPrompt, setAppendPrompt] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (projectQuery.data) {
      setName(projectQuery.data.name);
      setCustomInstructions(projectQuery.data.customInstructions ?? "");
      setAppendPrompt(projectQuery.data.appendPrompt ?? "");
    }
  }, [projectQuery.data]);

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
              Project settings, custom instructions, and append prompt for every
              chat created in this project.
            </p>
          </header>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
            <CardDescription>
              The project name is shown in the sidebar. The path is fixed and
              cannot be changed.
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

        <Link
          to="/projects/$projectId/skills"
          params={{ projectId }}
          className="block transition-colors"
        >
          <Card className="hover:border-foreground/20 hover:bg-muted/30">
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-md bg-muted p-1.5">
                  <SparklesIcon className="size-4" />
                </div>
                <div className="space-y-1">
                  <CardTitle className="text-base">Skills</CardTitle>
                  <CardDescription>
                    Reusable prompt bundles scoped to this project. Show up as
                    slash commands in chat.
                  </CardDescription>
                </div>
              </div>
              <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
            </CardHeader>
          </Card>
        </Link>

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
      </div>
    </div>
  );
}
