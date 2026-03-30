import { cors } from "@elysiajs/cors";
import { createContext } from "@g-spot/api/context";
import { appRouter } from "@g-spot/api/routers/index";
import { env } from "@g-spot/env/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Elysia } from "elysia";

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
  .get("/", () => "OK")
  .listen(3000, () => {
    console.log("Server is running on http://localhost:3000");
  });
