import type { DesktopUpdateState, DesktopRpcSchema } from "@g-spot/types/desktop";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";

const DEV_SERVER_PORT = 3001;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const APP_IDENTIFIER = "dev.bettertstack.g-spot.desktop";

let mainWindow: BrowserWindow | null = null;
let updateState: DesktopUpdateState = {
  phase: "idle",
  channel: "unknown",
  currentVersion: "unknown",
  latestVersion: null,
  updateAvailable: false,
  updateReady: false,
  error: null,
};
let updateTask: Promise<DesktopUpdateState> | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveDesktopDataDir(channel: string): string {
  switch (process.platform) {
    case "darwin":
      return path.join(homedir(), "Library", "Application Support", APP_IDENTIFIER, channel);
    case "win32":
      return path.join(
        process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"),
        APP_IDENTIFIER,
        channel,
      );
    default:
      return path.join(
        process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share"),
        APP_IDENTIFIER,
        channel,
      );
  }
}

async function configureDesktopDataEnv(): Promise<void> {
  const channel = await Updater.localInfo.channel().catch(() => "stable");
  const dataDir = resolveDesktopDataDir(channel);

  mkdirSync(dataDir, { recursive: true });

  process.env.DATABASE_URL ??= `file:${path.join(dataDir, "local.db")}`;
  process.env.CHAT_STATE_SQLITE_PATH ??= path.join(dataDir, "chat-state.db");
}

function configureBundledWebEnv(): void {
  const bundledWebDir = fileURLToPath(new URL("../views/mainview", import.meta.url));
  if (existsSync(path.join(bundledWebDir, "index.html"))) {
    process.env.G_SPOT_WEB_DIST_DIR ??= bundledWebDir;
  }
}

async function readUpdateState(
  patch: Partial<DesktopUpdateState> = {},
): Promise<DesktopUpdateState> {
  const [currentVersion, channel] = await Promise.all([
    Updater.localInfo.version().catch(() => updateState.currentVersion),
    Updater.localInfo.channel().catch(() => updateState.channel),
  ]);
  const info = Updater.updateInfo();

  updateState = {
    ...updateState,
    channel,
    currentVersion,
    latestVersion: info?.version ?? updateState.latestVersion,
    updateAvailable: Boolean(info?.updateAvailable ?? updateState.updateAvailable),
    updateReady: Boolean(info?.updateReady ?? updateState.updateReady),
    error: info?.error || null,
    ...patch,
  };

  const webviewRpc = mainWindow?.webview.rpc as typeof desktopRpc | undefined;
  webviewRpc?.sendProxy.updateStateChanged(updateState);
  return updateState;
}

function withSingleUpdateTask(
  task: () => Promise<DesktopUpdateState>,
): Promise<DesktopUpdateState> {
  if (updateTask) return updateTask;
  updateTask = task().finally(() => {
    updateTask = null;
  });
  return updateTask;
}

async function runDesktopMigrations(): Promise<{ ok: boolean; error: string | null }> {
  try {
    const { runMigrations } = await import("@g-spot/db/migrate");
    runMigrations({
      log(message) {
        console.log(`[desktop:migrate] ${message}`);
      },
    });
    return { ok: true, error: null };
  } catch (error) {
    const message = errorMessage(error);
    console.error("[desktop:migrate] failed", error);
    return { ok: false, error: message };
  }
}

async function openExternalUrl(url: string): Promise<{ ok: boolean; error: string | null }> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, error: `Unsupported URL protocol: ${parsed.protocol}` };
    }

    const command =
      process.platform === "darwin"
        ? ["open", url]
        : process.platform === "win32"
          ? ["cmd", "/c", "start", "", url]
          : ["xdg-open", url];

    const processResult = Bun.spawn(command, {
      stdout: "ignore",
      stderr: "ignore",
    });
    await processResult.exited;

    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

const desktopRpc = BrowserView.defineRPC<DesktopRpcSchema>({
  maxRequestTime: 300_000,
  handlers: {
    requests: {
      getUpdateState: async () => readUpdateState(),
      openExternalUrl: async ({ url }) => openExternalUrl(url),
      runMigrations: async () => {
        await readUpdateState({ phase: "migrating", error: null });
        const result = await runDesktopMigrations();
        await readUpdateState({
          phase: result.ok ? "idle" : "error",
          error: result.error,
        });
        return result;
      },
      checkForUpdate: async () =>
        withSingleUpdateTask(async () => {
          await readUpdateState({ phase: "checking", error: null });
          try {
            const info = await Updater.checkForUpdate();
            return readUpdateState({
              phase: info.updateAvailable ? "available" : "idle",
              latestVersion: info.version || null,
              updateAvailable: info.updateAvailable,
              updateReady: info.updateReady,
              error: info.error || null,
            });
          } catch (error) {
            return readUpdateState({ phase: "error", error: errorMessage(error) });
          }
        }),
      downloadUpdate: async () =>
        withSingleUpdateTask(async () => {
          await readUpdateState({ phase: "downloading", error: null });
          try {
            await Updater.downloadUpdate();
            return readUpdateState({ phase: "ready", error: null });
          } catch (error) {
            return readUpdateState({ phase: "error", error: errorMessage(error) });
          }
        }),
      installUpdate: async () =>
        withSingleUpdateTask(async () => {
          await readUpdateState({ phase: "applying", error: null });
          try {
            await Updater.applyUpdate();
            return readUpdateState({ phase: "applying", error: null });
          } catch (error) {
            return readUpdateState({ phase: "error", error: errorMessage(error) });
          }
        }),
    },
  },
});

// Check if the web dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      return DEV_SERVER_URL;
    } catch {
    }
  }

  return "views://mainview/index.html";
}

await configureDesktopDataEnv();
configureBundledWebEnv();
const migrationResult = await runDesktopMigrations();
if (!migrationResult.ok) {
  throw new Error(`Desktop migrations failed: ${migrationResult.error}`);
}

await import("server");

const url = await getMainViewUrl();

mainWindow = new BrowserWindow({
  title: "g-spot",
  url,
  frame: {
    width: 1280,
    height: 820,
    x: 120,
    y: 120,
  },
  rpc: desktopRpc,
});

await readUpdateState();
