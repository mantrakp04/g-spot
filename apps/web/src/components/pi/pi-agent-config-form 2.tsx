import type { PiAgentConfig, PiBuiltinToolName } from "@g-spot/types";
import { Badge } from "@g-spot/ui/components/badge";
import { Checkbox } from "@g-spot/ui/components/checkbox";
import { Label } from "@g-spot/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@g-spot/ui/components/select";
import { Separator } from "@g-spot/ui/components/separator";
import { cn } from "@g-spot/ui/lib/utils";
import type { ReactNode } from "react";

import {
  APPROVAL_POLICY_OPTIONS,
  getModelValue,
  NETWORK_ACCESS_OPTIONS,
  type PiModelOption,
  prettyProviderName,
  QUEUE_MODE_OPTIONS,
  SANDBOX_MODE_OPTIONS,
  THINKING_LEVEL_OPTIONS,
  TRANSPORT_OPTIONS,
} from "@/lib/pi-agent-config";

function SettingsField({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <p className="font-medium text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        {description ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function ConfigSelect<TValue extends string>({
  value,
  onValueChange,
  options,
  placeholder,
}: {
  value: TValue;
  onValueChange: (value: TValue) => void;
  options: ReadonlyArray<{ value: TValue; label: string }>;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue as TValue)}>
      <SelectTrigger className="w-full bg-background">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function updateDraftModel(
  config: PiAgentConfig,
  value: string,
): PiAgentConfig {
  const [provider, modelId] = value.split("::");
  if (!provider || !modelId) {
    return config;
  }

  return {
    ...config,
    provider,
    modelId,
  };
}

/**
 * Loosely-typed tool descriptor — the trpc catalog returns a structurally
 * compatible object that doesn't quite line up with the Pi SDK's internal
 * `ToolInfo` (the `parameters` schema type is generic in the SDK), so this
 * form narrows to just the fields the UI actually reads.
 */
export type PiToolSummary = {
  name: string;
  description: string;
};

interface PiAgentConfigFormProps {
  /**
   * Parsed, normalized config. The form is a pure `value` + `onChange` with
   * no internal draft state — the parent decides when to persist.
   */
  value: PiAgentConfig;
  onChange: (next: PiAgentConfig) => void;
  models: PiModelOption[];
  tools: PiToolSummary[];
  configuredProviders: Set<string>;
  /** Hide model select — useful for the worker row on `/chat/settings`. */
  showModel?: boolean;
  modelLabel?: string;
  modelDescription?: string;
}

export function PiAgentConfigForm({
  value,
  onChange,
  models,
  tools,
  configuredProviders,
  showModel = true,
  modelLabel = "Model",
  modelDescription,
}: PiAgentConfigFormProps) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        {showModel ? (
          <SettingsField label={modelLabel} description={modelDescription}>
            <Select
              value={getModelValue({
                provider: value.provider,
                id: value.modelId,
              })}
              onValueChange={(selected) => {
                if (!selected) return;
                onChange(updateDraftModel(value, selected));
              }}
            >
              <SelectTrigger className="w-full bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem
                    key={getModelValue(model)}
                    value={getModelValue(model)}
                  >
                    {model.name} · {prettyProviderName(model.provider)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge
              variant="outline"
              className={cn(
                "mt-2 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]",
                configuredProviders.has(value.provider)
                  ? "border-emerald-500/25 text-emerald-600"
                  : "border-border/80 text-muted-foreground",
              )}
            >
              {configuredProviders.has(value.provider)
                ? "Provider ready"
                : "Needs auth"}
            </Badge>
          </SettingsField>
        ) : null}

        <SettingsField
          label="Thinking"
          description="Controls how much reasoning budget the agent should spend."
        >
          <ConfigSelect
            value={value.thinkingLevel}
            onValueChange={(thinkingLevel) =>
              onChange({ ...value, thinkingLevel })
            }
            options={THINKING_LEVEL_OPTIONS}
          />
        </SettingsField>

        <SettingsField
          label="Transport"
          description="Choose how Pi should stream responses when the provider supports it."
        >
          <ConfigSelect
            value={value.transport}
            onValueChange={(transport) => onChange({ ...value, transport })}
            options={TRANSPORT_OPTIONS}
          />
        </SettingsField>

        <SettingsField
          label="Steering mode"
          description="Controls how the agent sequences planned actions."
        >
          <ConfigSelect
            value={value.steeringMode}
            onValueChange={(steeringMode) =>
              onChange({ ...value, steeringMode })
            }
            options={QUEUE_MODE_OPTIONS}
          />
        </SettingsField>

        <SettingsField
          label="Follow-up mode"
          description="Controls how follow-up work gets queued after each step."
        >
          <ConfigSelect
            value={value.followUpMode}
            onValueChange={(followUpMode) =>
              onChange({ ...value, followUpMode })
            }
            options={QUEUE_MODE_OPTIONS}
          />
        </SettingsField>

        <SettingsField
          label="Filesystem sandbox"
          description="Read-only blocks writes entirely; workspace-write confines edits to the project path; full access lets the agent touch anything."
        >
          <ConfigSelect
            value={value.sandboxMode}
            onValueChange={(sandboxMode) =>
              onChange({ ...value, sandboxMode })
            }
            options={SANDBOX_MODE_OPTIONS}
          />
        </SettingsField>

        <SettingsField
          label="Network access"
          description="When off, bash commands that look network-bound (curl, git clone, npm install…) are blocked by default."
        >
          <ConfigSelect
            value={value.networkAccess}
            onValueChange={(networkAccess) =>
              onChange({ ...value, networkAccess })
            }
            options={NETWORK_ACCESS_OPTIONS}
          />
        </SettingsField>

        <SettingsField
          label="Command approval"
          description="Approval required will prompt you before any write or shell command runs. Auto lets them all through."
        >
          <ConfigSelect
            value={value.approvalPolicy}
            onValueChange={(approvalPolicy) =>
              onChange({ ...value, approvalPolicy })
            }
            options={APPROVAL_POLICY_OPTIONS}
          />
        </SettingsField>
      </div>

      <Separator />

      <SettingsField
        label="Active tools"
        description="These built-in Pi coding tools will be enabled for sessions using this config."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {tools.map((tool) => {
            const toolName = tool.name as PiBuiltinToolName;
            const checked = value.activeToolNames.includes(toolName);
            return (
              <label
                key={tool.name}
                className={cn(
                  "flex items-start gap-3 rounded-lg border border-border/60 px-3 py-3 transition-colors",
                  checked ? "border-foreground/20 bg-muted/40" : "bg-background",
                )}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(nextChecked) => {
                    const nextToolNames = nextChecked
                      ? Array.from(
                          new Set([...value.activeToolNames, toolName]),
                        )
                      : value.activeToolNames.filter(
                          (name) => name !== toolName,
                        );
                    onChange({
                      ...value,
                      activeToolNames:
                        nextToolNames.length > 0
                          ? nextToolNames
                          : value.activeToolNames,
                    });
                  }}
                />
                <div className="space-y-1">
                  <Label className="font-medium text-sm leading-none">
                    {tool.name}
                  </Label>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {tool.description}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
      </SettingsField>
    </div>
  );
}
