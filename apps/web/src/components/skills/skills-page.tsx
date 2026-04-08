import type { Skill } from "@g-spot/types";
import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@g-spot/ui/components/card";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { cn } from "@g-spot/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SkillEditorDialog } from "@/components/skills/skill-editor-dialog";
import {
  useDeleteSkillMutation,
  useGlobalSkills,
  useProjectSkills,
} from "@/hooks/use-skills";

interface SkillsPageProps {
  /** null = global skills page; string = a project's skills page */
  projectId: string | null;
  /** Page-level title and description differ between scopes. */
  title: string;
  description: string;
  /** Where the back link points. */
  backHref: { to: string; params?: Record<string, string>; label: string };
}

function isLocalSkill(value: unknown): value is Skill {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Skill).id === "string"
  );
}

export function SkillsPage({
  projectId,
  title,
  description,
  backHref,
}: SkillsPageProps) {
  const globalQuery = useGlobalSkills();
  const projectQuery = useProjectSkills(projectId);
  const deleteSkill = useDeleteSkillMutation(projectId);

  const skillsQuery = projectId === null ? globalQuery : projectQuery;
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

  function openCreate() {
    setEditingSkill(null);
    setEditorOpen(true);
  }

  function openEdit(skill: Skill) {
    setEditingSkill(skill);
    setEditorOpen(true);
  }

  async function handleDelete(skill: Skill) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete skill "${skill.name}"?`)
    ) {
      return;
    }
    try {
      await deleteSkill.mutateAsync({ id: skill.id });
      toast.success("Skill deleted");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not delete skill";
      toast.error(message);
    }
  }

  const skills = (skillsQuery.data ?? []).filter(isLocalSkill);

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto max-w-4xl space-y-8 px-4 py-12">
        <div className="space-y-3">
          <Link
            to={backHref.to}
            params={backHref.params as never}
            className="inline-flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            {backHref.label}
          </Link>
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-2">
              <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
              <p className="max-w-2xl text-muted-foreground text-sm">
                {description}
              </p>
            </div>
            <Button onClick={openCreate} className="gap-2">
              <Plus className="size-4" />
              New skill
            </Button>
          </header>
        </div>

        {skillsQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : skills.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No skills yet</CardTitle>
              <CardDescription>
                Skills are reusable prompt bundles that show up as slash
                commands in chat. Create one to get started.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={openCreate} className="gap-2">
                <Plus className="size-4" />
                Create skill
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {skills.map((skill) => (
              <Card key={skill.id} className="border border-border/60">
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                          /{skill.name}
                        </code>
                      </CardTitle>
                      {skill.disableModelInvocation ? (
                        <Badge
                          variant="outline"
                          className="rounded-full px-2 py-0 text-[10px] uppercase tracking-[0.14em]"
                        >
                          Manual only
                        </Badge>
                      ) : null}
                    </div>
                    <CardDescription className="line-clamp-2">
                      {skill.description}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEdit(skill)}
                      aria-label="Edit skill"
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void handleDelete(skill)}
                      aria-label="Delete skill"
                      className={cn("text-muted-foreground hover:text-destructive")}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </CardHeader>
                {skill.triggerKeywords.length > 0 ? (
                  <CardContent className="flex flex-wrap gap-1.5">
                    {skill.triggerKeywords.map((kw) => (
                      <Badge key={kw} variant="secondary" className="text-[10px]">
                        {kw}
                      </Badge>
                    ))}
                  </CardContent>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </div>

      <SkillEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        skill={editingSkill}
        projectId={projectId}
      />
    </div>
  );
}
