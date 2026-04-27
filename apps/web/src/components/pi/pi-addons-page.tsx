import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@g-spot/ui/components/card";
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
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { cn } from "@g-spot/ui/lib/utils";
import {
  FolderOpen,
  Loader2,
  Package2,
  PlugZap,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PiAddonExplorerDialog } from "@/components/pi/pi-addon-explorer-dialog";
import { useConfirmDialog } from "@/contexts/confirm-dialog-context";
import {
  useInstallPiAddonMutation,
  usePiAddons,
  useRemovePiAddonMutation,
} from "@/hooks/use-pi";
import { useProject } from "@/hooks/use-projects";
import { trpcClient } from "@/utils/trpc";

type PiAddonInventory = Awaited<ReturnType<typeof trpcClient.pi.listAddons.query>>;
type PiAddonPackage = PiAddonInventory["packages"][number];
type PiAddonDropIn = PiAddonInventory["dropInExtensions"][number];

type PiAddonsViewProps = {
  projectId: string | null;
  description?: string;
};

export function PiAddonsView({ projectId, description }: PiAddonsViewProps) {
  const projectQuery = useProject(projectId);
  const addonsQuery = usePiAddons(projectId);
  const removeAddon = useRemovePiAddonMutation();
  const confirm = useConfirmDialog();

  const [explorerOpen, setExplorerOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const inventory = addonsQuery.data;
  const isProjectScope = projectId !== null;
  const scopeLabel = isProjectScope ? "Project scope" : "Global scope";
  const projectPath = projectQuery.data?.path ?? null;
  const isLoading =
    addonsQuery.isLoading || (isProjectScope && projectQuery.isLoading);
  const loadError = addonsQuery.error ?? projectQuery.error;

  const packages = inventory?.packages ?? [];
  const dropIns = inventory?.dropInExtensions ?? [];
  const hasAny = packages.length + dropIns.length > 0;

  async function handleRemove(addonSource: string) {
    const confirmed = await confirm({
      title: "Remove add-on?",
      description: `Remove "${addonSource}" from ${scopeLabel.toLowerCase()}?`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await removeAddon.mutateAsync({ projectId, source: addonSource });
      toast.success("Add-on removed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove add-on",
      );
    }
  }

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
            onClick={() => setManualOpen(true)}
            className="gap-2"
          >
            <PlugZap className="size-4" />
            Install by source
          </Button>
          <Button
            size="sm"
            onClick={() => setExplorerOpen(true)}
            className="gap-2"
          >
            <Sparkles className="size-4" />
            Explore add-ons
          </Button>
        </div>
      </div>

      {loadError ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-5">
            <p className="text-sm">
              {loadError instanceof Error
                ? loadError.message
                : "Could not load Pi add-ons."}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : !hasAny ? (
        <Card>
          <CardHeader>
            <CardTitle>No add-ons yet</CardTitle>
            <CardDescription className="leading-relaxed">
              Add-ons are Pi packages — extensions, skills, themes, or
              prompts — that load into{" "}
              {isProjectScope ? "this project" : "every chat"}. Browse the
              pi.dev directory, or install any npm package, git source, or
              local path by hand.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              onClick={() => setExplorerOpen(true)}
              className="gap-2"
            >
              <Sparkles className="size-4" />
              Explore add-ons
            </Button>
            <Button
              variant="outline"
              onClick={() => setManualOpen(true)}
              className="gap-2"
            >
              <PlugZap className="size-4" />
              Install by source
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {packages.length > 0 ? (
            <section className="space-y-3">
              <SectionLabel
                icon={<Package2 className="size-3.5" />}
                label="Packages"
                count={packages.length}
              />
              <div className="grid gap-2">
                {packages.map((addon) => (
                  <PackageRow
                    key={addon.source}
                    addon={addon}
                    removing={
                      removeAddon.isPending &&
                      removeAddon.variables?.projectId === projectId &&
                      removeAddon.variables?.source === addon.source
                    }
                    onRemove={() => void handleRemove(addon.source)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {dropIns.length > 0 ? (
            <section className="space-y-3">
              <SectionLabel
                icon={<FolderOpen className="size-3.5" />}
                label="Drop-ins"
                count={dropIns.length}
              />
              <div className="grid gap-2">
                {dropIns.map((extension) => (
                  <DropInRow key={extension.path} extension={extension} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}

      {inventory ? (
        <p className="pt-2 text-muted-foreground text-xs leading-relaxed">
          Managed directory{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
            {inventory.directory}
          </code>
          {projectPath ? (
            <>
              {" · Project path "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                {projectPath}
              </code>
            </>
          ) : null}
        </p>
      ) : null}

      <PiAddonExplorerDialog
        open={explorerOpen}
        onOpenChange={setExplorerOpen}
        projectId={projectId}
      />

      <ManualInstallDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        projectId={projectId}
      />
    </div>
  );
}

function SectionLabel({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground text-[11px] uppercase tracking-[0.18em]">
        {icon}
        {label}
      </span>
      <span className="text-muted-foreground/60 text-xs">{count}</span>
    </div>
  );
}

function PackageRow({
  addon,
  removing,
  onRemove,
}: {
  addon: PiAddonPackage;
  removing: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2.5">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {addon.source}
          </code>
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
            {addon.extensionCount} extension
            {addon.extensionCount === 1 ? "" : "s"}
          </Badge>
          {addon.filtered ? (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
              filtered
            </Badge>
          ) : null}
        </div>
        {addon.installedPath ? (
          <p className="break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
            {addon.installedPath}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn("shrink-0 text-muted-foreground hover:text-destructive")}
        aria-label={`Remove ${addon.source}`}
        disabled={removing}
        onClick={onRemove}
      >
        {removing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Trash2 className="size-3.5" />
        )}
      </Button>
    </div>
  );
}

function DropInRow({ extension }: { extension: PiAddonDropIn }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2.5">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="break-all font-mono text-xs leading-relaxed">
          {extension.path}
        </p>
      </div>
      <Badge
        variant={extension.enabled ? "secondary" : "outline"}
        className="px-1.5 py-0 text-[10px] font-normal"
      >
        {extension.enabled ? "enabled" : "disabled"}
      </Badge>
    </div>
  );
}

function ManualInstallDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
}) {
  const installAddon = useInstallPiAddonMutation();
  const [source, setSource] = useState("");
  const trimmedSource = source.trim();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (trimmedSource.length === 0) return;
    try {
      await installAddon.mutateAsync({ projectId, source: trimmedSource });
      setSource("");
      onOpenChange(false);
      toast.success("Add-on installed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not install add-on",
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSource("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlugZap className="size-4 text-muted-foreground" />
            Install by source
          </DialogTitle>
          <DialogDescription>
            Point Pi at an npm package, git repo, or absolute local path. The
            next chat run picks it up from the Pi package manager.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="addon-source">Source</Label>
            <Input
              id="addon-source"
              autoFocus
              placeholder="npm:@scope/pi-addon, github:user/repo, /absolute/path"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              Tip — the explorer installs npm packages from pi.dev for you. Use
              this for private repos or local paths.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="gap-2"
              disabled={trimmedSource.length === 0 || installAddon.isPending}
            >
              {installAddon.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Install
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
