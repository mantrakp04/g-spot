import type { Skill } from "@g-spot/types";

/**
 * Slash commands come in two flavors:
 * - **Action** commands run a callback when picked (clear, fork, regenerate, …).
 * - **Insert** commands paste their content into the textarea so the user can
 *   tweak before submitting. Skills are always insert-style.
 */
export type SlashCommandKind = "action" | "insert";

export type SlashCommandSource = "builtin" | "skill-project" | "skill-global";

export interface SlashCommandContext {
  /** Clear the textarea value. */
  clearInput: () => void;
  /** Replace the textarea value entirely. */
  setInput: (value: string) => void;
  /** Currently active project, if any. */
  projectId: string | null;
  /** Active chat id (null while drafting). */
  chatId: string | null;
  /** Built-in action handlers wired by the host (chat-view). */
  handlers: BuiltinHandlers;
}

export interface BuiltinHandlers {
  onFork: () => void;
  onRegenerate: () => void;
  onHelp: () => void;
}

export interface BuiltinCommand {
  kind: "action";
  source: "builtin";
  /** Without the leading slash. */
  name: string;
  description: string;
  /** Disabled when this returns false (e.g. /fork without a chat). */
  isAvailable?: (ctx: SlashCommandContext) => boolean;
  run: (ctx: SlashCommandContext) => void | Promise<void>;
}

export interface SkillCommand {
  kind: "insert";
  source: "skill-project" | "skill-global";
  name: string;
  description: string;
  content: string;
  skillId: string;
}

export type SlashCommand = BuiltinCommand | SkillCommand;

export const BUILTIN_SLASH_COMMANDS: BuiltinCommand[] = [
  {
    kind: "action",
    source: "builtin",
    name: "clear",
    description: "Clear the prompt input",
    run: ({ clearInput }) => clearInput(),
  },
  {
    kind: "action",
    source: "builtin",
    name: "help",
    description: "Show available slash commands",
    run: ({ handlers }) => handlers.onHelp(),
  },
  {
    kind: "action",
    source: "builtin",
    name: "fork",
    description: "Fork this chat at the most recent message",
    isAvailable: (ctx) => ctx.chatId !== null,
    run: ({ handlers }) => handlers.onFork(),
  },
  {
    kind: "action",
    source: "builtin",
    name: "regenerate",
    description: "Regenerate the last assistant response",
    isAvailable: (ctx) => ctx.chatId !== null,
    run: ({ handlers }) => handlers.onRegenerate(),
  },
];

/**
 * Merge built-ins with the user's skill list. Built-in names always win the
 * bare `/name` slot; a colliding skill is only reachable as `/skill:name`.
 */
export function mergeSlashCommands(
  skills: Skill[],
  activeProjectId: string | null,
): SlashCommand[] {
  const builtinNames = new Set(BUILTIN_SLASH_COMMANDS.map((c) => c.name));

  const skillCommands: SkillCommand[] = skills.map((skill) => {
    const isProjectScoped =
      skill.projectId !== null && skill.projectId === activeProjectId;
    const baseName = builtinNames.has(skill.name)
      ? `skill:${skill.name}`
      : skill.name;
    return {
      kind: "insert",
      source: isProjectScoped ? "skill-project" : "skill-global",
      name: baseName,
      description: skill.description,
      content: skill.content,
      skillId: skill.id,
    };
  });

  return [...BUILTIN_SLASH_COMMANDS, ...skillCommands];
}

const SLASH_PATTERN = /^\/([A-Za-z0-9_:-]*)$/;

export function parseSlashQuery(value: string): { query: string } | null {
  const match = SLASH_PATTERN.exec(value);
  if (!match) return null;
  return { query: match[1] ?? "" };
}

/**
 * Filter and sort commands by query. Empty query → return everything in
 * registry order. Otherwise: prefix matches first, then substring matches,
 * then alphabetical within each bucket.
 */
export function filterSlashCommands(
  commands: SlashCommand[],
  query: string,
): SlashCommand[] {
  if (query.length === 0) {
    return commands;
  }
  const lower = query.toLowerCase();
  const scored = commands
    .map((command) => {
      const name = command.name.toLowerCase();
      let score = -1;
      if (name === lower) score = 100;
      else if (name.startsWith(lower)) score = 80;
      else if (name.includes(lower)) score = 40;
      return { command, score };
    })
    .filter((item) => item.score >= 0)
    .sort((a, b) =>
      b.score === a.score
        ? a.command.name.localeCompare(b.command.name)
        : b.score - a.score,
    );
  return scored.map((item) => item.command);
}
