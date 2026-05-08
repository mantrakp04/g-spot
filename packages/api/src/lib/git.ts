import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";

const execFile = promisify(execFileCallback);
const WORKTREE_ROOT = path.join(os.tmpdir(), "g-spot-worktrees");

// Branches the worktree machinery owns under the hood. Filtered out of every
// user-facing surface so the user only sees real branches and worktree slugs.
const INTERNAL_BRANCH_PREFIX = "gspot/";

export type Workspace =
  | {
      kind: "branch";
      name: string;
      isProtected: boolean;
      isCurrent: boolean;
      uncommittedCount: number;
    }
  | {
      kind: "worktree";
      name: string;
      path: string;
      baseBranch: string | null;
      uncommittedCount: number;
    };

export type WorkspaceList = {
  workspaces: Workspace[];
  remote: string[];
};

type WorktreeMeta = {
  baseBranch: string | null;
};

function projectHash(projectPath: string): string {
  return createHash("sha1").update(projectPath).digest("hex").slice(0, 12);
}

function getProjectWorktreeRoot(projectPath: string): string {
  return path.join(WORKTREE_ROOT, projectHash(projectPath));
}

export function getWorktreePath(projectPath: string, slug: string): string {
  return path.join(getProjectWorktreeRoot(projectPath), slug);
}

function getWorktreeMetaPath(targetPath: string): string {
  return path.join(targetPath, ".gspot-worktree.json");
}

function getErrorText(error: unknown): string {
  if (!(error instanceof Error)) return "";
  const details = error as Error & {
    stdout?: string | Buffer;
    stderr?: string | Buffer;
  };
  return [error.message, details.stdout?.toString(), details.stderr?.toString()]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function isNonGitRepoError(error: unknown): boolean {
  const text = getErrorText(error);
  return (
    text.includes("not a git repository") ||
    text.includes("outside repository") ||
    text.includes("not a work tree")
  );
}

async function execGit(args: string[], cwd: string) {
  return execFile("git", args, { cwd, maxBuffer: 50 * 1024 * 1024 });
}

export type FileChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "ignored"
  | "conflicted"
  | "typeChanged"
  | "unknown";

export type DiffNumstat = { additions: number; deletions: number };

export type FileChange = {
  path: string;
  oldPath: string | null;
  /** Two-letter porcelain code (e.g. " M", "M ", "MM", "??"). */
  code: string;
  staged: FileChangeStatus;
  unstaged: FileChangeStatus;
  /** Per-mode line additions/deletions. Binary files report 0. */
  stats: {
    staged: DiffNumstat;
    unstaged: DiffNumstat;
    uncommitted: DiffNumstat;
  };
};

function mapStatusChar(c: string): FileChangeStatus {
  switch (c) {
    case "M":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "typeChanged";
    case "U":
      return "conflicted";
    case "?":
      return "untracked";
    case "!":
      return "ignored";
    case " ":
      return "unknown";
    default:
      return "unknown";
  }
}

const ZERO_NUMSTAT: DiffNumstat = { additions: 0, deletions: 0 };

/**
 * Parse `git diff --numstat -z` output keyed by (new) path. Binary files
 * report `-` for both columns and are coerced to 0. Renames emit an empty
 * tail in the first token followed by two NUL-separated paths.
 */
async function readNumstat(args: string[], cwd: string): Promise<Map<string, DiffNumstat>> {
  const map = new Map<string, DiffNumstat>();
  let stdout: string;
  try {
    ({ stdout } = await execGit(args, cwd));
  } catch {
    return map;
  }
  const tokens = stdout.split("\0");
  if (tokens.length > 0 && tokens.at(-1) === "") tokens.pop();

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;
    const firstTab = token.indexOf("\t");
    if (firstTab < 0) {
      i += 1;
      continue;
    }
    const secondTab = token.indexOf("\t", firstTab + 1);
    if (secondTab < 0) {
      i += 1;
      continue;
    }
    const addStr = token.slice(0, firstTab);
    const delStr = token.slice(firstTab + 1, secondTab);
    const tail = token.slice(secondTab + 1);
    const additions = addStr === "-" ? 0 : Number(addStr) || 0;
    const deletions = delStr === "-" ? 0 : Number(delStr) || 0;
    if (tail === "") {
      // Rename: next two tokens hold the old and new paths.
      const newPath = tokens[i + 2] ?? "";
      if (newPath) map.set(newPath, { additions, deletions });
      i += 3;
    } else {
      map.set(tail, { additions, deletions });
      i += 1;
    }
  }
  return map;
}

