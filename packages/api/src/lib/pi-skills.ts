import fs from "node:fs/promises";
import path from "node:path";

import {
  getAgentDir,
  loadSkills,
  loadSkillsFromDir,
  type Skill as PiSkill,
} from "@mariozechner/pi-coding-agent";
import type { Skill } from "@g-spot/types";

import { getProject } from "@g-spot/db/projects";

import { buildSkillMarkdown, parseSkillMarkdown } from "./skill-markdown";

const PI_CONFIG_DIR = ".pi";

export class SkillNameConflictError extends Error {
  constructor(name: string) {
    super(`A skill named "${name}" already exists in this scope`);
    this.name = "SkillNameConflictError";
  }
}

function getGlobalSkillsDir(agentDir = getAgentDir()) {
  return path.join(agentDir, "skills");
}

function getProjectSkillsDir(projectPath: string) {
  return path.join(projectPath, PI_CONFIG_DIR, "skills");
}

function makeSkillId(projectId: string | null, name: string) {
  return projectId === null ? `global:${name}` : `project:${projectId}:${name}`;
}

function parseSkillId(id: string) {
  if (id.startsWith("global:")) {
    return { projectId: null, name: id.slice("global:".length) };
  }

  if (id.startsWith("project:")) {
    const rest = id.slice("project:".length);
    const splitIndex = rest.indexOf(":");
    if (splitIndex > 0) {
      return {
        projectId: rest.slice(0, splitIndex),
        name: rest.slice(splitIndex + 1),
      };
    }
  }

  return null;
}

function isWithin(root: string, target: string) {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  return (
    normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(
      normalizedRoot.endsWith(path.sep)
        ? normalizedRoot
        : `${normalizedRoot}${path.sep}`,
    )
  );
}

async function toAppSkill(piSkill: PiSkill, projectId: string | null): Promise<Skill> {
  const raw = await fs.readFile(piSkill.filePath, "utf8");
  const parsed = parseSkillMarkdown(raw);
  const stats = await fs.stat(piSkill.filePath);
  const createdAt =
    stats.birthtime instanceof Date && !Number.isNaN(stats.birthtime.valueOf())
      ? stats.birthtime
      : stats.ctime;

  return {
    id: makeSkillId(projectId, piSkill.name),
    userId: "local",
    projectId,
    name: piSkill.name,
    description: parsed.description ?? piSkill.description,
    content: parsed.content,
    triggerKeywords: parsed.triggerKeywords,
    disableModelInvocation:
      piSkill.disableModelInvocation ?? parsed.disableModelInvocation,
    createdAt: createdAt.toISOString(),
    updatedAt: stats.mtime.toISOString(),
  };
}

async function loadScopeSkills(
  dir: string,
  scope: "user" | "project",
  projectId: string | null,
) {
  const result = loadSkillsFromDir({ dir, source: scope });
  const skills = await Promise.all(
    result.skills.map((skill) => toAppSkill(skill, projectId)),
  );
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

async function getProjectPathOrThrow(projectId: string) {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }
  return project.path;
}

async function getScopeRoot(projectId: string | null) {
  if (projectId === null) {
    return getGlobalSkillsDir();
  }
  return getProjectSkillsDir(await getProjectPathOrThrow(projectId));
}

function getManagedSkillPath(root: string, name: string) {
  return path.join(root, name, "SKILL.md");
}

async function writeSkillFile(
  root: string,
  input: {
    name: string;
    description: string;
    content: string;
    triggerKeywords: string[];
    disableModelInvocation: boolean;
  },
) {
  const filePath = getManagedSkillPath(root, input.name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buildSkillMarkdown(input), "utf8");
  return filePath;
}

async function cleanupSkillPath(filePath: string, root: string) {
  await fs.rm(filePath, { force: true });
  let dir = path.dirname(filePath);
  const resolvedRoot = path.resolve(root);

  while (isWithin(resolvedRoot, dir) && dir !== resolvedRoot) {
    try {
      await fs.rmdir(dir);
    } catch {
      break;
    }
    dir = path.dirname(dir);
  }
}

