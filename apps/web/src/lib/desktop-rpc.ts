import type { DesktopRpcSchema, DesktopUpdateState } from "@g-spot/types/desktop";

type DesktopRpc = ReturnType<typeof import("electrobun/view").Electroview.defineRPC<DesktopRpcSchema>>;

let desktopRpcPromise: Promise<DesktopRpc | null> | null = null;

export function isDesktopRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__electrobunWebviewId" in window &&
    "__electrobunRpcSocketPort" in window &&
    typeof window.__electrobunWebviewId === "number" &&
    typeof window.__electrobunRpcSocketPort === "number"
  );
}

export async function getDesktopRpc(): Promise<DesktopRpc | null> {
  if (!isDesktopRuntime()) return null;
  desktopRpcPromise ??= createDesktopRpc();
  return desktopRpcPromise;
}

async function createDesktopRpc(): Promise<DesktopRpc> {
  const { Electroview } = await import("electrobun/view");
  const rpc = Electroview.defineRPC<DesktopRpcSchema>({
    maxRequestTime: 300_000,
    handlers: {
      messages: {
        updateStateChanged: (state) => {
          window.dispatchEvent(
            new CustomEvent<DesktopUpdateState>("desktop-update-state", {
              detail: state,
            }),
          );
        },
      },
    },
  });

  new Electroview({ rpc });

  return rpc;
}