/**
 * Count line additions for an untracked file (numstat doesn't see them).
 * Mirrors what `git diff --no-index /dev/null <file>` would report. Reads
 * a small slice and bails on binary content.
 */
async function countUntrackedAdditions(absPath: string): Promise<DiffNumstat> {
  try {
    const buf = await fs.readFile(absPath);
    if (buf.length === 0) return ZERO_NUMSTAT;
    // Heuristic: NUL byte ⇒ binary, treated as zero by numstat.
    if (buf.includes(0)) return ZERO_NUMSTAT;
    let lines = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) lines += 1;
    }
    if (buf[buf.length - 1] !== 0x0a) lines += 1;
    return { additions: lines, deletions: 0 };
  } catch {
    return ZERO_NUMSTAT;
  }
}

/**
 * Parse `git status --porcelain=v1 -z`. The -z form uses NUL separators and
 * does not quote paths — much safer than the default newline/quoted form.
 * Renames/copies emit two paths: "XY new\0orig\0".
 *
 * Each entry is enriched with per-mode line additions/deletions so the UI
 * can render +/- counts without an extra round-trip.
 */
export async function listChanges(cwd: string): Promise<FileChange[]> {
  if (!(await isGitRepo(cwd))) return [];

  const [statusRes, stagedStats, unstagedStats, uncommittedStats] = await Promise.all([
    execGit(["status", "--porcelain=v1", "-z"], cwd),
    readNumstat(["diff", "--numstat", "-z", "--cached"], cwd),
    readNumstat(["diff", "--numstat", "-z"], cwd),
    readNumstat(["diff", "--numstat", "-z", "HEAD"], cwd),
  ]);

  const out: FileChange[] = [];
  const tokens = statusRes.stdout.split("\0");
  if (tokens.length > 0 && tokens.at(-1) === "") tokens.pop();

  type Pending = {
    path: string;
    oldPath: string | null;
    code: string;
    x: string;
    y: string;
  };
  const pending: Pending[] = [];
  let i = 0;
  while (i < tokens.length) {
    const entry = tokens[i]!;
    if (entry.length < 3) {
      i += 1;
      continue;
    }
    const code = entry.slice(0, 2);
    const filePath = entry.slice(3);
    const x = code[0]!;
    const y = code[1]!;
    let oldPath: string | null = null;
    if (x === "R" || x === "C") {
      oldPath = tokens[i + 1] ?? null;
      i += 2;
    } else {
      i += 1;
    }
    pending.push({ path: filePath, oldPath, code, x, y });
  }

  // Untracked files don't appear in any numstat output; count their lines
  // directly so they show as all-additions in unstaged/uncommitted views.
  const untrackedStats = new Map<string, DiffNumstat>();
  await Promise.all(
    pending
      .filter((p) => p.y === "?")
      .map(async (p) => {
        untrackedStats.set(
          p.path,
          await countUntrackedAdditions(path.join(cwd, p.path)),
        );
      }),
  );

  for (const p of pending) {
    const untracked = untrackedStats.get(p.path);
    out.push({
      path: p.path,
      oldPath: p.oldPath,
      code: p.code,
      staged: mapStatusChar(p.x),
      unstaged: mapStatusChar(p.y),
      stats: {
        staged: stagedStats.get(p.path) ?? ZERO_NUMSTAT,
        unstaged: untracked ?? unstagedStats.get(p.path) ?? ZERO_NUMSTAT,
        uncommitted: untracked ?? uncommittedStats.get(p.path) ?? ZERO_NUMSTAT,
      },
    });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/**
 * Read the contents of `path` at one of three diff baselines. Returns "" when
 * the side doesn't exist (e.g. HEAD for an untracked file, working tree for a
 * deleted file). Throws only on unexpected git errors.
 */
export async function readDiffSide(args: {
  cwd: string;
  path: string;
  side: "head" | "index" | "working";
}): Promise<string> {
  const { cwd, path: filePath, side } = args;
  if (side === "working") {
    const { promises: fsp } = await import("node:fs");
    const path = await import("node:path");
    try {
      return await fsp.readFile(path.join(cwd, filePath), "utf8");
    } catch {
      return "";
    }
  }
  const ref = side === "head" ? "HEAD" : "";
  try {
    const { stdout } = await execGit(["show", `${ref}:${filePath}`], cwd);
    return stdout;
  } catch {
    return "";
  }
}

async function readWorktreeMeta(targetPath: string): Promise<WorktreeMeta | null> {
  try {
    const raw = await fs.readFile(getWorktreeMetaPath(targetPath), "utf8");
    const parsed = JSON.parse(raw) as { baseBranch?: unknown };
    return {
      baseBranch:
        typeof parsed.baseBranch === "string" ? parsed.baseBranch : null,
    };
  } catch {
    return null;
  }
}

async function writeWorktreeMeta(
  targetPath: string,
  meta: WorktreeMeta,
): Promise<void> {
  await fs.writeFile(
    getWorktreeMetaPath(targetPath),
    JSON.stringify(meta),
    "utf8",
  );
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const result = await execGit(["rev-parse", "--is-inside-work-tree"], cwd);
    return result.stdout.trim() === "true";
  } catch {
    return false;
  }
}

type ParsedWorktree = {
  rawBranch: string | null;
  path: string;
  isMainWorktree: boolean;
};

function parseWorktreeList(stdout: string): ParsedWorktree[] {
  const entries: ParsedWorktree[] = [];
  let current: ParsedWorktree | null = null;

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      if (current) {
        entries.push(current);
        current = null;
      }
      continue;
    }

    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = {
        path: line.slice("worktree ".length),
        rawBranch: null,
        isMainWorktree: false,
      };
      continue;
    }

    if (!current) continue;

    if (line.startsWith("branch refs/heads/")) {
      current.rawBranch = line.slice("branch refs/heads/".length);
      continue;
    }

    if (line === "bare") {
      current.rawBranch = null;
    }
  }

  if (current) entries.push(current);
  if (entries.length > 0) entries[0]!.isMainWorktree = true;
  return entries;
}

