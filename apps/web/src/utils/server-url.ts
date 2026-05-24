import { env } from "@g-spot/env/web";

const serverUrl = env.VITE_SERVER_URL.replace(/\/+$/, "");

export function serverPath(path: `/${string}`): string {
  return `${serverUrl}${path}`;
}

export function serverWebSocketPath(path: `/${string}`): string {
  const url = new URL(serverPath(path), window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
