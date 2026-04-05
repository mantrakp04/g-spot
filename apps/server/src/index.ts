import { cors } from "@elysiajs/cors";
import { handleChatStream } from "@g-spot/api/chat-stream";
import { handleFileUpload, handleFileDownload } from "@g-spot/api/file-handler";
import { createContext } from "@g-spot/api/context";
import { appRouter } from "@g-spot/api/routers/index";
import { handleOpenAIOAuthCallback } from "@g-spot/api/routers/openai";
import { env } from "@g-spot/env/server";
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
    if (!buf) return new Response(null, { status: 404 });
    return new Response(buf, {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400",
      },
    });
  })
  .post("/api/chat", ({ request }) => handleChatStream(request))
  .post("/api/files/upload", ({ request }) => handleFileUpload(request))
  .get("/api/files/:fileId", ({ params }) => handleFileDownload(params.fileId))
  .get("/", () => "OK")
  .listen(3000, () => {
    console.log("Server is running on http://localhost:3000");
  });

// ── OpenAI OAuth callback server (port 1455) ──
// The public Codex CLI client_id only allows redirect to localhost:1455/auth/callback.

new Elysia()
  .get("/auth/callback", ({ request }) => handleOpenAIOAuthCallback(request))
  .get("/", () => "OK")
  .listen(env.OPENAI_CALLBACK_PORT, () => {
    console.log(
      `OpenAI OAuth callback listening on http://${env.SERVER_HOST}:${env.OPENAI_CALLBACK_PORT}`,
    );
  }); 
