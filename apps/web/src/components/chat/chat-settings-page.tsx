import type {
  PiAgentConfig,
  PiBuiltinToolName,
  PiCredentialSummary,
} from "@g-spot/types";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@g-spot/ui/components/tabs";
import { cn } from "@g-spot/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2, PlugZap } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { PiModelPicker } from "@/components/pi/pi-model-picker";
import { McpView } from "@/components/mcp/mcp-view";
import { PiAddonsView } from "@/components/pi/pi-addons-page";
import { SkillsView } from "@/components/skills/skills-page";
import {
  usePiCatalog,
  usePiDefaults,
  useUpdatePiDefaultsMutation,
} from "@/hooks/use-pi";
import {
  APPROVAL_POLICY_OPTIONS,
  getModelValue,
  NETWORK_ACCESS_OPTIONS,
  type PiModelOption,
  normalizeAgentConfig,
  QUEUE_MODE_OPTIONS,
  SANDBOX_MODE_OPTIONS,
  THINKING_LEVEL_OPTIONS,
  updateAgentConfigModel,
} from "@/lib/pi-agent-config";

export type ChatSettingsTab = "agent" | "addons" | "skills" | "mcp";

const TAB_VALUES: ChatSettingsTab[] = ["agent", "addons", "skills", "mcp"];

export function isChatSettingsTab(value: unknown): value is ChatSettingsTab {
  return typeof value === "string" && (TAB_VALUES as string[]).includes(value);
}

interface ChatSettingsPageProps {
  tab: ChatSettingsTab;
  onTabChange: (tab: ChatSettingsTab) => void;
}

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
    sandboxMode: chat.sandboxMode,
    networkAccess: chat.networkAccess,
    approvalPolicy: chat.approvalPolicy,
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
    sandboxMode: shared.sandboxMode,
    networkAccess: shared.networkAccess,
    approvalPolicy: shared.approvalPolicy,
  };
}

function AgentDefaultsCard({
  allModels,
  configuredProviders,
  oauthProviders,
  tools,
}: {
  allModels: PiModelOption[];
  configuredProviders: Set<string>;
  oauthProviders: Set<string>;
  tools: { name: string; description: string }[];
}) {
  const piDefaults = usePiDefaults();
  const updateDefaults = useUpdatePiDefaultsMutation();
  const [drafts, setDrafts] = useState<{
    chat: PiAgentConfig;
    worker: PiAgentConfig;
  } | null>(null);

  useEffect(() => {
    if (!piDefaults.data) {
      return;
    }

    setDrafts({
      chat: normalizeAgentConfig(piDefaults.data.chat, allModels),
      worker: normalizeAgentConfig(piDefaults.data.worker, allModels),
    });
  }, [allModels, piDefaults.data]);

  const sharedConfig = useMemo(
    () => (drafts ? getSharedDraftConfig(drafts.chat, drafts.worker) : null),
    [drafts],
  );

  if (!drafts || !sharedConfig) {
    return <Skeleton className="h-[720px] w-full rounded-xl" />;
  }

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
            <PiModelPicker
              value={getModelValue({
                provider: drafts.chat.provider,
                id: drafts.chat.modelId,
              })}
              models={allModels}
              configuredProviders={configuredProviders}
              oauthProviders={oauthProviders}
              onValueChange={(value) => {
                setDrafts((current) =>
                  current
                    ? {
                        ...current,
                        chat: normalizeAgentConfig(
                          updateAgentConfigModel(current.chat, value),
                          allModels,
                        ),
                      }
                    : current,
                );
              }}
            />
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
            <PiModelPicker
              value={getModelValue({
                provider: drafts.worker.provider,
                id: drafts.worker.modelId,
              })}
              models={allModels}
              configuredProviders={configuredProviders}
              oauthProviders={oauthProviders}
              onValueChange={(value) => {
                setDrafts((current) =>
                  current
                    ? {
                        ...current,
                        worker: normalizeAgentConfig(
                          updateAgentConfigModel(current.worker, value),
                          allModels,
                        ),
                      }
                    : current,
                );
              }}
            />
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
              value={sharedConfig.thinkingLevel}
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

          <SettingsField label="Steering Mode" description="Controls how the agent sequences planned actions.">
            <ConfigSelect
              value={sharedConfig.steeringMode}
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
              value={sharedConfig.followUpMode}
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

          <SettingsField
            label="Filesystem sandbox"
            description="Read-only blocks writes entirely; workspace-write confines edits to the project path; full access lets the agent touch anything."
          >
            <ConfigSelect
              value={sharedConfig.sandboxMode}
              onValueChange={(sandboxMode) => {
                setDrafts((current) => {
                  if (!current) return current;
                  const nextShared = {
                    ...getSharedDraftConfig(current.chat, current.worker),
                    sandboxMode,
                  };
                  return {
                    chat: applySharedDraftConfig(current.chat, nextShared),
                    worker: applySharedDraftConfig(current.worker, nextShared),
                  };
                });
              }}
              options={SANDBOX_MODE_OPTIONS}
            />
          </SettingsField>

          <SettingsField
            label="Network access"
            description="When off, bash commands that look network-bound (curl, git clone, npm install…) are blocked by default."
          >
            <ConfigSelect
              value={sharedConfig.networkAccess}
              onValueChange={(networkAccess) => {
                setDrafts((current) => {
                  if (!current) return current;
                  const nextShared = {
                    ...getSharedDraftConfig(current.chat, current.worker),
                    networkAccess,
                  };
                  return {
                    chat: applySharedDraftConfig(current.chat, nextShared),
                    worker: applySharedDraftConfig(current.worker, nextShared),
                  };
                });
              }}
              options={NETWORK_ACCESS_OPTIONS}
            />
          </SettingsField>

          <SettingsField
            label="Command approval"
            description="Approval required will prompt you before any write or shell command runs. Auto lets them all through."
          >
            <ConfigSelect
              value={sharedConfig.approvalPolicy}
              onValueChange={(approvalPolicy) => {
                setDrafts((current) => {
                  if (!current) return current;
                  const nextShared = {
                    ...getSharedDraftConfig(current.chat, current.worker),
                    approvalPolicy,
                  };
                  return {
                    chat: applySharedDraftConfig(current.chat, nextShared),
                    worker: applySharedDraftConfig(current.worker, nextShared),
                  };
                });
              }}
              options={APPROVAL_POLICY_OPTIONS}
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
              const checked = sharedConfig.activeToolNames.includes(toolName);
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
  );
}

