import { execFile as execFileCallback, spawn } from "node:child_process";
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

/**
 * Like `execGit` but pipes `stdin` to git's stdin. Used for `git apply`.
 * Throws an Error whose `message` contains stderr on non-zero exit.
 */
async function execGitStdin(
  args: string[],
  cwd: string,
  stdin: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const MAX = 50 * 1024 * 1024;
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= MAX) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX) stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const err = new Error(stderr || `git ${args.join(" ")} exited ${code}`) as Error & {
          stdout?: string;
          stderr?: string;
          code?: number;
        };
        err.stdout = stdout;
        err.stderr = stderr;
        err.code = code ?? undefined;
        reject(err);
      }
    });
    child.stdin.on("error", () => {
      // Ignore EPIPE — git may close stdin early on parse error and we
      // surface the actual reason via stderr above.
    });
    child.stdin.end(stdin);
  });
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
    execGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd),
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

// ---------------------------------------------------------------------------
// VSCode Source Control parity
// ---------------------------------------------------------------------------

export type RepoStateKind =
  | "clean"
  | "merging"
  | "rebasing"
  | "cherry-picking"
  | "reverting";

export type RepoState = {
  state: RepoStateKind;
  conflicted: boolean;
  hasStaged: boolean;
  hasUnstaged: boolean;
};

export type CurrentBranchInfo = {
  branch: string | null;
  ahead: number;
  behind: number;
  upstream: string | null;
};

export type StashEntry = {
  index: number;
  message: string;
  branch: string | null;
  sha: string;
};

function assertSafePath(p: string): void {
  if (path.isAbsolute(p)) {
    throw new Error(`Path must be relative: ${p}`);
  }
  const segments = p.split(/[/\\]/);
  if (segments.some((s) => s === "..")) {
    throw new Error(`Path must not contain '..' segments: ${p}`);
  }
}

function assertSafePaths(paths: string[]): void {
  for (const p of paths) assertSafePath(p);
}

async function gitDir(cwd: string): Promise<string> {
  const { stdout } = await execGit(["rev-parse", "--git-dir"], cwd);
  const dir = stdout.trim();
  return path.isAbsolute(dir) ? dir : path.join(cwd, dir);
}

async function hasHead(cwd: string): Promise<boolean> {
  try {
    await execGit(["rev-parse", "--verify", "HEAD"], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function stagePaths(cwd: string, paths: string[]): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  assertSafePaths(paths);
  await execGit(["add", "-A", "--", ...paths], cwd);
}

export async function unstagePaths(cwd: string, paths: string[]): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  assertSafePaths(paths);
  if (await hasHead(cwd)) {
    await execGit(["reset", "HEAD", "--", ...paths], cwd);
  } else {
    await execGit(["rm", "--cached", "--", ...paths], cwd);
  }
}

export async function stageAll(cwd: string): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  await execGit(["add", "-A"], cwd);
}

export async function unstageAll(cwd: string): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  if (await hasHead(cwd)) {
    await execGit(["reset", "HEAD", "--"], cwd);
  } else {
    await execGit(["rm", "--cached", "-r", "."], cwd);
  }
}

export async function applyPatch(args: {
  cwd: string;
  patch: string;
  cached: boolean;
  reverse: boolean;
}): Promise<void> {
  const { cwd, patch, cached, reverse } = args;
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  const flags = ["apply", "--unidiff-zero", "--whitespace=nowarn"];
  if (cached) flags.push("--cached");
  if (reverse) flags.push("--reverse");
  await execGitStdin(flags, cwd, patch);
}

export async function discardPaths(cwd: string, paths: string[]): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  assertSafePaths(paths);

  const changes = await listChanges(cwd);
  const byPath = new Map(changes.map((c) => [c.path, c]));
  const tracked: string[] = [];
  const untracked: string[] = [];

  for (const p of paths) {
    const change = byPath.get(p);
    if (!change) {
      // Not in status — nothing to discard.
      continue;
    }
    if (change.code === "??") {
      untracked.push(p);
    } else {
      tracked.push(p);
    }
  }

  if (tracked.length > 0) {
    await execGit(["checkout", "--", ...tracked], cwd);
  }
  await Promise.all(
    untracked.map((p) =>
      fs.rm(path.join(cwd, p), { recursive: true, force: true }),
    ),
  );
}

export async function discardAll(cwd: string): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  try {
    await execGit(["checkout", "--", "."], cwd);
  } catch {
    // No tracked changes is fine.
  }
  await execGit(["clean", "-fd"], cwd);
}

