import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@g-spot/ui/components/select";
import { cn } from "@g-spot/ui/lib/utils";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import {
  CHAT_MODELS,
  type ChatModelId,
} from "@/hooks/use-chat-preferences";

type ChatModelPreferenceControlProps = {
  className?: string;
  fieldId?: string;
  label: string;
  value: ChatModelId;
  isSaving: boolean;
  onChange: (model: ChatModelId) => Promise<void>;
  successMessage: string;
  errorMessage: string;
  description?: string;
  triggerClassName?: string;
};

export function ChatModelPreferenceControl({
  className,
  fieldId,
  label,
  value,
  isSaving,
  onChange,
  successMessage,
  errorMessage,
  description,
  triggerClassName,
}: ChatModelPreferenceControlProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={fieldId} className="font-medium text-xs">
          {label}
        </label>
        {isSaving ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
            <Loader2Icon className="size-3 animate-spin" />
            Saving
          </span>
        ) : null}
      </div>

      <Select
        value={value}
        onValueChange={(nextValue) => {
          void onChange(nextValue as ChatModelId)
            .then(() => {
              toast.success(successMessage);
            })
            .catch((error) => {
              toast.error(
                error instanceof Error ? error.message : errorMessage,
              );
            });
        }}
      >
        <SelectTrigger
          id={fieldId}
          className={cn("h-9 w-full", triggerClassName)}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CHAT_MODELS.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {description ? (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {description}
        </p>
      ) : null}
    </div>
  );
}
