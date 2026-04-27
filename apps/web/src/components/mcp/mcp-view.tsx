import type { McpServerSnapshot } from "@g-spot/types";
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
import { Loader2, RefreshCw, Save, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { McpJsonEditor } from "@/components/mcp/mcp-json-editor";
import {
  useMcpConfig,
  useMcpList,
  useReloadGlobalMcpsMutation,
  useReloadProjectMcpsMutation,
  useSaveRawConfigMutation,
  type McpTargetInput,
} from "@/hooks/use-mcp";

interface McpViewProps {
  /** null = global view (`~/.g-spot/mcp.json`); string = project view (`<path>/.mcp.json`). */
  projectId: string | null;
  /** Used in the help text so the user can locate the on-disk config quickly. */
  projectPath?: string | null;
  description?: string;
}

const EMPTY_DOC = `{
  "mcpServers": {}
}
`;

export function McpView({ projectId, projectPath, description }: McpViewProps) {
  const target: McpTargetInput =
    projectId === null
      ? { scope: "global" }
      : { scope: "project", projectId };
  const scopeKey = projectId === null ? "global" : projectId;

  const list = useMcpList();
  const config = useMcpConfig(target);
  const reloadGlobal = useReloadGlobalMcpsMutation();
  const reloadProject = useReloadProjectMcpsMutation();
  const saveRaw = useSaveRawConfigMutation();

  const baseline = config.data?.raw ?? "";
  const [draft, setDraft] = useState<string>("");
  // Force a fresh CodeMirror mount when switching scopes or when the disk
  // file is reloaded externally — keeps undo history scoped to a single
  // editing session per file.
  const [editorEpoch, setEditorEpoch] = useState(0);

  useEffect(() => {
    if (config.data === undefined) return;
    const next = baseline.length > 0 ? baseline : EMPTY_DOC;
    setDraft(next);
    setEditorEpoch((value) => value + 1);
  }, [config.data, baseline]);

  const isDirty = draft !== (baseline.length > 0 ? baseline : EMPTY_DOC);

  const servers = useMemo(() => {
    const all = list.data ?? [];
    return all.filter((server) =>
      projectId === null
        ? server.scope === "global"
        : server.scope === "project" && server.projectId === projectId,
    );
  }, [list.data, projectId]);

  const configPath =
    config.data?.filePath ??
    (projectId === null
      ? "~/.g-spot/mcp.json"
      : projectPath
        ? `${projectPath}/.mcp.json`
        : "<project>/.mcp.json");

  const reloading =
    projectId === null ? reloadGlobal.isPending : reloadProject.isPending;

  const handleReload = async () => {
    try {
      if (projectId === null) {
        await reloadGlobal.mutateAsync();
      } else {
        await reloadProject.mutateAsync(projectId);
      }
      toast.success("Reloaded MCP servers from disk.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to reload MCP servers",
      );
    }
  };

  const handleRevert = () => {
    setDraft(baseline.length > 0 ? baseline : EMPTY_DOC);
    setEditorEpoch((value) => value + 1);
  };

  const handleSave = async () => {
    try {
      await saveRaw.mutateAsync({ target, raw: draft });
      toast.success("Saved.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save config",
      );
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle>MCP servers</CardTitle>
              <CardDescription>
                {description ??
                  "Model Context Protocol servers running for this scope. Tools they expose are available to the agent."}
              </CardDescription>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={reloading}
              onClick={() => void handleReload()}
            >
              {reloading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Reload
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {list.isPending ? (
            <Skeleton className="h-32 w-full rounded-lg" />
          ) : servers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 bg-background/30 px-4 py-10 text-center text-sm text-muted-foreground">
              No MCP servers configured for this scope. Add one in the editor
              below and click <span className="font-medium text-foreground">Save</span>.
            </div>
          ) : (
            <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
              {servers.map((server) => (
                <McpServerRow
                  key={`${server.scope}:${server.projectId ?? "global"}:${server.name}`}
                  server={server}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle>Config</CardTitle>
              <CardDescription>
                Editing{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  {configPath}
                </code>
                . Standard{" "}
                <code className="font-mono text-[11px]">mcpServers</code> JSON
                shape — the same one Claude Desktop, Claude Code, and Cursor
                use. Set{" "}
                <code className="font-mono text-[11px]">{`"disabled": true`}</code>{" "}
                on an entry to keep its config without spawning the process.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-2"
                disabled={!isDirty || saveRaw.isPending}
                onClick={handleRevert}
              >
                <Undo2 className="size-3.5" />
                Revert
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-2"
                disabled={!isDirty || saveRaw.isPending}
                onClick={() => void handleSave()}
              >
                {saveRaw.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Save
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pb-6">
          {config.isPending ? (
            <Skeleton className="h-80 w-full rounded-lg" />
          ) : (
            <div className="h-[480px] overflow-hidden rounded-lg border border-border/60 bg-background">
              <McpJsonEditor
                key={`${scopeKey}:${editorEpoch}`}
                initialDoc={draft}
                onChange={setDraft}
              />
            </div>
          )}
          {saveRaw.error ? (
            <p className="pt-3 text-destructive text-sm">
              {saveRaw.error instanceof Error
                ? saveRaw.error.message
                : "Save failed."}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function McpServerRow({ server }: { server: McpServerSnapshot }) {
  const status = server.status;
  return (
    <li className="flex items-center justify-between gap-4 bg-background/30 px-4 py-3">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium font-mono text-sm">{server.name}</span>
          <Badge
            variant="outline"
            className="rounded-full px-2 py-0 text-[10px] uppercase tracking-[0.14em]"
          >
            {server.transport}
          </Badge>
        </div>
        <p className="text-muted-foreground text-xs">{describeStatus(status)}</p>
      </div>
      <StatusPill status={status} />
    </li>
  );
}

function describeStatus(status: McpServerSnapshot["status"]): string {
  switch (status.kind) {
    case "ready":
      return `${status.toolCount} tool${status.toolCount === 1 ? "" : "s"} available`;
    case "starting":
      return status.attempt > 1
        ? `Starting (attempt ${status.attempt})…`
        : "Starting…";
    case "disabled":
      return "Disabled in config (disabled: true)";
    case "error": {
      const next =
        status.retryAt != null
          ? ` · retrying in ${Math.max(0, Math.round((status.retryAt - Date.now()) / 1000))}s`
          : " · retries exhausted";
      return `Error: ${status.message}${next}`;
    }
  }
}

function StatusPill({ status }: { status: McpServerSnapshot["status"] }) {
  const tone =
    status.kind === "ready"
      ? "border-emerald-500/30 text-emerald-500"
      : status.kind === "starting"
        ? "border-amber-500/30 text-amber-500"
        : status.kind === "disabled"
          ? "border-border text-muted-foreground"
          : "border-destructive/40 text-destructive";

  const label =
    status.kind === "ready"
      ? "Ready"
      : status.kind === "starting"
        ? "Starting"
        : status.kind === "disabled"
          ? "Disabled"
          : "Error";

  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em]",
        tone,
      )}
    >
      {label}
    </Badge>
  );
}