export async function cleanUntracked(cwd: string, paths: string[]): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  assertSafePaths(paths);
  await Promise.all(
    paths.map((p) =>
      fs.rm(path.join(cwd, p), { recursive: true, force: true }),
    ),
  );
}

export async function acceptCurrent(cwd: string, paths: string[]): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  assertSafePaths(paths);
  await execGit(["checkout", "--ours", "--", ...paths], cwd);
  await execGit(["add", "--", ...paths], cwd);
}

export async function acceptIncoming(cwd: string, paths: string[]): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  assertSafePaths(paths);
  await execGit(["checkout", "--theirs", "--", ...paths], cwd);
  await execGit(["add", "--", ...paths], cwd);
}

export async function acceptBoth(cwd: string, paths: string[]): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  assertSafePaths(paths);
  await execGit(["add", "--", ...paths], cwd);
}

export async function commit(args: {
  cwd: string;
  message: string;
  amend: boolean;
  signoff: boolean;
  all: boolean;
}): Promise<{ sha: string }> {
  const { cwd, message, amend, signoff, all } = args;
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  const flags = ["commit"];
  if (amend) flags.push("--amend");
  if (signoff) flags.push("--signoff");
  if (all) flags.push("-a");
  flags.push("-m", message);
  await execGit(flags, cwd);
  const { stdout } = await execGit(["rev-parse", "HEAD"], cwd);
  return { sha: stdout.trim() };
}

export async function lastCommitMessage(cwd: string): Promise<string | null> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  if (!(await hasHead(cwd))) return null;
  try {
    const { stdout } = await execGit(["log", "-1", "--pretty=%B"], cwd);
    // Strip trailing newline that git appends.
    return stdout.replace(/\n$/, "");
  } catch {
    return null;
  }
}

function commitDraftPath(gitDirPath: string): string {
  return path.join(gitDirPath, ".gspot-commit-draft.txt");
}

export async function readCommitMessageDraft(cwd: string): Promise<string> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  const dir = await gitDir(cwd);
  try {
    return await fs.readFile(commitDraftPath(dir), "utf8");
  } catch {
    return "";
  }
}

export async function writeCommitMessageDraft(
  cwd: string,
  draft: string,
): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  const dir = await gitDir(cwd);
  const target = commitDraftPath(dir);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, draft, "utf8");
  await fs.rename(tmp, target);
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function getRepoState(cwd: string): Promise<RepoState> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  const dir = await gitDir(cwd);

  const [merging, rebaseApply, rebaseMerge, cherry, revert, changes] =
    await Promise.all([
      fileExists(path.join(dir, "MERGE_HEAD")),
      dirExists(path.join(dir, "rebase-apply")),
      dirExists(path.join(dir, "rebase-merge")),
      fileExists(path.join(dir, "CHERRY_PICK_HEAD")),
      fileExists(path.join(dir, "REVERT_HEAD")),
      listChanges(cwd),
    ]);

  let state: RepoStateKind = "clean";
  if (merging) state = "merging";
  else if (rebaseApply || rebaseMerge) state = "rebasing";
  else if (cherry) state = "cherry-picking";
  else if (revert) state = "reverting";

  let conflicted = false;
  let hasStaged = false;
  let hasUnstaged = false;
  for (const c of changes) {
    if (c.staged === "conflicted" || c.unstaged === "conflicted") conflicted = true;
    if (c.code === "??") {
      hasUnstaged = true;
      continue;
    }
    const x = c.code[0];
    const y = c.code[1];
    if (x && x !== " " && x !== "?") hasStaged = true;
    if (y && y !== " " && y !== "?") hasUnstaged = true;
  }

  return { state, conflicted, hasStaged, hasUnstaged };
}

export async function getCurrentBranch(cwd: string): Promise<CurrentBranchInfo> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");

  let branch: string | null = null;
  try {
    const { stdout } = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    const name = stdout.trim();
    branch = name && name !== "HEAD" ? name : null;
  } catch {
    branch = null;
  }

  let upstream: string | null = null;
  try {
    const { stdout } = await execGit(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      cwd,
    );
    const u = stdout.trim();
    upstream = u || null;
  } catch {
    upstream = null;
  }

  let ahead = 0;
  let behind = 0;
  if (upstream) {
    try {
      const { stdout } = await execGit(
        ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        cwd,
      );
      const parts = stdout.trim().split(/\s+/);
      ahead = Number(parts[0]) || 0;
      behind = Number(parts[1]) || 0;
    } catch {
      ahead = 0;
      behind = 0;
    }
  }

  return { branch, ahead, behind, upstream };
}

