import { publicProcedure, router } from "../index";
import { chatRouter } from "./chat";
import { gitRouter } from "./git";
import { gmailRouter } from "./gmail";
import { gmailSyncRouter } from "./gmail-sync";
import { memoryRouter } from "./memory";
import { piRouter } from "./pi";
import { projectsRouter } from "./projects";
import { relayRouter } from "./relay";
import { sectionsRouter } from "./sections";
import { skillsRouter } from "./skills";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  sections: sectionsRouter,
  pi: piRouter,
  chat: chatRouter,
  git: gitRouter,
  projects: projectsRouter,
  skills: skillsRouter,
  memory: memoryRouter,
  gmail: gmailRouter,
  gmailSync: gmailSyncRouter,
  relay: relayRouter,
});

export type AppRouter = typeof appRouter;
