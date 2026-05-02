import { Button } from "@g-spot/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@g-spot/ui/components/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@g-spot/ui/components/popover";
import { cn } from "@g-spot/ui/lib/utils";
import {
  Check,
  ChevronDown,
  ChevronsUpDown,
  KeyRound,
  LinkIcon,
  Minus,
} from "lucide-react";
import { useEffect, useMemo, useState, type ComponentProps } from "react";

import { ModelSelectorLogo } from "@/components/ai-elements/model-selector";
import { usePiCredentialFlows } from "@/contexts/pi-credential-flows-context";
import {
  getModelValue,
  prettyProviderName,
  type PiModelOption,
} from "@/lib/pi-agent-config";

type PopoverAlign = ComponentProps<typeof PopoverContent>["align"];

type PiModelPickerProps = {
  models: readonly PiModelOption[];
  value: string;
  onValueChange: (value: string) => void;
  configuredProviders?: ReadonlySet<string>;
  oauthProviders?: ReadonlySet<string>;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  align?: PopoverAlign;
  placeholder?: string;
  emptyMessage?: string;
};

type ProviderGroup = {
  provider: string;
  providerName: string;
  configured: boolean;
  supportsOauth: boolean;
  models: Array<PiModelOption & { value: string }>;
};

function getAuthHint(group: Pick<ProviderGroup, "configured" | "supportsOauth">) {
  if (group.configured) return "Ready";
  return group.supportsOauth ? "OAuth or API key" : "API key";
}

