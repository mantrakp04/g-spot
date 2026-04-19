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
  return execFile("git", args, { cwd });
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
