import type { DesktopUpdateState, DesktopRpcSchema } from "@g-spot/types/desktop";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi";
import Electrobun, {
  ApplicationMenu,
  BrowserView,
  BrowserWindow,
  Updater,
  type ApplicationMenuItemConfig,
} from "electrobun/bun";

const DEV_SERVER_PORT = 3001;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const APP_IDENTIFIER = "dev.bettertstack.g-spot.desktop";
const WINDOW_TABBING_IDENTIFIER = "g-spot-main";
const WINDOW_TABBING_MODE_PREFERRED = 1;
const MAC_TAB_ORDER_ABOVE = 1;
const MAC_KEY_CODE_T = 17;
const MAC_COMMAND_MODIFIER = 1 << 20;
const MAC_CONTROL_MODIFIER = 1 << 18;

const MENU_ACTION = {
  mergeAllWindows: "merge-all-windows",
  moveTabToNewWindow: "move-tab-to-new-window",
  newWindowTab: "new-window-tab",
  newWindow: "new-window",
  selectNextTab: "select-next-tab",
  selectPreviousTab: "select-previous-tab",
  toggleTabBar: "toggle-tab-bar",
} as const;

let mainWindow: BrowserWindow | null = null;
let focusedWindow: BrowserWindow | null = null;
const desktopWindows = new Set<BrowserWindow>();
let nativeWindowTabs:
  | ReturnType<typeof dlopen<{
      gspot_configure_window_tabbing: {
        args: [typeof FFIType.ptr, typeof FFIType.cstring, typeof FFIType.i64];
        returns: typeof FFIType.void;
      };
      gspot_add_tabbed_window: {
        args: [typeof FFIType.ptr, typeof FFIType.ptr, typeof FFIType.i64];
        returns: typeof FFIType.void;
      };
      gspot_perform_window_selector: {
        args: [typeof FFIType.ptr, typeof FFIType.cstring];
        returns: typeof FFIType.void;
      };
    }>>
  | null
  | undefined;
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

function toCString(value: string): Pointer {
  return ptr(Buffer.from(`${value}\0`, "utf8")) as Pointer;
}

function windowPtr(win: BrowserWindow): Pointer {
  return win.ptr as Pointer;
}

function getNativeWindowTabs() {
  if (process.platform !== "darwin") return null;
  if (nativeWindowTabs !== undefined) return nativeWindowTabs;

  const candidates = [
    fileURLToPath(new URL("./native/libgspot_window_tabs.dylib", import.meta.url)),
    fileURLToPath(new URL("../native/libgspot_window_tabs.dylib", import.meta.url)),
    fileURLToPath(new URL("../../native/libgspot_window_tabs.dylib", import.meta.url)),
  ];
  const dylibPath = candidates.find((candidate) => existsSync(candidate));

  if (!dylibPath) {
    console.warn("[desktop:tabs] native tab helper missing; native tabs disabled");
    nativeWindowTabs = null;
    return nativeWindowTabs;
  }

  nativeWindowTabs = dlopen(dylibPath, {
    gspot_configure_window_tabbing: {
      args: [FFIType.ptr, FFIType.cstring, FFIType.i64],
      returns: FFIType.void,
    },
    gspot_add_tabbed_window: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.i64],
      returns: FFIType.void,
    },
    gspot_perform_window_selector: {
      args: [FFIType.ptr, FFIType.cstring],
      returns: FFIType.void,
    },
  });

  return nativeWindowTabs;
}

function configureNativeWindowTabbing(win: BrowserWindow): void {
  getNativeWindowTabs()?.symbols.gspot_configure_window_tabbing(
    windowPtr(win),
    toCString(WINDOW_TABBING_IDENTIFIER),
    WINDOW_TABBING_MODE_PREFERRED,
  );
}

function addNativeWindowTab(anchorWindow: BrowserWindow, win: BrowserWindow): void {
  getNativeWindowTabs()?.symbols.gspot_add_tabbed_window(
    windowPtr(anchorWindow),
    windowPtr(win),
    MAC_TAB_ORDER_ABOVE,
  );
}

function selectNativeWindowTab(win: BrowserWindow): void {
  win.focus();
}

