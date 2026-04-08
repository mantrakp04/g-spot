import type { CreateProjectInput } from "@g-spot/types";
import { Button } from "@g-spot/ui/components/button";
import { Input } from "@g-spot/ui/components/input";
import { Label } from "@g-spot/ui/components/label";
import { Textarea } from "@g-spot/ui/components/textarea";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useCreateProjectMutation } from "@/hooks/use-projects";

interface CreateProjectFormProps {
  onCreated?: (projectId: string) => void;
  /** Render in compact mode (used inside a dialog). */
  dense?: boolean;
}

export function CreateProjectForm({
  onCreated,
  dense = false,
}: CreateProjectFormProps) {
  const navigate = useNavigate();
  const createProject = useCreateProjectMutation();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [appendPrompt, setAppendPrompt] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedPath = path.trim();
  const canSubmit =
    trimmedName.length > 0 &&
    trimmedPath.length > 0 &&
    !createProject.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setServerError(null);

    const input: CreateProjectInput = {
      name: trimmedName,
      path: trimmedPath,
      customInstructions:
        customInstructions.trim().length > 0 ? customInstructions : null,
      appendPrompt:
        appendPrompt.trim().length > 0 ? appendPrompt : null,
    };

    try {
      const created = await createProject.mutateAsync(input);
      toast.success("Project created");
      if (onCreated) {
        onCreated(created.id);
      } else {
        await navigate({
          to: "/projects/$projectId",
          params: { projectId: created.id },
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not create project";
      setServerError(message);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="project-name">Name</Label>
        <Input
          id="project-name"
          placeholder="my-cool-project"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="project-path">Path</Label>
        <Input
          id="project-path"
          placeholder="/Users/you/code/my-cool-project"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="font-mono text-xs"
        />
        <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
          <AlertTriangle className="size-3.5 shrink-0" />
          Absolute path on the server. <strong>This cannot be changed later.</strong>
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="project-instructions">Custom instructions (optional)</Label>
        <Textarea
          id="project-instructions"
          rows={dense ? 4 : 6}
          placeholder="Replaces Pi's default system prompt for chats in this project."
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="project-append-prompt">Append prompt (optional)</Label>
        <Textarea
          id="project-append-prompt"
          rows={dense ? 3 : 4}
          placeholder="Appended to the system prompt — useful for guardrails or repo context."
          value={appendPrompt}
          onChange={(e) => setAppendPrompt(e.target.value)}
        />
      </div>

      {serverError ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {serverError}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit} className="gap-2">
          {createProject.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Create project
        </Button>
      </div>
    </form>
  );
}
