import { z } from "zod";

import { authedProcedure, router } from "../index";
import {
  compileContext,
  decayTick,
  ensureDefaultBlocks,
  getGraphData,
  getMemoryStats,
  ingest,
  query,
  resolveContradiction,
  scratchpadAppend,
  scratchpadRead,
  scratchpadReplace,
  scratchpadRewrite,
  scratchpadUndo,
  temporalQuery,
  type ExtractionResult,
  type ResolveAction,
} from "../lib/memory";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const extractedEntitySchema = z.object({
  name: z.string(),
  entityType: z.enum([
    "person", "organization", "project", "concept", "tool", "event", "preference",
  ]),
  description: z.string(),
  aliases: z.array(z.string()).optional(),
});

const extractedObservationSchema = z.object({
  content: z.string(),
  observationType: z.enum([
    "fact", "event", "preference", "belief", "procedure", "reflection",
  ]),
  entityNames: z.array(z.string()),
});

const extractedEdgeSchema = z.object({
  sourceName: z.string(),
  targetName: z.string(),
  relationshipType: z.string(),
  description: z.string(),
});

const resolveActionSchema = z.object({
  index: z.number(),
  action: z.enum(["ADD", "UPDATE", "DELETE", "NONE"]),
  existingId: z.string().optional(),
  reason: z.string(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const memoryRouter = router({
  /**
   * Ingest extracted entities, observations, and edges into the memory graph.
   * Should be called after the 2-step LLM extraction + resolution process.
   */
  ingest: authedProcedure
    .input(
      z.object({
        extraction: z.object({
          entities: z.array(extractedEntitySchema),
          observations: z.array(extractedObservationSchema),
          edges: z.array(extractedEdgeSchema),
        }),
        resolutions: z.array(resolveActionSchema),
        sourceMessageId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ingest(
        ctx.userId,
        input.extraction as ExtractionResult,
        input.resolutions as ResolveAction[],
        input.sourceMessageId,
      );
    }),

  /**
   * Query memory — hybrid vector + graph search.
   */
  query: authedProcedure
    .input(
      z.object({
        query: z.string(),
        topK: z.number().min(1).max(100).optional(),
        threshold: z.number().min(0).max(1).optional(),
        includeGraph: z.boolean().optional(),
        includeScratchpad: z.boolean().optional(),
        hopDepth: z.number().min(0).max(5).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return query(input.query, {
        userId: ctx.userId,
        topK: input.topK,
        threshold: input.threshold,
        includeGraph: input.includeGraph,
        includeScratchpad: input.includeScratchpad,
        hopDepth: input.hopDepth,
      });
    }),

  /**
   * Temporal query — point-in-time memory search.
   */
  temporalQuery: authedProcedure
    .input(
      z.object({
        query: z.string(),
        from: z.number(),
        to: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return temporalQuery(ctx.userId, input.query, {
        from: input.from,
        to: input.to,
      });
    }),

  /**
   * Compile context for injection into the system prompt.
   */
  compileContext: authedProcedure
    .input(
      z.object({
        query: z.string(),
        maxTokens: z.number().optional(),
        includeProfile: z.boolean().optional(),
        includeActive: z.boolean().optional(),
        queryResultsK: z.number().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return compileContext(ctx.userId, input.query, {
        maxTokens: input.maxTokens,
        includeProfile: input.includeProfile,
        includeActive: input.includeActive,
        queryResultsK: input.queryResultsK,
      });
    }),

  /**
   * Resolve contradictions for an entity.
   */
  resolveContradiction: authedProcedure
    .input(
      z.object({
        entityId: z.string(),
        newFact: z.string(),
        decisions: z.array(
          z.object({
            existingId: z.string(),
            action: z.enum(["KEEP", "SUPERSEDE", "MERGE"]),
            mergedText: z.string().optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return resolveContradiction(
        ctx.userId,
        input.entityId,
        input.newFact,
        input.decisions,
      );
    }),

  /**
   * Run decay tick — background maintenance.
   */
  decayTick: authedProcedure.mutation(async ({ ctx }) => {
    return decayTick(ctx.userId);
  }),

  /**
   * Get memory stats for the current user.
   */
  stats: authedProcedure.query(({ ctx }) => {
    return getMemoryStats(ctx.userId);
  }),

  /**
   * Get full graph data for visualization.
   */
  graph: authedProcedure.query(({ ctx }) => {
    return getGraphData(ctx.userId);
  }),

  // ----- Scratchpad operations -----

  scratchpadRead: authedProcedure
    .input(z.object({ label: z.string() }))
    .query(({ ctx, input }) => {
      ensureDefaultBlocks(ctx.userId);
      return scratchpadRead(ctx.userId, input.label);
    }),

  scratchpadAppend: authedProcedure
    .input(
      z.object({
        label: z.string(),
        content: z.string(),
        changedBy: z.enum(["agent", "system", "user"]).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      scratchpadAppend(ctx.userId, input.label, input.content, input.changedBy);
    }),

  scratchpadReplace: authedProcedure
    .input(
      z.object({
        label: z.string(),
        oldText: z.string(),
        newText: z.string(),
        changedBy: z.enum(["agent", "system", "user"]).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      scratchpadReplace(ctx.userId, input.label, input.oldText, input.newText, input.changedBy);
    }),

  scratchpadRewrite: authedProcedure
    .input(
      z.object({
        label: z.string(),
        value: z.string(),
        changedBy: z.enum(["agent", "system", "user"]).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      scratchpadRewrite(ctx.userId, input.label, input.value, input.changedBy);
    }),

  scratchpadUndo: authedProcedure
    .input(
      z.object({
        label: z.string(),
        steps: z.number().min(1).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      scratchpadUndo(ctx.userId, input.label, input.steps);
    }),
});
