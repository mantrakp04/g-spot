import { existsSync } from "node:fs";
import path from "node:path";

// ── Desktop-hosted web callback pages ──

// Only serve the bundled SPA when the desktop shell explicitly points us at
// its copy. In dev (web served by Vite on :3002) this stays null so stale
// `apps/web/dist` builds don't shadow the dev server.
export const webDistDir = process.env.G_SPOT_WEB_DIST_DIR ?? null;

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function serveWebAsset(relativePath: string): Promise<Response | null> {
  if (!webDistDir) return null;
  const normalizedPath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(webDistDir, normalizedPath);

  if (!filePath.startsWith(webDistDir) || !existsSync(filePath)) {
    return null;
  }

  const extension = path.extname(filePath);
  return new Response(Bun.file(filePath), {
    headers: {
      "content-type": contentTypes[extension] ?? "application/octet-stream",
    },
  });
}

export async function serveWebApp(): Promise<Response> {
  if (!webDistDir) return new Response("Not found", { status: 404 });
  return (
    (await serveWebAsset("index.html")) ??
    new Response("Web build not found", { status: 404 })
  );
}
