import { publicProcedure, router } from "../index";
import { connectionsRouter } from "./connections";
import { openaiRouter } from "./openai";
import { sectionsRouter } from "./sections";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  sections: sectionsRouter,
  openai: openaiRouter,
  connections: connectionsRouter,
});

export type AppRouter = typeof appRouter;