export function ChatSettingsPage({ tab, onTabChange }: ChatSettingsPageProps) {
  const piCatalog = usePiCatalog();
  const piDefaults = usePiDefaults();

  const allModels = piCatalog.data?.models ?? [];
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
  const tools = useMemo(
    () =>
      (piCatalog.data?.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    [piCatalog.data?.tools],
  );

  const isLoading = piCatalog.isLoading || piDefaults.isLoading;
  const loadError = piCatalog.error ?? piDefaults.error;

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
              <h1 className="font-semibold text-2xl tracking-tight">Agent settings</h1>
              <p className="max-w-2xl text-muted-foreground text-sm leading-relaxed">
                Configure the default Pi agent, add-ons, and skills that apply
                across every project.
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

        <Tabs value={tab} onValueChange={(next) => onTabChange(next as ChatSettingsTab)}>
          <TabsList>
            <TabsTrigger value="agent">Agent</TabsTrigger>
            <TabsTrigger value="addons">Add-ons</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
            <TabsTrigger value="mcp">MCP</TabsTrigger>
          </TabsList>

          <TabsContent value="agent" className="pt-6">
            {isLoading ? (
              <Skeleton className="h-[720px] w-full rounded-xl" />
            ) : (
              <AgentDefaultsCard
                allModels={allModels}
                configuredProviders={configuredProviders}
                oauthProviders={oauthProviders}
                tools={tools}
              />
            )}
          </TabsContent>

          <TabsContent value="addons" className="pt-6">
            <PiAddonsView
              projectId={null}
              description="Pi-managed packages and drop-in extensions that are available across every project. Individual projects can layer on their own add-ons without touching this global scope."
            />
          </TabsContent>

          <TabsContent value="skills" className="pt-6">
            <SkillsView
              projectId={null}
              description="Skills you can use across every project. A project-scoped skill with the same name will shadow the global one inside that project."
            />
          </TabsContent>

          <TabsContent value="mcp" className="pt-6">
            <McpView
              projectId={null}
              description="Global MCP servers — they spawn on app start and are available to every chat in every project. Project-scoped servers from a project's .mcp.json layer on top."
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
