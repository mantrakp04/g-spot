import type { Skill } from "@g-spot/types";
import { skillNameSchema, skillDescriptionSchema } from "@g-spot/types";
import { Button } from "@g-spot/ui/components/button";
import { Checkbox } from "@g-spot/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@g-spot/ui/components/dialog";
import { Input } from "@g-spot/ui/components/input";
import { Label } from "@g-spot/ui/components/label";
import { Textarea } from "@g-spot/ui/components/textarea";
import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import {
  useCreateSkillMutation,
  useUpdateSkillMutation,
} from "@/hooks/use-skills";

interface SkillEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, edit this skill. When null, create a new one. */
  skill: Skill | null;
  /** Project id this skill is bound to, or null for a global skill. */
  projectId: string | null;
}

const EMPTY_FORM = {
  name: "",
  description: "",
  content: "",
  triggerKeywords: "",
  disableModelInvocation: false,
};

export function SkillEditorDialog({
  open,
  onOpenChange,
  skill,
  projectId,
}: SkillEditorDialogProps) {
  const createSkill = useCreateSkillMutation();
  const updateSkill = useUpdateSkillMutation(projectId);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (skill) {
      setForm({
        name: skill.name,
        description: skill.description,
        content: skill.content,
        triggerKeywords: skill.triggerKeywords.join(", "),
        disableModelInvocation: skill.disableModelInvocation,
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setError(null);
  }, [open, skill]);

  const isEditing = skill !== null;
  const isPending = createSkill.isPending || updateSkill.isPending;

  function parseTriggerKeywords(value: string): string[] {
    return value
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const nameParse = skillNameSchema.safeParse(form.name);
    if (!nameParse.success) {
      setError(nameParse.error.issues[0]?.message ?? "Invalid name");
      return;
    }
    const descriptionParse = skillDescriptionSchema.safeParse(form.description);
    if (!descriptionParse.success) {
      setError(
        descriptionParse.error.issues[0]?.message ?? "Invalid description",
      );
      return;
    }

    try {
      if (isEditing && skill) {
        await updateSkill.mutateAsync({
          id: skill.id,
          name: form.name,
          description: form.description,
          content: form.content,
          triggerKeywords: parseTriggerKeywords(form.triggerKeywords),
          disableModelInvocation: form.disableModelInvocation,
        });
        toast.success("Skill updated");
      } else {
        await createSkill.mutateAsync({
          projectId,
          name: form.name,
          description: form.description,
          content: form.content,
          triggerKeywords: parseTriggerKeywords(form.triggerKeywords),
          disableModelInvocation: form.disableModelInvocation,
        });
        toast.success("Skill created");
      }
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not save skill";
      setError(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 border-b border-border/60 px-4 pt-4 pb-3">
          <DialogTitle>{isEditing ? "Edit skill" : "New skill"}</DialogTitle>
          <DialogDescription>
            Skills are reusable prompt bundles. They appear as{" "}
            <code className="rounded bg-muted px-1 text-[11px]">/skillname</code>{" "}
            in chat and can be auto-invoked when their description matches.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="skill-name">Name</Label>
            <Input
              id="skill-name"
              placeholder="my-skill"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              disabled={isPending}
              className="font-mono text-xs"
            />
            <p className="text-muted-foreground text-xs">
              Lowercase letters, digits, and hyphens. Becomes{" "}
              <code className="rounded bg-muted px-1 text-[11px]">/{form.name || "name"}</code>.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="skill-description">Description</Label>
            <Input
              id="skill-description"
              placeholder="What this skill does"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              disabled={isPending}
            />
            <p className="text-muted-foreground text-xs">
              {form.description.length} / 1024
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="skill-content">Content (markdown)</Label>
            <Textarea
              id="skill-content"
              rows={10}
              value={form.content}
              onChange={(e) =>
                setForm((f) => ({ ...f, content: e.target.value }))
              }
              disabled={isPending}
              // Override `field-sizing: content` from the base component so
              // massive imported skill bodies don't push the dialog past the
              // viewport. The textarea scrolls internally above this cap.
              className="max-h-64 font-mono text-xs [field-sizing:fixed]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="skill-triggers">Trigger keywords</Label>
            <Input
              id="skill-triggers"
              placeholder="comma, separated, keywords"
              value={form.triggerKeywords}
              onChange={(e) =>
                setForm((f) => ({ ...f, triggerKeywords: e.target.value }))
              }
              disabled={isPending}
            />
            <p className="text-muted-foreground text-xs">
              Optional. Used by the local slash-command autocomplete to surface
              this skill faster.
            </p>
          </div>

          <label className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2.5">
            <Checkbox
              checked={form.disableModelInvocation}
              onCheckedChange={(checked) =>
                setForm((f) => ({
                  ...f,
                  disableModelInvocation: checked === true,
                }))
              }
              disabled={isPending}
            />
            <div className="space-y-0.5">
              <div className="text-sm font-medium leading-none">
                Disable model invocation
              </div>
              <p className="text-muted-foreground text-xs">
                When checked, the agent never auto-runs this skill — it can only
                be invoked explicitly via{" "}
                <code className="rounded bg-muted px-1 text-[11px]">
                  /skill:{form.name || "name"}
                </code>
                .
              </p>
            </div>
          </label>

          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          </div>

          <DialogFooter className="shrink-0 border-t border-border/60 px-4 py-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" className="gap-2" disabled={isPending}>
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {isEditing ? "Save changes" : "Create skill"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
