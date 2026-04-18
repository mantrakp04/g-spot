import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { TRPCError } from "@trpc/server";

import {
  getProjectByPath as dbGetProjectByPath,
  ProjectPathConflictError,
} from "@g-spot/db/projects";

const HOME_DIR = os.homedir();

/**
 * Validate, canonicalize, and reject obvious foot-guns for a user-supplied
 * project path. Returns the canonical realpath that should be persisted.
 *
 * Rules (per the agreed plan):
 *  1. Must be absolute.
 *  2. Must exist on disk and resolve via fs.realpath.
 *  3. Must be a directory.
 *  4. Must be readable by the server process.
 *  5. Must not be `/` or `$HOME` (too broad — refuse to point Pi at the world).
 *  6. Must not collide with any other project the same user owns.
 */
export async function validateProjectPath(rawPath: string): Promise<string> {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Path is required",
    });
  }

  if (!path.isAbsolute(rawPath)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Path must be absolute",
    });
  }

  const normalized = path.resolve(rawPath);

  let real: string;
  try {
    real = await fs.realpath(normalized);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Path does not exist",
    });
  }

  let stat;
  try {
    stat = await fs.stat(real);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Path is not accessible",
    });
  }

  if (!stat.isDirectory()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Path must point at a directory",
    });
  }

  try {
    await fs.access(real, fs.constants.R_OK);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Server cannot read the path",
    });
  }

  if (real === "/" || real === HOME_DIR) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Refusing to use root or your home directory as a project path",
    });
  }

  const collision = await dbGetProjectByPath(real);
  if (collision) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "A project with this path already exists",
    });
  }

  return real;
}

export function translateProjectError(err: unknown): TRPCError {
  if (err instanceof ProjectPathConflictError) {
    return new TRPCError({ code: "CONFLICT", message: err.message });
  }
  if (err instanceof TRPCError) return err;
  const message = err instanceof Error ? err.message : "Unknown project error";
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
}