export function PiModelPicker({
  models,
  value,
  onValueChange,
  configuredProviders,
  oauthProviders,
  disabled = false,
  compact = false,
  className,
  align = "start",
  placeholder = "Search models...",
  emptyMessage = "No models found.",
}: PiModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const piFlows = usePiCredentialFlows();

  const selectedModel =
    models.find((model) => getModelValue(model) === value) ?? null;

  const groups = useMemo(() => {
    const byProvider = new Map<string, ProviderGroup>();

    for (const model of models) {
      const provider = model.provider;
      const existing = byProvider.get(provider);
      const configured = configuredProviders?.has(provider) ?? false;
      const supportsOauth = oauthProviders?.has(provider) ?? false;

      if (!existing) {
        byProvider.set(provider, {
          provider,
          providerName: prettyProviderName(provider),
          configured,
          supportsOauth,
          models: [{ ...model, value: getModelValue(model) }],
        });
        continue;
      }

      existing.models.push({ ...model, value: getModelValue(model) });
    }

    return [...byProvider.values()]
      .map((group) => ({
        ...group,
        models: [...group.models].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => {
        if (a.configured !== b.configured) return a.configured ? -1 : 1;
        return a.providerName.localeCompare(b.providerName);
      });
  }, [configuredProviders, models, oauthProviders]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    if (
      selectedModel &&
      groups.some((group) => group.provider === selectedModel.provider)
    ) {
      setSelectedProvider(selectedModel.provider);
      return;
    }

    setSelectedProvider(groups[0]?.provider ?? null);
  }, [groups, open, selectedModel]);

  const activeGroup = useMemo(
    () =>
      groups.find((group) => group.provider === selectedProvider) ??
      groups[0] ??
      null,
    [groups, selectedProvider],
  );

  const visibleModels = useMemo(() => {
    if (!activeGroup) return [];
    const q = query.trim().toLowerCase();
    if (q.length === 0) return activeGroup.models;
    return activeGroup.models.filter((model) =>
      [model.name, activeGroup.providerName, activeGroup.provider].some((field) =>
        field.toLowerCase().includes(q),
      ),
    );
  }, [activeGroup, query]);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant={compact ? "ghost" : "outline"}
            size={compact ? "sm" : "default"}
            className={cn(
              compact
                ? "text-muted-foreground hover:text-foreground dark:bg-input/30 dark:hover:bg-input/50"
                : "h-auto w-full justify-between px-2.5 py-2 text-left",
              className,
            )}
            disabled={disabled}
          />
        }
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {selectedModel ? (
            <>
              <ModelSelectorLogo
                provider={selectedModel.provider}
                className={cn("shrink-0", compact ? "size-3.5" : "size-4")}
              />
              {compact ? (
                <span className="min-w-0 truncate">{selectedModel.name}</span>
              ) : (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {selectedModel.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {prettyProviderName(selectedModel.provider)}
                  </span>
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">
              {compact ? "Select model" : "Choose a model"}
            </span>
          )}
        </span>
        {compact ? (
          <ChevronDown className="shrink-0 opacity-60" />
        ) : (
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </PopoverTrigger>

      <PopoverContent
        align={align}
        className="w-[min(30rem,calc(100vw-2rem))] overflow-hidden p-0"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        sideOffset={6}
      >
        <Command className="bg-transparent" shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={query}
            onValueChange={setQuery}
          />
          <div className="flex h-[22rem] min-h-0">
            <div className="flex w-11 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-1">
              {groups.map((group) => {
                const isActive = group.provider === activeGroup?.provider;
                return (
                  <button
                    key={group.provider}
                    type="button"
                    aria-label={group.providerName}
                    aria-pressed={isActive}
                    title={group.providerName}
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors",
                      isActive
                        ? "bg-muted text-foreground"
                        : "hover:bg-muted/60 hover:text-foreground",
                    )}
                    onClick={() => setSelectedProvider(group.provider)}
                  >
                    <ModelSelectorLogo
                      provider={group.provider}
                      className={cn(
                        "size-4 transition-opacity",
                        !isActive && "opacity-70",
                      )}
                    />
                  </button>
                );
              })}
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              {activeGroup ? (
                <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
                  <ModelSelectorLogo
                    provider={activeGroup.provider}
                    className="size-4 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {activeGroup.providerName}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {activeGroup.configured ? (
                        <Check className="size-3 text-emerald-500" />
                      ) : activeGroup.supportsOauth ? (
                        <LinkIcon className="size-3" />
                      ) : (
                        <KeyRound className="size-3" />
                      )}
                      <span>{getAuthHint(activeGroup)}</span>
                      <span aria-hidden="true" className="text-border">
                        ·
                      </span>
                      <span>{activeGroup.models.length} models</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {activeGroup.configured ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="gap-1 text-muted-foreground hover:text-destructive"
                        onClick={() => void piFlows.removeCredential(activeGroup.provider)}
                        disabled={piFlows.isRemoving}
                      >
                        <Minus className="size-3" strokeWidth={2.5} />
                        Remove
                      </Button>
                    ) : (
                      <>
                        {activeGroup.supportsOauth ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="gap-1 text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              void piFlows.connectOAuth(activeGroup.provider)
                            }
                            disabled={piFlows.isConnectingOAuth}
                          >
                            <LinkIcon className="size-3" />
                            OAuth
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="gap-1 text-muted-foreground hover:text-foreground"
                          onClick={() => piFlows.configureApiKey(activeGroup.provider)}
                        >
                          <KeyRound className="size-3" />
                          API Key
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ) : null}

              <CommandList className="h-full max-h-full flex-1 overflow-y-auto">
                <CommandEmpty>{emptyMessage}</CommandEmpty>
                {activeGroup ? (
                  <CommandGroup className="p-1">
                    {visibleModels.map((model) => {
                      const isSelected = model.value === value;
                      const isDisabled = !activeGroup.configured;
                      return (
                        <CommandItem
                          key={model.value}
                          value={model.value}
                          data-checked={isSelected}
                          disabled={isDisabled}
                          onSelect={() => {
                            if (isDisabled) return;
                            onValueChange(model.value);
                            setOpen(false);
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">
                            {model.name}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ) : null}
              </CommandList>
            </div>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
