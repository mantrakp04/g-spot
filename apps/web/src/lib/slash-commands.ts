import type { Skill } from "@g-spot/types";

/**
 * Slash commands come in two flavors:
 * - **Action** commands run a callback when picked (clear, fork, regenerate, …).
 * - **Insert** commands paste a literal slash-command into the textarea so the
 *   user can add arguments before submitting. Skills are insert-style: they
 *   insert `/skill:name ` (the form the Pi agent expands server-side), NOT
 *   the skill body — the agent loads content from the materialized SKILL.md
 *   on its side.
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
  /** Display name with the `skill:` prefix (e.g. `skill:frontend-design`). */
  name: string;
  description: string;
  /** Text that gets written into the textarea when picked. */
  insertText: string;
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
 * Merge built-ins with the user's skill list. The Pi agent always registers
 * skills under `skill:<name>` (see pi-coding-agent/core/agent-session.js
 * line ~1689), so we use the same prefix here uniformly — that way the
 * literal inserted into the textarea (`/skill:foo ...`) is exactly what the
 * agent expands server-side into a `<skill>...</skill>` block.
 */
export function mergeSlashCommands(
  skills: Skill[],
  activeProjectId: string | null,
): SlashCommand[] {
  const skillCommands: SkillCommand[] = skills.map((skill) => {
    const isProjectScoped =
      skill.projectId !== null && skill.projectId === activeProjectId;
    const prefixed = `skill:${skill.name}`;
    return {
      kind: "insert",
      source: isProjectScoped ? "skill-project" : "skill-global",
      name: prefixed,
      description: skill.description,
      // Trailing space so the user can immediately start typing args after
      // picking the skill from the popover.
      insertText: `/${prefixed} `,
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
 *
 * Skill commands are matched against both the prefixed form (`skill:foo`)
 * and the bare form (`foo`), so typing `/fr` can still prefix-match
 * `skill:frontend-design` without forcing the user to type `skill:`.
 */
export function filterSlashCommands(
  commands: SlashCommand[],
  query: string,
): SlashCommand[] {
  if (query.length === 0) {
    return commands;
  }
  const lower = query.toLowerCase();

  function scoreAgainst(candidate: string): number {
    if (candidate === lower) return 100;
    if (candidate.startsWith(lower)) return 80;
    if (candidate.includes(lower)) return 40;
    return -1;
  }

  const scored = commands
    .map((command) => {
      const name = command.name.toLowerCase();
      let score = scoreAgainst(name);
      if (command.kind === "insert" && name.startsWith("skill:")) {
        // Also try the bare form so `/fr` finds `skill:frontend-design`.
        score = Math.max(score, scoreAgainst(name.slice("skill:".length)));
      }
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
