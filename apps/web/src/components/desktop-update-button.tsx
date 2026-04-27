import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@g-spot/ui/components/button";
import type { DesktopUpdateState } from "@g-spot/types/desktop";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { getDesktopRpc, isDesktopRuntime } from "@/lib/desktop-rpc";

const initialState: DesktopUpdateState = {
  phase: "idle",
  channel: "unknown",
  currentVersion: "unknown",
  latestVersion: null,
  updateAvailable: false,
  updateReady: false,
  error: null,
};

const busyPhases = new Set<DesktopUpdateState["phase"]>([
  "checking",
  "downloading",
  "applying",
  "migrating",
]);

export function DesktopUpdateButton() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [state, setState] = useState<DesktopUpdateState>(initialState);

  useEffect(() => {
    const desktop = isDesktopRuntime();
    setIsDesktop(desktop);
    if (!desktop) return;

    let cancelled = false;

    const handleUpdateState = (event: Event) => {
      setState((event as CustomEvent<DesktopUpdateState>).detail);
    };

    window.addEventListener("desktop-update-state", handleUpdateState);

    void getDesktopRpc()
      .then((rpc) => rpc?.requestProxy.getUpdateState())
      .then((nextState) => {
        if (!cancelled && nextState) setState(nextState);
      })
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setState((prev) => ({ ...prev, phase: "error", error: message }));
        }
      });

    return () => {
      cancelled = true;
      window.removeEventListener("desktop-update-state", handleUpdateState);
    };
  }, []);

  const isBusy = busyPhases.has(state.phase);
  const label = useMemo(() => {
    if (state.phase === "checking") return "Checking";
    if (state.phase === "downloading") return "Downloading";
    if (state.phase === "applying") return "Restarting";
    if (state.phase === "ready") return "Install update";
    return "Update";
  }, [state.phase]);

  const handleUpdate = useCallback(async () => {
    const rpc = await getDesktopRpc();
    if (!rpc) return;

    try {
      const migrationResult = await rpc.requestProxy.runMigrations();
      if (!migrationResult.ok) {
        toast.error("Migration failed", {
          description: migrationResult.error ?? "Could not migrate the local database.",
        });
        return;
      }

      const checked = await rpc.requestProxy.checkForUpdate();
      if (checked.error) {
        toast.error("Update check failed", { description: checked.error });
        return;
      }

      if (!checked.updateAvailable) {
        toast.info("Already up to date");
        return;
      }

      const downloaded = await rpc.requestProxy.downloadUpdate();
      if (downloaded.error) {
        toast.error("Update download failed", { description: downloaded.error });
        return;
      }

      await rpc.requestProxy.installUpdate();
    } catch (error) {
      toast.error("Update failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  if (!isDesktop || (!state.updateAvailable && !state.updateReady && !isBusy)) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2"
      disabled={isBusy}
      onClick={handleUpdate}
    >
      {isBusy ? <RefreshCw className="size-4" /> : <Download className="size-4" />}
      <span className="truncate">{label}</span>
    </Button>
  );
}
