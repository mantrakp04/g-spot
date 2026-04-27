import { getDesktopRpc } from "@/lib/desktop-rpc";

export type OpenExternalUrlResult = {
  ok: boolean;
  error: string | null;
};

export function getExternalHttpUrl(href: string): string | null {
  if (typeof window === "undefined") return null;

  try {
    const url = new URL(href, window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.origin === window.location.origin) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function openExternalUrl(url: string): Promise<OpenExternalUrlResult> {
  const rpc = await getDesktopRpc();
  if (rpc) {
    return rpc.requestProxy.openExternalUrl({ url });
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  return opened
    ? { ok: true, error: null }
    : { ok: false, error: "Failed to open browser" };
}
