import { cors } from "@elysiajs/cors";
import { env } from "@g-spot/env/server";
import {
  handleChatStreamAbort,
  handleChatSocketClose,
  handleChatSocketMessage,
  handleChatSocketOpen,
  handleChatStatusSocketClose,
  handleChatStatusSocketMessage,
  handleChatStatusSocketOpen,
} from "@g-spot/api/chat-stream";
import {
  handleTerminalSocketClose,
  handleTerminalSocketMessage,
  handleTerminalSocketOpen,
} from "@g-spot/api/terminal-stream";
import {
  handleAttachmentByName,
  handleFileUpload,
  handleFileDownload,
  handleFileExtractedText,
} from "@g-spot/api/file-handler";
import { createContext } from "@g-spot/api/context";
import { appRouter } from "@g-spot/api/routers/index";
import { startDecayCron } from "@g-spot/api/lib/memory-cron";
import {
  loadGlobalMcps,
  shutdownAllMcps,
} from "@g-spot/api/lib/mcp/manager";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Elysia } from "elysia";
import { buildFallbackFavicon, getValidatedFavicon } from "./favicon-proxy";
import { serveWebApp, serveWebAsset, webDistDir } from "./web-assets";

function demoModeResponse(action: string): Response | null {
  if (!env.DEMO_MODE) return null;
  return new Response(`${action} is disabled in the read-only demo.`, {
    status: 403,
  });
}

function closeDemoSocket(ws: { close: (code?: number, reason?: string) => void }): boolean {
  if (!env.DEMO_MODE) return false;
  ws.close(1008, "Disabled in read-only demo");
  return true;
}

// ── Main server (port 3000) ──

export const app = new Elysia()
  .use(
    cors({
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      maxAge: 86400,
    }),
  )
  .get("/trpc/*", (context) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      router: appRouter,
      req: context.request,
      createContext: () => createContext({ context }),
    }),
  )
  .post("/trpc/*", (context) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      router: appRouter,
      req: context.request,
      createContext: () => createContext({ context }),
    }),
  )
  .options("/trpc/*", (context) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      router: appRouter,
      req: context.request,
      createContext: () => createContext({ context }),
    }),
  )
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
  .ws("/api/chat/status/socket", {
    open(ws) {
      if (closeDemoSocket(ws)) return;
      handleChatStatusSocketOpen(ws);
    },
    message(ws, message) {
      handleChatStatusSocketMessage(ws, message);
    },
    close(ws) {
      handleChatStatusSocketClose(ws);
    },
  })
  .ws("/api/chat/:chatId/socket", {
    open(ws) {
      if (closeDemoSocket(ws)) return;
      handleChatSocketOpen(ws);
    },
    message(ws, message) {
      void handleChatSocketMessage(ws, message);
    },
    close(ws) {
      handleChatSocketClose(ws);
    },
  })
  .ws("/api/terminal/socket", {
    open(ws) {
      if (closeDemoSocket(ws)) return;
      void handleTerminalSocketOpen(ws);
    },
    message(ws, message) {
      handleTerminalSocketMessage(ws, message);
    },
    close(ws) {
      handleTerminalSocketClose(ws);
    },
  })
  .delete("/api/chat/:chatId/stream", ({ params, request }) =>
    demoModeResponse("Chat stream abort") ??
    handleChatStreamAbort(request, params.chatId),
  )
  .post("/api/files/upload", ({ request }) =>
    demoModeResponse("File upload") ?? handleFileUpload(request)
  )
  .get("/api/files/:fileId/extracted-text", ({ params }) =>
    handleFileExtractedText(params.fileId),
  )
  .get("/api/files/:fileId", ({ params }) => handleFileDownload(params.fileId))
  .get("/api/notes/attachments/:filename", ({ params }) =>
    handleAttachmentByName(params.filename),
  )
  .get("/assets/*", async ({ params }) => {
    const file = await serveWebAsset(`assets/${params["*"]}`);
    return file ?? new Response("Not found", { status: 404 });
  })
  .get("/logo.png", async () => {
    const file = await serveWebAsset("logo.png");
    return file ?? new Response("Not found", { status: 404 });
  })
  .get("/handler/*", () => serveWebApp())
  .get("/healthz", () => "OK")
  .get("/", () => (webDistDir ? serveWebApp() : new Response("OK")))
  .get("/*", async ({ params, request }) => {
    const rest = params["*"];
    if (rest.startsWith("api/") || rest.startsWith("trpc/")) {
      return new Response("Not found", { status: 404 });
    }

    const accept = request.headers.get("accept") ?? "";
    const hasExtension = /\.[a-z0-9]+$/i.test(rest);
    if (hasExtension) {
      const file = await serveWebAsset(rest);
      if (file) return file;
      return new Response("Not found", { status: 404 });
    }
    if (!accept.includes("text/html")) {
      return new Response("Not found", { status: 404 });
    }
    return serveWebApp();
  })
  .listen({ hostname: env.SERVER_HOST, port: env.SERVER_PORT }, () => {
    console.log(`server listening on ${env.SERVER_HOST}:${env.SERVER_PORT}`);
    if (!env.DEMO_MODE) {
      startDecayCron();
      void loadGlobalMcps();
    }
  });

let mcpShutdownPromise: Promise<void> | null = null;
function shutdownMcps() {
  if (!mcpShutdownPromise) {
    mcpShutdownPromise = shutdownAllMcps();
  }
  return mcpShutdownPromise;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdownMcps().finally(() => process.exit(0));
  });
}
process.on("beforeExit", () => {
  void shutdownMcps();
});
