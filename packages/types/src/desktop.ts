export type DesktopUpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "applying"
  | "migrating"
  | "error";

export type DesktopUpdateState = {
  phase: DesktopUpdatePhase;
  channel: string;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  updateReady: boolean;
  error: string | null;
};

export type DesktopStackAuthTokens = {
  refreshToken: string;
};

export type DesktopRpcSchema = {
  bun: {
    requests: {
      getUpdateState: {
        params: undefined;
        response: DesktopUpdateState;
      };
      checkForUpdate: {
        params: undefined;
        response: DesktopUpdateState;
      };
      downloadUpdate: {
        params: undefined;
        response: DesktopUpdateState;
      };
      installUpdate: {
        params: undefined;
        response: DesktopUpdateState;
      };
      runMigrations: {
        params: undefined;
        response: { ok: boolean; error: string | null };
      };
      openExternalUrl: {
        params: { url: string };
        response: { ok: boolean; error: string | null };
      };
      chooseProjectDirectory: {
        params: { startingFolder?: string };
        response: { path: string | null; error: string | null };
      };
      getStackAuthTokens: {
        params: undefined;
        response: DesktopStackAuthTokens | null;
      };
      setStackAuthTokens: {
        params: DesktopStackAuthTokens;
        response: { ok: boolean; error: string | null };
      };
      clearStackAuthTokens: {
        params: undefined;
        response: { ok: boolean; error: string | null };
      };
    };
    messages: Record<never, never>;
  };
  webview: {
    requests: Record<never, never>;
    messages: {
      updateStateChanged: DesktopUpdateState;
    };
  };
};
