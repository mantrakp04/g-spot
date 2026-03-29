import { publicProcedure, router } from "../index";
import { sectionsRouter } from "./sections";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  sections: sectionsRouter,
});

export type AppRouter = typeof appRouter;
