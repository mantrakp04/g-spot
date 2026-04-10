import { cors } from "@elysiajs/cors";
import {
  handleChatStream,
  handleChatStreamAbort,
  handleChatStreamReconnect,
} from "@g-spot/api/chat-stream";
import { handleFileUpload, handleFileDownload } from "@g-spot/api/file-handler";
import { createContext } from "@g-spot/api/context";
import { appRouter } from "@g-spot/api/routers/index";
import { env } from "@g-spot/env/server";
import { startDecayCron } from "@g-spot/api/lib/memory-cron";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Elysia } from "elysia";

// ── Favicon proxy (rejects Google default globe) ──

let defaultGlobeHash: string | null = null;

async function hashBytes(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getDefaultGlobeHash(): Promise<string> {
  if (defaultGlobeHash) return defaultGlobeHash;
  const res = await fetch(
    "https://www.google.com/s2/favicons?domain=this-does-not-exist-99999.invalid&sz=128",
  );
  defaultGlobeHash = await hashBytes(await res.arrayBuffer());
  return defaultGlobeHash;
}

const faviconCache = new Map<string, { buf: ArrayBuffer | null; ts: number }>();
const FAVICON_TTL = 24 * 60 * 60 * 1000;

async function getValidatedFavicon(domain: string): Promise<ArrayBuffer | null> {
  const cached = faviconCache.get(domain);
  if (cached && Date.now() - cached.ts < FAVICON_TTL) return cached.buf;

  const [globe, res] = await Promise.all([
    getDefaultGlobeHash(),
    fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`),
  ]);

  const buf = await res.arrayBuffer();
  const hash = await hashBytes(buf);
  const result = hash === globe ? null : buf;
  faviconCache.set(domain, { buf: result, ts: Date.now() });
  return result;
}

function buildFallbackFavicon(domain: string): string {
  const letter = (domain.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${domain}">
  <rect width="64" height="64" rx="12" fill="#f3f4f6"/>
  <rect x="4" y="4" width="56" height="56" rx="10" fill="#e5e7eb" stroke="#d1d5db"/>
  <text x="32" y="41" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="28" font-weight="700" fill="#111827">${letter}</text>
</svg>`;
}

// ── Main server (port 3000) ──

export const app = new Elysia()
  .use(
    cors({
      origin: env.CORS_ORIGIN,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    }),
  )
  .all("/trpc/*", async (context) => {
    const res = await fetchRequestHandler({
      endpoint: "/trpc",
      router: appRouter,
      req: context.request,
      createContext: () => createContext({ context }),
    });
    return res;
  })
  .get("/api/favicon/:domain", async ({ params }) => {
    const buf = await getValidatedFavicon(params.domain);
    if (!buf) {
      return new Response(buildFallbackFavicon(params.domain), {
        headers: {
          "content-type": "image/svg+xml; charset=utf-8",
          "cache-control": "public, max-age=86400",
        },
      });
    }
    return new Response(buf, {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400",
      },
    });
  })
  .post("/api/chat", ({ request }) => handleChatStream(request))
  .get("/api/chat/:chatId/stream", ({ params, request }) =>
    handleChatStreamReconnect(request, params.chatId),
  )
  .delete("/api/chat/:chatId/stream", ({ params, request }) =>
    handleChatStreamAbort(request, params.chatId),
  )
  .post("/api/files/upload", ({ request }) => handleFileUpload(request))
  .get("/api/files/:fileId", ({ params }) => handleFileDownload(params.fileId))
  .get("/", () => "OK")
  .listen(env.SERVER_PORT, () => {
    console.log(`Server is running on http://${env.SERVER_HOST}:${env.SERVER_PORT}`);
    startDecayCron();
  });
