import { publicProcedure, router } from "../index";
import { chatRouter } from "./chat";
import { connectionsRouter } from "./connections";
import { gmailRouter } from "./gmail";
import { gmailSyncRouter } from "./gmail-sync";
import { memoryRouter } from "./memory";
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
  memory: memoryRouter,
  gmail: gmailRouter,
  gmailSync: gmailSyncRouter,
});

export type AppRouter = typeof appRouter;