async function getSkillFileInfo(skill: Skill) {
  const scopeSkills =
    skill.projectId === null
      ? loadSkillsFromDir({ dir: getGlobalSkillsDir(), source: "user" })
      : loadSkillsFromDir({
          dir: getProjectSkillsDir(await getProjectPathOrThrow(skill.projectId)),
          source: "project",
        });

  return scopeSkills.skills.find((entry) => entry.name === skill.name) ?? null;
}

export async function listGlobalSkills(): Promise<Skill[]> {
  return loadScopeSkills(getGlobalSkillsDir(), "user", null);
}

export async function listProjectSkills(projectId: string): Promise<Skill[]> {
  const projectPath = await getProjectPathOrThrow(projectId);
  return loadScopeSkills(getProjectSkillsDir(projectPath), "project", projectId);
}

export async function listSkillsForAgent(projectId: string): Promise<Skill[]> {
  const projectPath = await getProjectPathOrThrow(projectId);
  const projectDir = getProjectSkillsDir(projectPath);
  const result = loadSkills({
    cwd: projectPath,
    agentDir: getAgentDir(),
  });

  const skills = await Promise.all(
    result.skills.map((skill) =>
      toAppSkill(skill, isWithin(projectDir, skill.filePath) ? projectId : null),
    ),
  );

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSkill(skillId: string): Promise<Skill | null> {
  const parsed = parseSkillId(skillId);
  if (!parsed) return null;

  const skills =
    parsed.projectId === null
      ? await listGlobalSkills()
      : await listProjectSkills(parsed.projectId);

  return skills.find((skill) => skill.name === parsed.name) ?? null;
}

export async function createSkill(input: {
  projectId: string | null;
  name: string;
  description: string;
  content?: string;
  triggerKeywords?: string[];
  disableModelInvocation?: boolean;
}): Promise<{ id: string }> {
  const existing =
    input.projectId === null
      ? await listGlobalSkills()
      : await listProjectSkills(input.projectId);

  if (existing.some((skill) => skill.name === input.name)) {
    throw new SkillNameConflictError(input.name);
  }

  const root = await getScopeRoot(input.projectId);
  await writeSkillFile(root, {
    name: input.name,
    description: input.description,
    content: input.content ?? "",
    triggerKeywords: input.triggerKeywords ?? [],
    disableModelInvocation: input.disableModelInvocation ?? false,
  });

  return { id: makeSkillId(input.projectId, input.name) };
}

export async function updateSkill(
  skillId: string,
  input: {
    name?: string;
    description?: string;
    content?: string;
    triggerKeywords?: string[];
    disableModelInvocation?: boolean;
  },
): Promise<void> {
  const existing = await getSkill(skillId);
  if (!existing) return;

  const nextName = input.name ?? existing.name;
  const nextDescription = input.description ?? existing.description;
  const nextContent = input.content ?? existing.content;
  const nextTriggerKeywords = input.triggerKeywords ?? existing.triggerKeywords;
  const nextDisableModelInvocation =
    input.disableModelInvocation ?? existing.disableModelInvocation;

  const scopeSkills =
    existing.projectId === null
      ? await listGlobalSkills()
      : await listProjectSkills(existing.projectId);

  const hasConflict = scopeSkills.some(
    (skill) => skill.name === nextName && skill.id !== existing.id,
  );
  if (hasConflict) {
    throw new SkillNameConflictError(nextName);
  }

  const root = await getScopeRoot(existing.projectId);
  const targetPath = await writeSkillFile(root, {
    name: nextName,
    description: nextDescription,
    content: nextContent,
    triggerKeywords: nextTriggerKeywords,
    disableModelInvocation: nextDisableModelInvocation,
  });

  const current = await getSkillFileInfo(existing);
  if (current && path.resolve(current.filePath) !== path.resolve(targetPath)) {
    await cleanupSkillPath(current.filePath, root);
  }
}

export async function deleteSkill(skillId: string): Promise<void> {
  const existing = await getSkill(skillId);
  if (!existing) return;

  const fileInfo = await getSkillFileInfo(existing);
  if (!fileInfo) return;

  const root = await getScopeRoot(existing.projectId);
  await cleanupSkillPath(fileInfo.filePath, root);
}
