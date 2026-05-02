import type { GmailAgentToolName } from "@g-spot/types";
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
import { Switch } from "@g-spot/ui/components/switch";
import { Textarea } from "@g-spot/ui/components/textarea";
import { cn } from "@g-spot/ui/lib/utils";
import { Check, Save } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { GmailWorkflow, GmailWorkflowTool } from "./gmail-workflows-page";

type FormState = {
  name: string;
  enabled: boolean;
  prompt: string;
  disabledToolNames: GmailAgentToolName[];
};

const EMPTY_FORM: FormState = {
  name: "Incoming triage",
  enabled: false,
  prompt: "",
  disabledToolNames: ["gmail_send_email"],
};

type GmailWorkflowEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: GmailWorkflow | null;
  tools: GmailWorkflowTool[];
  isPending: boolean;
  onSave: (input: {
    id?: string;
    name: string;
    enabled: boolean;
    prompt: string;
    disabledToolNames: GmailAgentToolName[];
  }) => Promise<void>;
};

function toForm(workflow: GmailWorkflow | null): FormState {
  if (!workflow) return EMPTY_FORM;
  return {
    name: workflow.name,
    enabled: workflow.enabled,
    prompt: workflow.prompt,
    disabledToolNames: workflow.disabledToolNames,
  };
}

export function GmailWorkflowEditorDialog({
  open,
  onOpenChange,
  workflow,
  tools,
  isPending,
  onSave,
}: GmailWorkflowEditorDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(toForm(workflow));
    setError(null);
  }, [open, workflow]);

  const disabledTools = useMemo(
    () => new Set(form.disabledToolNames),
    [form.disabledToolNames],
  );
  const activeToolCount = Math.max(0, tools.length - disabledTools.size);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }

    await onSave({
      id: workflow?.id,
      name: form.name.trim(),
      enabled: form.enabled,
      prompt: form.prompt,
      disabledToolNames: form.disabledToolNames,
    });
  }

  function setToolDisabled(toolName: GmailAgentToolName, disabled: boolean) {
    setForm((current) => {
      const next = new Set(current.disabledToolNames);
      if (disabled) {
        next.add(toolName);
      } else {
        next.delete(toolName);
      }
      return { ...current, disabledToolNames: [...next] };
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border/60 px-5 pt-5 pb-4">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>
              {workflow ? "Edit Gmail workflow" : "New Gmail workflow"}
            </DialogTitle>
            <Badge variant="outline" className="gap-1 rounded-full">
              <Check className="size-3" />
              {activeToolCount} active
            </Badge>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              <div className="space-y-2">
                <Label htmlFor="workflow-name">Name</Label>
                <Input
                  id="workflow-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  disabled={isPending}
                />
              </div>

              <label className="flex min-w-40 items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2.5">
                <span className="text-sm font-medium">Enabled</span>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(enabled) =>
                    setForm((current) => ({ ...current, enabled }))
                  }
                  disabled={isPending}
                />
              </label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="workflow-prompt">Prompt</Label>
              <Textarea
                id="workflow-prompt"
                rows={8}
                value={form.prompt}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    prompt: event.target.value,
                  }))
                }
                disabled={isPending}
                className="max-h-72 font-mono text-xs [field-sizing:fixed]"
              />
              <p className="text-muted-foreground text-xs">
                Model and agent settings come from your global Pi defaults.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label>Gmail tools</Label>
                <span className="text-muted-foreground text-xs">
                  {disabledTools.size} disabled
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {tools.map((tool) => {
                  const disabled = disabledTools.has(tool.name);
                  return (
                    <label
                      key={tool.name}
                      className={cn(
                        "flex items-start gap-3 rounded-md border px-3 py-3 transition-colors",
                        disabled
                          ? "border-border/50 bg-muted/20 text-muted-foreground"
                          : "border-foreground/15 bg-background",
                      )}
                    >
                      <Checkbox
                        checked={!disabled}
                        onCheckedChange={(checked) =>
                          setToolDisabled(tool.name, checked !== true)
                        }
                        disabled={isPending}
                      />
                      <div className="min-w-0 space-y-1">
                        <div className="font-mono text-xs">{tool.name}</div>
                        <p className="text-muted-foreground text-xs leading-relaxed">
                          {tool.description}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="border-t border-border/60 px-5 py-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" className="gap-2" disabled={isPending}>
              <Save className="size-4" />
              Save workflow
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
