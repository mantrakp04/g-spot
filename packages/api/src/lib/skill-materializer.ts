import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createSyntheticSourceInfo } from "@mariozechner/pi-coding-agent";
import type { Skill as PiSkill } from "@mariozechner/pi-coding-agent";
import { nanoid } from "nanoid";

import type { SkillRecord } from "@g-spot/db/skills";

/**
 * Pi's skill loader is file-backed: a Skill object only carries `filePath`,
 * and the `read` tool is used to actually load the markdown body at turn time.
 * To make our DB-stored skills usable we have to write each one to disk in the
 * shape Pi expects (one directory per skill, containing `SKILL.md` with proper
 * frontmatter), and hand the resulting Skill objects to a `skillsOverride` on
 * `DefaultResourceLoader`.
 *
 * Materialized files live in an os.tmpdir() subtree that the caller deletes
 * when the agent session is torn down (see `disposeSkillsRoot`).
 */

export type MaterializedSkills = {
  /** Root directory containing per-skill subdirectories. Caller must dispose. */
  skillsRoot: string;
  /** Pi-shaped skill objects ready to be returned from `skillsOverride`. */
  skills: PiSkill[];
};

function escapeYamlString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildSkillMarkdown(record: SkillRecord) {
  const lines = [
    "---",
    `name: ${record.name}`,
    `description: "${escapeYamlString(record.description)}"`,
  ];
  if (record.disableModelInvocation) {
    lines.push("disable-model-invocation: true");
  }
  lines.push("---", "");
  return lines.join("\n") + record.content;
}

export async function materializeSkills(
  scopeKey: string,
  records: SkillRecord[],
): Promise<MaterializedSkills> {
  const skillsRoot = path.join(
    os.tmpdir(),
    "g-spot",
    "skills",
    `${scopeKey}-${nanoid(8)}`,
  );

  await fs.mkdir(skillsRoot, { recursive: true });

  const skills: PiSkill[] = [];
  for (const record of records) {
    // Defense-in-depth: name is regex-validated in zod, but assert again.
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.name)) {
      continue;
    }
    const skillDir = path.join(skillsRoot, record.name);
    if (!skillDir.startsWith(skillsRoot)) {
      // path traversal — refuse.
      continue;
    }
    await fs.mkdir(skillDir, { recursive: true });
    const filePath = path.join(skillDir, "SKILL.md");
    await fs.writeFile(filePath, buildSkillMarkdown(record), "utf-8");

    skills.push({
      name: record.name,
      description: record.description,
      filePath,
      baseDir: skillDir,
      sourceInfo: createSyntheticSourceInfo(filePath, {
        source: "g-spot",
        scope: "project",
        baseDir: skillDir,
      }),
      disableModelInvocation: record.disableModelInvocation,
    });
  }

  return { skillsRoot, skills };
}

export async function disposeSkillsRoot(skillsRoot: string | null | undefined) {
  if (!skillsRoot) return;
  try {
    await fs.rm(skillsRoot, { recursive: true, force: true });
  } catch (err) {
    console.warn("[skills] failed to dispose materialized skills", {
      skillsRoot,
      err: err instanceof Error ? err.message : err,
    });
  }
}
