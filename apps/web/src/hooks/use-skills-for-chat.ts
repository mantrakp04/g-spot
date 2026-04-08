import type { Skill } from "@g-spot/types";
import { useMemo } from "react";

import { useGlobalSkills, useProjectSkills } from "@/hooks/use-skills";

/**
 * Merged-for-chat skill list: global skills for the user plus the active
 * project's skills, with project skills shadowing global skills on name
 * collision. Mirrors what `listSkillsForAgent` returns server-side so the
 * slash-command popover sees the same shape the agent will see at runtime.
 */
export function useSkillsForChat(projectId: string | null) {
  const globalQuery = useGlobalSkills();
  const projectQuery = useProjectSkills(projectId);

  const data = useMemo<Skill[] | undefined>(() => {
    const globalRows = globalQuery.data;
    const projectRows = projectQuery.data;

    // While either query is loading, return undefined so the UI can show a
    // pending state. We tolerate the project query being disabled when there
    // is no project — in that case `projectRows` is undefined but the global
    // result alone is still useful.
    if (projectId !== null && projectRows === undefined) return undefined;
    if (globalRows === undefined) return undefined;

    const byName = new Map<string, Skill>();
    for (const skill of globalRows) {
      byName.set(skill.name, skill as Skill);
    }
    if (projectRows) {
      for (const skill of projectRows) {
        byName.set(skill.name, skill as Skill);
      }
    }
    return Array.from(byName.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [globalQuery.data, projectId, projectQuery.data]);

  return {
    data,
    isLoading: globalQuery.isLoading || projectQuery.isLoading,
    error: globalQuery.error ?? projectQuery.error,
  };
}
