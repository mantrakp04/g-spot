import { z } from "zod";

import { authedProcedure, router } from "../index";
import {
  sectionFiltersSchema,
  sectionSourceSchema,
} from "../schemas/section-filters";
import {
  createSection,
  deleteSection,
  listSections,
  reorderSections,
  updateSection,
} from "@g-spot/db/sections";

export const sectionsRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    return listSections(ctx.userId);
  }),

  create: authedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        source: sectionSourceSchema,
        filters: sectionFiltersSchema.default([]),
        showBadge: z.boolean().default(true),
        repos: z.array(z.string()).default([]),
        accountId: z.string().nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return createSection(ctx.userId, input);
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        filters: sectionFiltersSchema.optional(),
        showBadge: z.boolean().optional(),
        collapsed: z.boolean().optional(),
        repos: z.array(z.string()).optional(),
        accountId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return updateSection(ctx.userId, input);
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return deleteSection(ctx.userId, input.id);
    }),

  reorder: authedProcedure
    .input(z.object({ orderedIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      return reorderSections(ctx.userId, input.orderedIds);
    }),
});
