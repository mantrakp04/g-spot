import { publicProcedure, router } from "../index";
import { chatRouter } from "./chat";
import { connectionsRouter } from "./connections";
import { piRouter } from "./pi";
import { projectsRouter } from "./projects";
import { sectionsRouter } from "./sections";
import { skillsRouter } from "./skills";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  sections: sectionsRouter,
  pi: piRouter,
  connections: connectionsRouter,
  chat: chatRouter,
  projects: projectsRouter,
  skills: skillsRouter,
});

export type AppRouter = typeof appRouter;
