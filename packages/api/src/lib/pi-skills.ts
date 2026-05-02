import fs from "node:fs/promises";
import path from "node:path";

import {
  DefaultResourceLoader,
  getAgentDir,
  type Skill as PiSkill,
} from "@mariozechner/pi-coding-agent";
import type { Skill } from "@g-spot/types";

import { getProject } from "@g-spot/db/projects";

import { buildSkillMarkdown, parseSkillMarkdown } from "./skill-markdown";

const PI_CONFIG_DIR = ".pi";
const DISCOVERED_SKILL_ID_PREFIX = "discovered:";

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

function encodeSkillPath(filePath: string) {
  return Buffer.from(path.resolve(filePath), "utf8").toString("base64url");
}

function makeSkillId(projectId: string | null, filePath: string) {
  return `${DISCOVERED_SKILL_ID_PREFIX}${projectId ?? "global"}:${encodeSkillPath(filePath)}`;
}

function parseSkillId(id: string) {
  if (id.startsWith(DISCOVERED_SKILL_ID_PREFIX)) {
    const rest = id.slice(DISCOVERED_SKILL_ID_PREFIX.length);
    const splitIndex = rest.indexOf(":");
    if (splitIndex > 0) {
      const projectKey = rest.slice(0, splitIndex);
      return {
        kind: "discovered" as const,
        projectId: projectKey === "global" ? null : projectKey,
      };
    }
  }

  // Back-compat for skill IDs created before discovered-path IDs.
  if (id.startsWith("global:")) {
    return {
      kind: "legacy" as const,
      projectId: null,
      name: id.slice("global:".length),
    };
  }

  if (id.startsWith("project:")) {
    const rest = id.slice("project:".length);
    const splitIndex = rest.indexOf(":");
    if (splitIndex > 0) {
      return {
        kind: "legacy" as const,
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

async function toAppSkill(
  piSkill: PiSkill,
  projectId: string | null,
  discoveryProjectId: string | null,
): Promise<Skill> {
  const raw = await fs.readFile(piSkill.filePath, "utf8");
  const parsed = parseSkillMarkdown(raw);
  const stats = await fs.stat(piSkill.filePath);
  const createdAt =
    stats.birthtime instanceof Date && !Number.isNaN(stats.birthtime.valueOf())
      ? stats.birthtime
      : stats.ctime;

  return {
    id: makeSkillId(discoveryProjectId, piSkill.filePath),
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

function getSkillProjectId(
  piSkill: PiSkill,
  projectId: string | null,
  projectSkillsDir: string | null,
) {
  if (!projectId) return null;
  if (piSkill.sourceInfo.scope === "project") return projectId;
  if (projectSkillsDir && isWithin(projectSkillsDir, piSkill.filePath)) {
    return projectId;
  }
  return null;
}

async function loadDiscoveredSkills(
  cwd: string,
  projectId: string | null,
): Promise<Array<{ appSkill: Skill; piSkill: PiSkill }>> {
  const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir() });
  await loader.reload();
  const projectSkillsDir = projectId ? getProjectSkillsDir(cwd) : null;
  const rows = await Promise.all(
    loader.getSkills().skills.map(async (skill) => ({
      appSkill: await toAppSkill(
        skill,
        getSkillProjectId(skill, projectId, projectSkillsDir),
        projectId,
      ),
      piSkill: skill,
    })),
  );
  return rows.sort((a, b) => a.appSkill.name.localeCompare(b.appSkill.name));
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

async function getDiscoveredSkillRows(projectId: string | null) {
  const cwd = projectId ? await getProjectPathOrThrow(projectId) : process.cwd();
  return loadDiscoveredSkills(cwd, projectId);
}

async function getSkillFileInfo(skillId: string) {
  const parsed = parseSkillId(skillId);
  if (!parsed) return null;

  const rows = await getDiscoveredSkillRows(parsed.projectId);
  if (parsed.kind === "discovered") {
    return rows.find((row) => row.appSkill.id === skillId)?.piSkill ?? null;
  }
  return rows.find((row) => row.appSkill.name === parsed.name)?.piSkill ?? null;
}

export async function listGlobalSkills(): Promise<Skill[]> {
  const rows = await loadDiscoveredSkills(process.cwd(), null);
  return rows.map((row) => row.appSkill);
}

export async function listProjectSkills(projectId: string): Promise<Skill[]> {
  const projectPath = await getProjectPathOrThrow(projectId);
  const rows = await loadDiscoveredSkills(projectPath, projectId);
  return rows.map((row) => row.appSkill);
}

export async function listSkillsForAgent(projectId: string): Promise<Skill[]> {
  return listProjectSkills(projectId);
}

export async function getSkill(skillId: string): Promise<Skill | null> {
  const parsed = parseSkillId(skillId);
  if (!parsed) return null;

  const rows = await getDiscoveredSkillRows(parsed.projectId);
  if (parsed.kind === "discovered") {
    return rows.find((row) => row.appSkill.id === skillId)?.appSkill ?? null;
  }
  return rows.find((row) => row.appSkill.name === parsed.name)?.appSkill ?? null;
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
  const filePath = await writeSkillFile(root, {
    name: input.name,
    description: input.description,
    content: input.content ?? "",
    triggerKeywords: input.triggerKeywords ?? [],
    disableModelInvocation: input.disableModelInvocation ?? false,
  });

  return { id: makeSkillId(input.projectId, filePath) };
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

  const parsed = parseSkillId(skillId);
  if (!parsed) return;
  const scopeSkills =
    parsed.projectId === null
      ? await listGlobalSkills()
      : await listProjectSkills(parsed.projectId);

  const hasConflict = scopeSkills.some(
    (skill) => skill.name === nextName && skill.id !== existing.id,
  );
  if (hasConflict) {
    throw new SkillNameConflictError(nextName);
  }

  const current = await getSkillFileInfo(skillId);
  if (!current) return;

  await fs.writeFile(
    current.filePath,
    buildSkillMarkdown({
      name: nextName,
      description: nextDescription,
      content: nextContent,
      triggerKeywords: nextTriggerKeywords,
      disableModelInvocation: nextDisableModelInvocation,
    }),
    "utf8",
  );
}

export async function deleteSkill(skillId: string): Promise<void> {
  const existing = await getSkill(skillId);
  if (!existing) return;

  const fileInfo = await getSkillFileInfo(skillId);
  if (!fileInfo) return;

  await fs.rm(fileInfo.filePath, { force: true });
  if (path.basename(fileInfo.filePath) === "SKILL.md") {
    try {
      await fs.rmdir(path.dirname(fileInfo.filePath));
    } catch {
      // Keep non-empty skill directories with assets/scripts intact.
    }
  }
}
