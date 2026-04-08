import { z } from "zod";

/**
 * Skills are reusable prompt bundles authored by the user. They can be scoped
 * to a specific project (`projectId: string`) or kept global across all of the
 * user's projects (`projectId: null`). On name collision during agent use, a
 * project-scoped skill shadows a global one.
 *
 * The `name` must be slug-shaped so it can safely become a `/slash-command`,
 * a directory name during Pi session materialization, and a Pi frontmatter
 * key all at once.
 */
export const skillNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Name must be lowercase alphanumeric with single hyphens",
  );

export const skillDescriptionSchema = z.string().min(1).max(1024);

/**
 * Pi's SDK description limit is 1024 chars — mirror it so we fail fast at the
 * router boundary instead of the agent boundary.
 */
export const createSkillInputSchema = z.object({
  projectId: z.string().min(1).nullable(),
  name: skillNameSchema,
  description: skillDescriptionSchema,
  content: z.string().max(200_000).default(""),
  triggerKeywords: z.array(z.string().min(1).max(64)).max(32).default([]),
  disableModelInvocation: z.boolean().default(false),
});

export const updateSkillInputSchema = z
  .object({
    id: z.string().min(1),
    name: skillNameSchema.optional(),
    description: skillDescriptionSchema.optional(),
    content: z.string().max(200_000).optional(),
    triggerKeywords: z.array(z.string().min(1).max(64)).max(32).optional(),
    disableModelInvocation: z.boolean().optional(),
  })
  .strict();

export type CreateSkillInput = z.infer<typeof createSkillInputSchema>;
export type UpdateSkillInput = z.infer<typeof updateSkillInputSchema>;

export type Skill = {
  id: string;
  userId: string;
  projectId: string | null;
  name: string;
  description: string;
  content: string;
  triggerKeywords: string[];
  disableModelInvocation: boolean;
  createdAt: string;
  updatedAt: string;
};

/** The starter set of built-in slash commands that must not collide with skill names. */
export const RESERVED_SKILL_NAMES = [
  "clear",
  "help",
  "fork",
  "regenerate",
  "model",
  "skill",
] as const;

export type ReservedSkillName = (typeof RESERVED_SKILL_NAMES)[number];
