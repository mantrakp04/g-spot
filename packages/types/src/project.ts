import { z } from "zod";

/**
 * Projects are the top-level workspace unit. Every chat belongs to a project,
 * and each project is pinned to an absolute filesystem path that becomes the
 * Pi agent's working directory for any chat inside it.
 *
 * IMPORTANT: a project's `path` is IMMUTABLE after creation. The update schema
 * deliberately omits it, and the db helper defends the invariant a second time
 * by whitelisting updatable fields.
 */
export const projectPathSchema = z
  .string()
  .min(1, "Path is required")
  .max(4096)
  .refine((value) => value.startsWith("/"), {
    message: "Path must be absolute",
  });

export const projectNameSchema = z.string().min(1).max(120);

export const createProjectInputSchema = z.object({
  name: projectNameSchema,
  path: projectPathSchema,
  customInstructions: z.string().max(20_000).nullable().optional(),
  appendPrompt: z.string().max(20_000).nullable().optional(),
});

export const updateProjectInputSchema = z
  .object({
    id: z.string().min(1),
    name: projectNameSchema.optional(),
    customInstructions: z.string().max(20_000).nullable().optional(),
    appendPrompt: z.string().max(20_000).nullable().optional(),
  })
  .strict();

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;

export type Project = {
  id: string;
  userId: string;
  name: string;
  path: string;
  customInstructions: string | null;
  appendPrompt: string | null;
  createdAt: string;
  updatedAt: string;
};
