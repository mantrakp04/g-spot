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
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SkillEditorDialog } from "@/components/skills/skill-editor-dialog";
import { SkillExplorerDialog } from "@/components/skills/skill-explorer-dialog";
import {
  useDeleteSkillMutation,
  useGlobalSkills,
  useProjectSkills,
} from "@/hooks/use-skills";

interface SkillsViewProps {
  /** null = global skills; string = a project's skills */
  projectId: string | null;
  description?: string;
}

function isLocalSkill(value: unknown): value is Skill {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Skill).id === "string"
  );
}

export function SkillsView({ projectId, description }: SkillsViewProps) {
  const globalQuery = useGlobalSkills();
  const projectQuery = useProjectSkills(projectId);
  const deleteSkill = useDeleteSkillMutation(projectId);

  const skillsQuery = projectId === null ? globalQuery : projectQuery;
  const [editorOpen, setEditorOpen] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(false);
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {description ? (
          <p className="max-w-2xl text-muted-foreground text-sm leading-relaxed">
            {description}
          </p>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExplorerOpen(true)}
            className="gap-2"
          >
            <Sparkles className="size-4" />
            Explore skills
          </Button>
          <Button size="sm" onClick={openCreate} className="gap-2">
            <Plus className="size-4" />
            New skill
          </Button>
        </div>
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
              commands in chat. Create one from scratch, or browse the
              public skills.sh directory.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={openCreate} className="gap-2">
              <Plus className="size-4" />
              Create skill
            </Button>
            <Button
              variant="outline"
              onClick={() => setExplorerOpen(true)}
              className="gap-2"
            >
              <Sparkles className="size-4" />
              Explore skills
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

      <SkillEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        skill={editingSkill}
        projectId={projectId}
      />

      <SkillExplorerDialog
        open={explorerOpen}
        onOpenChange={setExplorerOpen}
        projectId={projectId}
      />
    </div>
  );
}
