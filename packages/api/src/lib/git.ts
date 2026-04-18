import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const WORKTREE_ROOT = path.join(os.tmpdir(), "g-spot-worktrees");

type BranchList = {
  local: string[];
  remote: string[];
  current: string | null;
  uncommittedCount: number;
};

type WorktreeMeta = {
  branch: string | null;
};

function getWorktreeBasePath(projectPath: string, chatId: string) {
  const projectHash = createHash("sha1")
    .update(projectPath)
    .digest("hex")
    .slice(0, 12);

  return path.join(WORKTREE_ROOT, projectHash, chatId);
}

function getWorktreeMetaPath(targetPath: string) {
  return path.join(targetPath, ".gspot-worktree.json");
}

function getErrorText(error: unknown) {
  if (!(error instanceof Error)) {
    return "";
  }

  const details = error as Error & {
    stdout?: string | Buffer;
    stderr?: string | Buffer;
  };

  return [
    error.message,
    details.stdout?.toString(),
    details.stderr?.toString(),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function isNonGitRepoError(error: unknown) {
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
    const parsed = JSON.parse(raw) as { branch?: unknown };
    return {
      branch: typeof parsed.branch === "string" ? parsed.branch : null,
    };
  } catch {
    return null;
  }
}

async function writeWorktreeMeta(targetPath: string, meta: WorktreeMeta) {
  await fs.writeFile(
    getWorktreeMetaPath(targetPath),
    JSON.stringify(meta),
    "utf8",
  );
}

async function isExistingWorktreeUsable(
  targetPath: string,
  branch: string | null,
): Promise<boolean> {
  try {
    await execGit(["rev-parse", "--is-inside-work-tree"], targetPath);
    const meta = await readWorktreeMeta(targetPath);
    return meta?.branch === branch;
  } catch {
    return false;
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const result = await execGit(["rev-parse", "--is-inside-work-tree"], cwd);
    return result.stdout.trim() === "true";
  } catch (error) {
    if (isNonGitRepoError(error)) {
      return false;
    }
    return false;
  }
}

export async function listBranches(cwd: string): Promise<BranchList> {
  const empty: BranchList = {
    local: [],
    remote: [],
    current: null,
    uncommittedCount: 0,
  };

  if (!(await isGitRepo(cwd))) {
    return empty;
  }

  try {
    const [
      { stdout: localStdout },
      { stdout: remoteStdout },
      currentResult,
      statusResult,
    ] = await Promise.all([
      execGit(["for-each-ref", "refs/heads", "--format=%(refname:short)"], cwd),
      execGit(["for-each-ref", "refs/remotes", "--format=%(refname:short)"], cwd),
      execGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd).catch(() => ({
        stdout: "",
        stderr: "",
      })),
      execGit(["status", "--porcelain"], cwd).catch(() => ({
        stdout: "",
        stderr: "",
      })),
    ]);

    const local = localStdout
      .split("\n")
      .map((branch) => branch.trim())
      .filter(Boolean);
    const remote = remoteStdout
      .split("\n")
      .map((branch) => branch.trim())
      .filter((branch) => branch.length > 0 && !branch.endsWith("/HEAD"));
    const currentBranch = currentResult.stdout.trim();
    const uncommittedCount = statusResult.stdout
      .split("\n")
      .filter((line) => line.length > 0).length;

    return {
      local,
      remote,
      current: currentBranch && currentBranch !== "HEAD" ? currentBranch : null,
      uncommittedCount,
    };
  } catch (error) {
    if (isNonGitRepoError(error)) {
      return empty;
    }

    return empty;
  }
}

export async function createBranch(args: {
  cwd: string;
  name: string;
  checkout: boolean;
}): Promise<void> {
  const { cwd, name, checkout } = args;
  if (!(await isGitRepo(cwd))) {
    throw new Error("Not a git repository");
  }

  await execGit(
    checkout ? ["checkout", "-b", name] : ["branch", name],
    cwd,
  );
}

export async function ensureWorktree(args: {
  projectPath: string;
  chatId: string;
  branch: string | null;
}): Promise<string | null> {
  const { projectPath, chatId, branch } = args;
  if (!(await isGitRepo(projectPath))) {
    return null;
  }

  const targetPath = getWorktreeBasePath(projectPath, chatId);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  if (await isExistingWorktreeUsable(targetPath, branch)) {
    return targetPath;
  }

  await removeWorktree({ projectPath, chatId });
  await fs.rm(targetPath, { recursive: true, force: true });

  try {
    await execGit(
      [
        "worktree",
        "add",
        "-B",
        `gspot/${chatId}`,
        targetPath,
        branch ?? "HEAD",
      ],
      projectPath,
    );
  } catch (error) {
    if (isNonGitRepoError(error)) {
      return null;
    }

    const text = getErrorText(error);
    const canRetryWithoutBranchReset =
      text.includes("already exists") || text.includes("already checked out");

    if (!canRetryWithoutBranchReset) {
      throw error;
    }

    await execGit(
      ["worktree", "add", targetPath, branch ?? "HEAD"],
      projectPath,
    );
  }

  await writeWorktreeMeta(targetPath, { branch });
  return targetPath;
}

export async function removeWorktree(args: {
  projectPath: string;
  chatId: string;
}): Promise<void> {
  const targetPath = getWorktreeBasePath(args.projectPath, args.chatId);

  try {
    await execGit(["worktree", "remove", "--force", targetPath], args.projectPath);
  } catch {
    // Best effort.
  }

  await fs.rm(targetPath, { recursive: true, force: true });
}
