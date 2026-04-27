import { z } from "zod";

/**
 * MCP `mcpServers` JSON config — same shape used by Claude Desktop, Claude Code,
 * Cursor, FastMCP, etc. Stored on disk as `~/.g-spot/mcp.json` (global) and
 * `<project.path>/.mcp.json` (per-project). Never written by the app — users
 * edit the JSON files directly. The app only reads, validates, and reconciles
 * running child processes / clients with the on-disk config.
 *
 * `disabled: true` is a non-standard but widely adopted extension (Cursor uses
 * it). Disabled entries are parsed but never spawned.
 */

const headersSchema = z.record(z.string(), z.string());
const envSchema = z.record(z.string(), z.string());

const stdioServerSchema = z
  .object({
    type: z.literal("stdio").optional(),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: envSchema.optional(),
    cwd: z.string().optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

const httpServerSchema = z
  .object({
    type: z.union([z.literal("http"), z.literal("streamable-http")]),
    url: z.string().url(),
    headers: headersSchema.optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

const sseServerSchema = z
  .object({
    type: z.literal("sse"),
    url: z.string().url(),
    headers: headersSchema.optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

export const mcpServerEntrySchema = z.union([
  httpServerSchema,
  sseServerSchema,
  stdioServerSchema,
]);

export const mcpConfigSchema = z
  .object({
    mcpServers: z.record(z.string().min(1), mcpServerEntrySchema).default({}),
  })
  .strict();

export type McpServerEntry = z.infer<typeof mcpServerEntrySchema>;
export type McpConfig = z.infer<typeof mcpConfigSchema>;

export type McpServerStatus =
  | { kind: "disabled" }
  | { kind: "starting"; attempt: number }
  | { kind: "ready"; toolCount: number }
  | {
      kind: "error";
      message: string;
      attempt: number;
      /** Unix ms timestamp of the next retry, or null if retries are exhausted. */
      retryAt: number | null;
    };

export type McpServerSnapshot = {
  scope: "global" | "project";
  projectId: string | null;
  name: string;
  transport: "stdio" | "http" | "sse";
  status: McpServerStatus;
};
