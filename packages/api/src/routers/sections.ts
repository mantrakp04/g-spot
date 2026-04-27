import { z } from "zod";
import {
  sectionFiltersSchema,
  sectionSourceSchema,
  sectionColumnsSchema,
} from "@g-spot/types/filters";

import { publicProcedure, router } from "../index";
import {
  buildSectionFilters,
  buildSectionFiltersInputSchema,
} from "../ai-flows/section-filters";
import {
  createSection,
  deleteSection,
  listSections,
  reorderSections,
  updateSection,
} from "@g-spot/db/sections";

export const sectionsRouter = router({
  list: publicProcedure.query(async () => {
    return listSections();
  }),

  buildFilters: publicProcedure
    .input(buildSectionFiltersInputSchema)
    .mutation(async ({ input }) => {
      return buildSectionFilters(input);
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        source: sectionSourceSchema,
        filters: sectionFiltersSchema,
        showBadge: z.boolean().default(true),
        repos: z.array(z.string()).default([]),
        accountId: z.string().nullable().default(null),
        columns: sectionColumnsSchema.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return createSection(input);
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        filters: sectionFiltersSchema.optional(),
        showBadge: z.boolean().optional(),
        collapsed: z.boolean().optional(),
        repos: z.array(z.string()).optional(),
        accountId: z.string().nullable().optional(),
        columns: sectionColumnsSchema.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return updateSection(input);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return deleteSection(input.id);
    }),

  reorder: publicProcedure
    .input(z.object({ orderedIds: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      return reorderSections(input.orderedIds);
    }),
});
