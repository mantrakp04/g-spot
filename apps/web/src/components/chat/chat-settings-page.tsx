import type { PiAgentConfig, PiBuiltinToolName } from "@g-spot/types";
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
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { cn } from "@g-spot/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2, PlugZap } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  usePiCatalog,
  usePiDefaults,
  useUpdatePiDefaultsMutation,
} from "@/hooks/use-pi";
import {
  getModelValue,
  type PiModelOption,
  normalizeAgentConfig,
  prettyProviderName,
  QUEUE_MODE_OPTIONS,
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

function getSharedDraftConfig(chat: PiAgentConfig, worker: PiAgentConfig): PiAgentConfig {
  return {
    ...chat,
    thinkingLevel: chat.thinkingLevel,
    transport: chat.transport,
    steeringMode: chat.steeringMode,
    followUpMode: chat.followUpMode,
    activeToolNames: chat.activeToolNames,
  };
}

function applySharedDraftConfig(
  config: PiAgentConfig,
  shared: PiAgentConfig,
): PiAgentConfig {
  return {
    ...config,
    thinkingLevel: shared.thinkingLevel,
    transport: shared.transport,
    steeringMode: shared.steeringMode,
    followUpMode: shared.followUpMode,
    activeToolNames: shared.activeToolNames,
  };
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

export function ChatSettingsPage() {
  const piCatalog = usePiCatalog();
  const piDefaults = usePiDefaults();
  const updateDefaults = useUpdatePiDefaultsMutation();
  const [drafts, setDrafts] = useState<{
    chat: PiAgentConfig;
    worker: PiAgentConfig;
  } | null>(null);

  const allModels = piCatalog.data?.models ?? [];
  const configuredProviders = useMemo(
    () =>
      new Set(
        (piCatalog.data?.configuredProviders ?? []).map((provider) => provider.provider),
      ),
    [piCatalog.data?.configuredProviders],
  );
  const tools = useMemo(
    () =>
      (piCatalog.data?.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    [piCatalog.data?.tools],
  );
  const modelOptions = useMemo(
    () =>
      allModels.map((model) => ({
        value: getModelValue(model),
        label: model.name,
        providerLabel: prettyProviderName(model.provider),
        provider: model.provider,
      })),
    [allModels],
  );

  useEffect(() => {
    if (!piDefaults.data) {
      return;
    }

    setDrafts({
      chat: normalizeAgentConfig(piDefaults.data.chat, allModels),
      worker: normalizeAgentConfig(piDefaults.data.worker, allModels),
    });
  }, [allModels, piDefaults.data]);

  const isLoading = piCatalog.isLoading || piDefaults.isLoading || drafts === null;
  const loadError = piCatalog.error ?? piDefaults.error;
  const sharedConfig = useMemo(
    () => (drafts ? getSharedDraftConfig(drafts.chat, drafts.worker) : null),
    [drafts],
  );

  async function saveDefaults() {
    if (!drafts) {
      return;
    }

    const nextSharedConfig = getSharedDraftConfig(drafts.chat, drafts.worker);
    await updateDefaults.mutateAsync({
      chat: applySharedDraftConfig(drafts.chat, nextSharedConfig),
      worker: applySharedDraftConfig(drafts.worker, nextSharedConfig),
    });
    toast.success("Pi defaults updated");
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto max-w-5xl space-y-8 px-4 py-12">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <Link
              to="/chat"
              className="inline-flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              Back to chat
            </Link>

            <header className="space-y-2">
              <h1 className="font-semibold text-2xl tracking-tight">Pi agent settings</h1>
              <p className="max-w-2xl text-muted-foreground text-sm leading-relaxed">
                Configure the default Pi provider, model, reasoning, transport, queueing,
                and active tools for new chats and background work.
              </p>
            </header>
          </div>

          <Link
            to="/settings/connections"
            className="inline-flex h-7 items-center gap-2 border border-border bg-background px-2.5 text-xs transition-colors hover:bg-muted hover:text-foreground"
          >
            <PlugZap className="size-4" />
            Manage provider auth
          </Link>
        </div>

        {loadError ? (
          <Card className="rounded-xl border-destructive/30 bg-destructive/5">
            <CardContent className="py-5">
              <p className="text-sm">
                {loadError instanceof Error
                  ? loadError.message
                  : "Could not load Pi settings."}
              </p>
            </CardContent>
          </Card>
        ) : null}

        {isLoading ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-[720px] rounded-xl" />
            <Skeleton className="h-[720px] rounded-xl" />
          </div>
        ) : drafts ? (
          <Card className="rounded-xl border border-border/70 bg-background/75 backdrop-blur-sm">
            <CardHeader className="gap-3">
              <div className="space-y-1">
                <CardTitle>Pi Defaults</CardTitle>
                <CardDescription>
                  Chat and worker agents now share the same settings. Only the selected
                  model can differ between them.
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <SettingsField
                  label="Chat Model"
                  description="Applied to new interactive chat sessions."
                >
                  <Select
                    value={getModelValue({
                      provider: drafts.chat.provider,
                      id: drafts.chat.modelId,
                    })}
                    onValueChange={(value) => {
                      if (!value) {
                        return;
                      }
                      setDrafts((current) =>
                        current
                          ? {
                              ...current,
                              chat: normalizeAgentConfig(
                                updateDraftModel(current.chat, value),
                                allModels,
                              ),
                            }
                          : current,
                      );
                    }}
                  >
                    <SelectTrigger className="w-full bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modelOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label} · {option.providerLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Badge
                    variant="outline"
                    className={cn(
                      "mt-2 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]",
                      configuredProviders.has(drafts.chat.provider)
                        ? "border-emerald-500/25 text-emerald-600"
                        : "border-border/80 text-muted-foreground",
                    )}
                  >
                    {configuredProviders.has(drafts.chat.provider)
                      ? "Provider ready"
                      : "Needs auth"}
                  </Badge>
                </SettingsField>

                <SettingsField
                  label="Worker Model"
                  description="Applied to background tasks like title generation."
                >
                  <Select
                    value={getModelValue({
                      provider: drafts.worker.provider,
                      id: drafts.worker.modelId,
                    })}
                    onValueChange={(value) => {
                      if (!value) {
                        return;
                      }
                      setDrafts((current) =>
                        current
                          ? {
                              ...current,
                              worker: normalizeAgentConfig(
                                updateDraftModel(current.worker, value),
                                allModels,
                              ),
                            }
                          : current,
                      );
                    }}
                  >
                    <SelectTrigger className="w-full bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modelOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label} · {option.providerLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Badge
                    variant="outline"
                    className={cn(
                      "mt-2 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]",
                      configuredProviders.has(drafts.worker.provider)
                        ? "border-emerald-500/25 text-emerald-600"
                        : "border-border/80 text-muted-foreground",
                    )}
                  >
                    {configuredProviders.has(drafts.worker.provider)
                      ? "Provider ready"
                      : "Needs auth"}
                  </Badge>
                </SettingsField>

                <SettingsField label="Thinking" description="Controls how much reasoning budget the agent should spend.">
                  <ConfigSelect
                    value={sharedConfig!.thinkingLevel}
                    onValueChange={(thinkingLevel) => {
                      setDrafts((current) => {
                        if (!current) return current;
                        const nextShared = {
                          ...getSharedDraftConfig(current.chat, current.worker),
                          thinkingLevel,
                        };
                        return {
                          chat: applySharedDraftConfig(current.chat, nextShared),
                          worker: applySharedDraftConfig(current.worker, nextShared),
                        };
                      });
                    }}
                    options={THINKING_LEVEL_OPTIONS}
                  />
                </SettingsField>

                <SettingsField label="Transport" description="Choose how Pi should stream responses when the provider supports it.">
                  <ConfigSelect
                    value={sharedConfig!.transport}
                    onValueChange={(transport) => {
                      setDrafts((current) => {
                        if (!current) return current;
                        const nextShared = {
                          ...getSharedDraftConfig(current.chat, current.worker),
                          transport,
                        };
                        return {
                          chat: applySharedDraftConfig(current.chat, nextShared),
                          worker: applySharedDraftConfig(current.worker, nextShared),
                        };
                      });
                    }}
                    options={TRANSPORT_OPTIONS}
                  />
                </SettingsField>

                <SettingsField label="Steering Mode" description="Controls how the agent sequences planned actions.">
                  <ConfigSelect
                    value={sharedConfig!.steeringMode}
                    onValueChange={(steeringMode) => {
                      setDrafts((current) => {
                        if (!current) return current;
                        const nextShared = {
                          ...getSharedDraftConfig(current.chat, current.worker),
                          steeringMode,
                        };
                        return {
                          chat: applySharedDraftConfig(current.chat, nextShared),
                          worker: applySharedDraftConfig(current.worker, nextShared),
                        };
                      });
                    }}
                    options={QUEUE_MODE_OPTIONS}
                  />
                </SettingsField>

                <SettingsField label="Follow-Up Mode" description="Controls how follow-up work gets queued after each step.">
                  <ConfigSelect
                    value={sharedConfig!.followUpMode}
                    onValueChange={(followUpMode) => {
                      setDrafts((current) => {
                        if (!current) return current;
                        const nextShared = {
                          ...getSharedDraftConfig(current.chat, current.worker),
                          followUpMode,
                        };
                        return {
                          chat: applySharedDraftConfig(current.chat, nextShared),
                          worker: applySharedDraftConfig(current.worker, nextShared),
                        };
                      });
                    }}
                    options={QUEUE_MODE_OPTIONS}
                  />
                </SettingsField>
              </div>

              <Separator />

              <SettingsField
                label="Active Tools"
                description="These built-in Pi coding tools will be enabled for new sessions."
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  {tools.map((tool) => {
                    const toolName = tool.name as PiBuiltinToolName;
                    const checked = sharedConfig!.activeToolNames.includes(toolName);
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
                            setDrafts((current) => {
                              if (!current) return current;
                              const currentShared = getSharedDraftConfig(current.chat, current.worker);
                              const nextToolNames = nextChecked
                                ? Array.from(new Set([...currentShared.activeToolNames, toolName]))
                                : currentShared.activeToolNames.filter((name) => name !== toolName);
                              const nextShared = {
                                ...currentShared,
                                activeToolNames:
                                  nextToolNames.length > 0
                                    ? nextToolNames
                                    : currentShared.activeToolNames,
                              };
                              return {
                                chat: applySharedDraftConfig(current.chat, nextShared),
                                worker: applySharedDraftConfig(current.worker, nextShared),
                              };
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
            </CardContent>

            <CardFooter className="justify-between gap-3">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Provider auth is managed in Connections.
              </p>
              <Button
                type="button"
                size="sm"
                className="gap-2"
                disabled={updateDefaults.isPending}
                onClick={() => {
                  void saveDefaults();
                }}
              >
                {updateDefaults.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Save defaults
              </Button>
            </CardFooter>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
