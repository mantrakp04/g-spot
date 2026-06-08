import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

// Hardcoded ignore list for v1. A proper .gitignore parser is a follow-up —
// these cover ~all common noise without pulling a dep.
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".turbo",
  ".cache",
  ".vite",
  ".parcel-cache",
  "dist",
  "build",
  "out",
  "coverage",
  ".nyc_output",
  ".DS_Store",
]);

const MAX_FILES = 50_000;
const LIST_ALL_CACHE_MS = 30_000;

type FileListCacheEntry = {
  expiresAt: number;
  promise: Promise<string[]>;
};

const fileListCache = new Map<string, FileListCacheEntry>();

function shouldSkip(name: string) {
  return IGNORED_DIRS.has(name);
}

function classify(entry: Dirent): FsEntry["kind"] | null {
  if (entry.isDirectory()) return "directory";
  if (entry.isFile() || entry.isSymbolicLink()) return "file";
  return null;
}

export type FsEntry = {
  name: string;
  /** Path relative to the project root, using forward slashes. */
  path: string;
  kind: "file" | "directory";
};

/**
 * Resolve a user-supplied relative path against the project root and refuse
 * to escape it. Returns the absolute path or throws.
 */
export function resolveWithinProject(
  projectPath: string,
  relativePath: string,
): string {
  const root = path.resolve(projectPath);
  const target = path.resolve(root, relativePath);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes project root: ${relativePath}`);
  }
  return target;
}

function toPosix(p: string) {
  return p.split(path.sep).join("/");
}

/**
 * List immediate children of `relativePath` within the project. Empty path
 * means project root. Returns directories first, then files, both alphabetical.
 */
export async function listDirectory(
  projectPath: string,
  relativePath: string,
): Promise<FsEntry[]> {
  const abs = resolveWithinProject(projectPath, relativePath || ".");
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const out: FsEntry[] = [];
  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue;
    const kind = classify(entry);
    if (!kind) continue;
    const childRel = toPosix(
      relativePath ? `${relativePath}/${entry.name}` : entry.name,
    );
    out.push({ name: entry.name, path: childRel, kind });
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

/**
 * Recursively walk the project, returning every file path (relative, posix).
 * Used by Cmd+P. Capped to keep huge repos from OOMing the client.
 */
export async function listAllFiles(projectPath: string): Promise<string[]> {
  const root = path.resolve(projectPath);
  const now = Date.now();
  const cached = fileListCache.get(root);
  if (cached && cached.expiresAt > now) {
    return (await cached.promise).slice();
  }

  const promise = walkAllFiles(root);
  fileListCache.set(root, {
    expiresAt: now + LIST_ALL_CACHE_MS,
    promise,
  });

  try {
    return (await promise).slice();
  } catch (error) {
    fileListCache.delete(root);
    throw error;
  }
}

async function walkAllFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dirAbs: string, dirRel: string) {
    if (out.length >= MAX_FILES) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      if (shouldSkip(entry.name)) continue;
      const kind = classify(entry);
      if (!kind) continue;
      const childAbs = path.join(dirAbs, entry.name);
      const childRel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (kind === "directory") {
        await walk(childAbs, childRel);
      } else {
        out.push(childRel);
      }
    }
  }
  await walk(root, "");
  return out;
}

/** Read a file as UTF-8. Throws on binary-ish content (NUL byte heuristic). */
export async function readFileText(
  projectPath: string,
  relativePath: string,
): Promise<{ content: string; size: number }> {
  const abs = resolveWithinProject(projectPath, relativePath);
  const stat = await fs.stat(abs);
  if (!stat.isFile()) throw new Error("Not a file");
  const buf = await fs.readFile(abs);
  // Heuristic: presence of NUL in the first 8KB → binary. Refuse so the
  // editor doesn't try to render garbage.
  const probe = buf.subarray(0, Math.min(buf.length, 8192));
  if (probe.includes(0)) {
    throw new Error("Binary file");
  }
  return { content: buf.toString("utf8"), size: stat.size };
}

export async function writeFileText(
  projectPath: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const abs = resolveWithinProject(projectPath, relativePath);
  await fs.writeFile(abs, content, "utf8");
}