function sendNativeWindowTabAction(selectorName: string): void {
  const win = activeWindow();
  if (!win) return;
  getNativeWindowTabs()?.symbols.gspot_perform_window_selector(
    windowPtr(win),
    toCString(selectorName),
  );
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

  for (const win of desktopWindows) {
    const webviewRpc = win.webview.rpc as typeof desktopRpc | undefined;
    webviewRpc?.sendProxy.updateStateChanged(updateState);
  }
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

function activeWindow(): BrowserWindow | null {
  return focusedWindow ?? mainWindow ?? desktopWindows.values().next().value ?? null;
}

function isNewWindowTabKeyEvent(event: unknown): boolean {
  const data = (event as { data?: { keyCode?: number; modifiers?: number; isRepeat?: boolean } }).data;
  if (!data || data.isRepeat || data.keyCode !== MAC_KEY_CODE_T) return false;

  const modifiers = data.modifiers ?? 0;
  return Boolean(modifiers & MAC_COMMAND_MODIFIER || modifiers & MAC_CONTROL_MODIFIER);
}

async function createDesktopWindow({
  asNativeTab = false,
}: {
  asNativeTab?: boolean;
} = {}): Promise<BrowserWindow> {
  const anchorWindow = activeWindow();
  const frame = anchorWindow?.getFrame() ?? {
    width: 1280,
    height: 820,
    x: 120,
    y: 120,
  };
  const win = new BrowserWindow({
    title: "g-spot",
    url,
    frame: {
      width: frame.width,
      height: frame.height,
      x: frame.x + (anchorWindow && !asNativeTab ? 24 : 0),
      y: frame.y + (anchorWindow && !asNativeTab ? 24 : 0),
    },
    hidden: asNativeTab && process.platform === "darwin",
    rpc: desktopRpc,
  });

  configureNativeWindowTabbing(win);
  desktopWindows.add(win);
  mainWindow ??= win;
  focusedWindow = win;

  win.on("focus", () => {
    focusedWindow = win;
  });
  win.on("keyDown", (event) => {
    if (process.platform === "darwin" && isNewWindowTabKeyEvent(event)) {
      void createDesktopWindow({ asNativeTab: true });
    }
  });
  win.on("close", () => {
    desktopWindows.delete(win);
    if (focusedWindow === win) {
      focusedWindow = desktopWindows.values().next().value ?? null;
    }
    if (mainWindow === win) {
      mainWindow = desktopWindows.values().next().value ?? null;
    }
  });

  if (asNativeTab && process.platform === "darwin" && anchorWindow && anchorWindow !== win) {
    addNativeWindowTab(anchorWindow, win);
    selectNativeWindowTab(win);
  }

  return win;
}

async function handleApplicationMenuAction(action: string): Promise<void> {
  switch (action) {
    case MENU_ACTION.newWindowTab:
      await createDesktopWindow({ asNativeTab: true });
      break;
    case MENU_ACTION.newWindow:
      await createDesktopWindow();
      break;
    case MENU_ACTION.selectPreviousTab:
      sendNativeWindowTabAction("selectPreviousTab:");
      break;
    case MENU_ACTION.selectNextTab:
      sendNativeWindowTabAction("selectNextTab:");
      break;
    case MENU_ACTION.moveTabToNewWindow:
      sendNativeWindowTabAction("moveTabToNewWindow:");
      break;
    case MENU_ACTION.mergeAllWindows:
      sendNativeWindowTabAction("mergeAllWindows:");
      break;
    case MENU_ACTION.toggleTabBar:
      sendNativeWindowTabAction("toggleTabBar:");
      break;
  }
}

function installApplicationMenu(): void {
  const menu: Array<ApplicationMenuItemConfig> = [
    {
      submenu: [
        { label: "About g-spot", role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "showAll" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Window", action: MENU_ACTION.newWindow, accelerator: "Command+N" },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [{ role: "toggleFullScreen" }],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        {
          label: "New Tab",
          action: MENU_ACTION.newWindowTab,
          accelerator: "Command+T",
        },
        {
          label: "Show Previous Tab",
          action: MENU_ACTION.selectPreviousTab,
          accelerator: "Command+Shift+[",
        },
        {
          label: "Show Next Tab",
          action: MENU_ACTION.selectNextTab,
          accelerator: "Command+Shift+]",
        },
        { label: "Move Tab to New Window", action: MENU_ACTION.moveTabToNewWindow },
        { label: "Merge All Windows", action: MENU_ACTION.mergeAllWindows },
        { label: "Toggle Tab Bar", action: MENU_ACTION.toggleTabBar },
        { type: "separator" },
        { role: "bringAllToFront" },
      ],
    },
  ];

  ApplicationMenu.setApplicationMenu(menu);
  ApplicationMenu.on("application-menu-clicked", (event) => {
    const action = (event as { data?: { action?: string } }).data?.action;
    if (action) void handleApplicationMenuAction(action);
  });

  Electrobun.events.on("reopen", () => {
    const win = activeWindow();
    if (win) {
      win.focus();
      return;
    }

    void createDesktopWindow();
  });
}

installApplicationMenu();
mainWindow = await createDesktopWindow();

await readUpdateState();
