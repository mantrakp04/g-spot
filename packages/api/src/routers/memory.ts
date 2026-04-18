import { z } from "zod";

import { publicProcedure, router } from "../index";
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
  ingest: publicProcedure
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
    .mutation(async ({ input }) => {
      return ingest(
        input.extraction as ExtractionResult,
        input.resolutions as ResolveAction[],
        input.sourceMessageId,
      );
    }),

  /**
   * Query memory — hybrid vector + graph search.
   */
  query: publicProcedure
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
    .query(async ({ input }) => {
      return query(input.query, {
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
  temporalQuery: publicProcedure
    .input(
      z.object({
        query: z.string(),
        from: z.number(),
        to: z.number(),
      }),
    )
    .query(async ({ input }) => {
      return temporalQuery(input.query, {
        from: input.from,
        to: input.to,
      });
    }),

  /**
   * Compile context for injection into the system prompt.
   */
  compileContext: publicProcedure
    .input(
      z.object({
        query: z.string(),
        maxTokens: z.number().optional(),
        includeProfile: z.boolean().optional(),
        includeActive: z.boolean().optional(),
        queryResultsK: z.number().optional(),
      }),
    )
    .query(async ({ input }) => {
      return compileContext(input.query, {
        maxTokens: input.maxTokens,
        includeProfile: input.includeProfile,
        includeActive: input.includeActive,
        queryResultsK: input.queryResultsK,
      });
    }),

  /**
   * Resolve contradictions for an entity.
   */
  resolveContradiction: publicProcedure
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
    .mutation(async ({ input }) => {
      return resolveContradiction(
        input.entityId,
        input.newFact,
        input.decisions,
      );
    }),

  /**
   * Run decay tick — background maintenance.
   */
  decayTick: publicProcedure.mutation(async () => {
    return decayTick();
  }),

  /**
   * Get memory stats for the current user.
   */
  stats: publicProcedure.query(() => {
    return getMemoryStats();
  }),

  /**
   * Get full graph data for visualization.
   */
  graph: publicProcedure.query(() => {
    return getGraphData();
  }),

  // ----- Scratchpad operations -----

  scratchpadRead: publicProcedure
    .input(z.object({ label: z.string() }))
    .query(({ input }) => {
      ensureDefaultBlocks();
      return scratchpadRead(input.label);
    }),

  scratchpadAppend: publicProcedure
    .input(
      z.object({
        label: z.string(),
        content: z.string(),
        changedBy: z.enum(["agent", "system", "user"]).optional(),
      }),
    )
    .mutation(({ input }) => {
      scratchpadAppend(input.label, input.content, input.changedBy);
    }),

  scratchpadReplace: publicProcedure
    .input(
      z.object({
        label: z.string(),
        oldText: z.string(),
        newText: z.string(),
        changedBy: z.enum(["agent", "system", "user"]).optional(),
      }),
    )
    .mutation(({ input }) => {
      scratchpadReplace(input.label, input.oldText, input.newText, input.changedBy);
    }),

  scratchpadRewrite: publicProcedure
    .input(
      z.object({
        label: z.string(),
        value: z.string(),
        changedBy: z.enum(["agent", "system", "user"]).optional(),
      }),
    )
    .mutation(({ input }) => {
      scratchpadRewrite(input.label, input.value, input.changedBy);
    }),

  scratchpadUndo: publicProcedure
    .input(
      z.object({
        label: z.string(),
        steps: z.number().min(1).optional(),
      }),
    )
    .mutation(({ input }) => {
      scratchpadUndo(input.label, input.steps);
    }),
});