export async function gitFetch(args: {
  cwd: string;
  remote?: string | null;
  all?: boolean;
}): Promise<void> {
  const { cwd, remote, all } = args;
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  const flags = ["fetch"];
  if (all || (!remote && all !== false)) {
    flags.push("--all");
  } else if (remote) {
    flags.push(remote);
  }
  await execGit(flags, cwd);
}

export async function gitPull(args: {
  cwd: string;
  rebase?: boolean;
}): Promise<void> {
  const { cwd, rebase } = args;
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  const flags = ["pull"];
  if (rebase) flags.push("--rebase");
  try {
    await execGit(flags, cwd);
  } catch (error) {
    const text = getErrorText(error);
    throw new Error(text || "git pull failed");
  }
}

export async function gitPush(args: {
  cwd: string;
  force?: boolean;
  setUpstream?: boolean;
}): Promise<void> {
  const { cwd, force, setUpstream } = args;
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  const flags = ["push"];
  if (force) flags.push("--force-with-lease");
  if (setUpstream) {
    const { branch } = await getCurrentBranch(cwd);
    if (!branch) throw new Error("Cannot set upstream on detached HEAD");
    flags.push("-u", "origin", branch);
  }
  try {
    await execGit(flags, cwd);
  } catch (error) {
    const text = getErrorText(error);
    throw new Error(text || "git push failed");
  }
}

export async function gitSync(cwd: string): Promise<void> {
  await gitPull({ cwd });
  await gitPush({ cwd });
}

export async function publishBranch(cwd: string): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  const { branch } = await getCurrentBranch(cwd);
  if (!branch) throw new Error("Detached HEAD — nothing to publish");
  try {
    await execGit(["push", "-u", "origin", branch], cwd);
  } catch (error) {
    const text = getErrorText(error);
    throw new Error(text || "Failed to publish branch");
  }
}

export async function listStashes(cwd: string): Promise<StashEntry[]> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  let stdout: string;
  try {
    ({ stdout } = await execGit(
      ["stash", "list", "--pretty=%gd|%s|%H"],
      cwd,
    ));
  } catch {
    return [];
  }
  const out: StashEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const parts = line.split("|");
    if (parts.length < 3) continue;
    const ref = parts[0]!;
    const message = parts.slice(1, -1).join("|");
    const sha = parts[parts.length - 1]!;
    const m = ref.match(/^stash@\{(\d+)\}$/);
    if (!m) continue;
    const index = Number(m[1]);
    let branch: string | null = null;
    const wipMatch = message.match(/^WIP on ([^:]+):/);
    const onMatch = message.match(/^On ([^:]+):/);
    if (wipMatch) branch = wipMatch[1] ?? null;
    else if (onMatch) branch = onMatch[1] ?? null;
    out.push({ index, message, branch, sha });
  }
  return out;
}

export async function stashPush(args: {
  cwd: string;
  message?: string | null;
  includeUntracked?: boolean;
  keepIndex?: boolean;
}): Promise<void> {
  const { cwd, message, includeUntracked, keepIndex } = args;
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  const flags = ["stash", "push"];
  if (includeUntracked) flags.push("--include-untracked");
  if (keepIndex) flags.push("--keep-index");
  if (message) flags.push("-m", message);
  await execGit(flags, cwd);
}

export async function stashPop(cwd: string, index: number): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  await execGit(["stash", "pop", `stash@{${index}}`], cwd);
}

export async function stashApply(cwd: string, index: number): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  await execGit(["stash", "apply", `stash@{${index}}`], cwd);
}

export async function stashDrop(cwd: string, index: number): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  await execGit(["stash", "drop", `stash@{${index}}`], cwd);
}

export async function addToGitignore(cwd: string, paths: string[]): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  assertSafePaths(paths);
  const target = path.join(cwd, ".gitignore");
  let existing = "";
  try {
    existing = await fs.readFile(target, "utf8");
  } catch {
    existing = "";
  }
  const lines = existing.split("\n");
  const present = new Set(lines.map((l) => l.trim()).filter(Boolean));
  const additions: string[] = [];
  for (const p of paths) {
    if (!present.has(p)) {
      additions.push(p);
      present.add(p);
    }
  }
  if (additions.length === 0) return;
  let next = existing;
  if (next.length > 0 && !next.endsWith("\n")) next += "\n";
  next += `${additions.join("\n")}\n`;
  await fs.writeFile(target, next, "utf8");
}

export async function gitReset(args: {
  cwd: string;
  mode: "soft" | "mixed" | "hard";
  ref: string;
}): Promise<void> {
  const { cwd, mode, ref } = args;
  if (!(await isGitRepo(cwd))) throw new Error("Not a git repository");
  await execGit(["reset", `--${mode}`, ref], cwd);
}