async function countUncommitted(worktreePath: string): Promise<number> {
  try {
    const { stdout } = await execGit(["status", "--porcelain"], worktreePath);
    return stdout.split("\n").filter((line) => line.length > 0).length;
  } catch {
    return 0;
  }
}

async function getProtectedBranches(
  cwd: string,
  localBranches: string[],
): Promise<string[]> {
  const protectedBranches = new Set<string>();
  const localSet = new Set(localBranches);

  try {
    const { stdout } = await execGit(["remote"], cwd);
    const remotes = stdout
      .split("\n")
      .map((remote) => remote.trim())
      .filter(Boolean);

    await Promise.all(
      remotes.map(async (remote) => {
        try {
          const { stdout: headStdout } = await execGit(
            ["symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`],
            cwd,
          );
          const head = headStdout.trim();
          const branch = head.split("/").at(-1);
          if (branch && localSet.has(branch)) {
            protectedBranches.add(branch);
          }
        } catch {
          // Remote without a cached HEAD — skip.
        }
      }),
    );
  } catch {
    // Repo without remotes — skip.
  }

  for (const fallback of ["main", "master", "trunk", "default"]) {
    if (localSet.has(fallback)) {
      protectedBranches.add(fallback);
      break;
    }
  }

  if (localBranches.length === 1) {
    protectedBranches.add(localBranches[0]!);
  }

  return [...protectedBranches];
}

/**
 * Single source of truth for what a chat can attach to: real local branches
 * and the slug-named worktrees living under WORKTREE_ROOT/<projectHash>/.
 *
 * `branch` rows reflect the main worktree (uncommitted count = main worktree's
 * status, current = checked out in main). `worktree` rows are independent dirs
 * with their own uncommitted state and a baseBranch read from their meta file.
 */
export async function listWorkspaces(projectPath: string): Promise<WorkspaceList> {
  if (!(await isGitRepo(projectPath))) {
    return { workspaces: [], remote: [] };
  }

  try {
    const [
      { stdout: localStdout },
      { stdout: remoteStdout },
      currentResult,
      worktreeResult,
    ] = await Promise.all([
      execGit(
        ["for-each-ref", "refs/heads", "--format=%(refname:short)"],
        projectPath,
      ),
      execGit(
        ["for-each-ref", "refs/remotes", "--format=%(refname:short)"],
        projectPath,
      ),
      execGit(["rev-parse", "--abbrev-ref", "HEAD"], projectPath).catch(() => ({
        stdout: "",
        stderr: "",
      })),
      execGit(["worktree", "list", "--porcelain"], projectPath).catch(() => ({
        stdout: "",
        stderr: "",
      })),
    ]);

    const local = localStdout
      .split("\n")
      .map((branch) => branch.trim())
      .filter(
        (branch) =>
          branch.length > 0 && !branch.startsWith(INTERNAL_BRANCH_PREFIX),
      );
    const remote = remoteStdout
      .split("\n")
      .map((branch) => branch.trim())
      .filter((branch) => branch.length > 0 && !branch.endsWith("/HEAD"));
    const rawCurrent = currentResult.stdout.trim();
    const current =
      rawCurrent &&
      rawCurrent !== "HEAD" &&
      !rawCurrent.startsWith(INTERNAL_BRANCH_PREFIX)
        ? rawCurrent
        : null;

    const protectedBranches = new Set(await getProtectedBranches(projectPath, local));

    const parsedWorktrees = parseWorktreeList(worktreeResult.stdout);
    const mainWorktree = parsedWorktrees.find((w) => w.isMainWorktree);
    const mainUncommitted = mainWorktree
      ? await countUncommitted(mainWorktree.path)
      : 0;

    const branchWorkspaces: Workspace[] = local.map((name) => ({
      kind: "branch",
      name,
      isProtected: protectedBranches.has(name),
      isCurrent: name === current,
      uncommittedCount: name === current ? mainUncommitted : 0,
    }));

    const childWorktrees = parsedWorktrees.filter((w) => !w.isMainWorktree);
    const worktreeWorkspaces: Workspace[] = await Promise.all(
      childWorktrees.map(async (worktree) => {
        const [uncommittedCount, meta] = await Promise.all([
          countUncommitted(worktree.path),
          readWorktreeMeta(worktree.path),
        ]);
        return {
          kind: "worktree" as const,
          name: path.basename(worktree.path),
          path: worktree.path,
          baseBranch: meta?.baseBranch ?? null,
          uncommittedCount,
        };
      }),
    );

    // Order: current branch first, then other branches, then worktrees grouped
    // by base branch (alphabetical within each group).
    const orderedBranches = [...branchWorkspaces].sort((a, b) => {
      if (a.kind !== "branch" || b.kind !== "branch") return 0;
      if (a.isCurrent && !b.isCurrent) return -1;
      if (!a.isCurrent && b.isCurrent) return 1;
      return a.name.localeCompare(b.name);
    });
    const orderedWorktrees = [...worktreeWorkspaces].sort((a, b) => {
      if (a.kind !== "worktree" || b.kind !== "worktree") return 0;
      const baseCompare = (a.baseBranch ?? "").localeCompare(b.baseBranch ?? "");
      if (baseCompare !== 0) return baseCompare;
      return a.name.localeCompare(b.name);
    });

    return {
      workspaces: [...orderedBranches, ...orderedWorktrees],
      remote,
    };
  } catch (error) {
    if (isNonGitRepoError(error)) {
      return { workspaces: [], remote: [] };
    }
    return { workspaces: [], remote: [] };
  }
}

export async function createBranch(args: {
  cwd: string;
  name: string;
  startPoint?: string | null;
  checkout: boolean;
}): Promise<void> {
  const { cwd, name, startPoint, checkout } = args;
  if (!(await isGitRepo(cwd))) {
    throw new Error("Not a git repository");
  }

  await execGit(
    checkout
      ? ["checkout", "-b", name, ...(startPoint ? [startPoint] : [])]
      : ["branch", name, ...(startPoint ? [startPoint] : [])],
    cwd,
  );
}

export async function deleteBranch(args: {
  cwd: string;
  name: string;
}): Promise<void> {
  const { cwd, name } = args;
  if (!(await isGitRepo(cwd))) {
    throw new Error("Not a git repository");
  }
  await execGit(["branch", "-D", name], cwd);
}

function generateWorktreeSlug(): string {
  const words = uniqueNamesGenerator({
    dictionaries: [adjectives, colors, animals],
    separator: "-",
    length: 3,
    style: "lowerCase",
  });
  const suffix = Math.floor(100 + Math.random() * 900);
  return `${words}-${suffix}`;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function pickFreshSlug(projectPath: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const slug = generateWorktreeSlug();
    if (!(await pathExists(getWorktreePath(projectPath, slug)))) {
      return slug;
    }
  }
  // Astronomically unlikely; surface it so we don't silently overwrite.
  throw new Error("Could not generate a unique worktree name");
}

/**
 * Create a fresh worktree on disk + git, anchored to `baseBranch`. Returns the
 * slug (= directory name = user-facing worktree identity) and full path. The
 * worktree's actual git branch is `gspot/<slug>` so user-facing branches stay
 * uncluttered; the user-facing base branch is persisted in the meta file.
 */
export async function createWorktree(args: {
  projectPath: string;
  baseBranch: string | null;
}): Promise<{ name: string; path: string; baseBranch: string | null }> {
  const { projectPath, baseBranch } = args;
  if (!(await isGitRepo(projectPath))) {
    throw new Error("Not a git repository");
  }

  const slug = await pickFreshSlug(projectPath);
  const targetPath = getWorktreePath(projectPath, slug);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  await execGit(
    [
      "worktree",
      "add",
      "-B",
      `${INTERNAL_BRANCH_PREFIX}${slug}`,
      targetPath,
      baseBranch ?? "HEAD",
    ],
    projectPath,
  );

  await writeWorktreeMeta(targetPath, { baseBranch });

  return { name: slug, path: targetPath, baseBranch };
}

/**
 * Delete a worktree by slug. Best-effort `git worktree remove --force`, then
 * scrub the directory + the internal `gspot/<slug>` branch.
 */
export async function removeWorktree(args: {
  projectPath: string;
  name: string;
}): Promise<void> {
  const { projectPath, name } = args;
  const targetPath = getWorktreePath(projectPath, name);

  try {
    await execGit(["worktree", "remove", "--force", targetPath], projectPath);
  } catch {
    // Best effort.
  }

  await fs.rm(targetPath, { recursive: true, force: true });

  try {
    await execGit(
      ["branch", "-D", `${INTERNAL_BRANCH_PREFIX}${name}`],
      projectPath,
    );
  } catch {
    // Branch may already be gone.
  }
}
