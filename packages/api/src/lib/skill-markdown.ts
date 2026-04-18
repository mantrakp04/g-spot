export type ParsedSkillMarkdown = {
  name: string | null;
  description: string | null;
  content: string;
  disableModelInvocation: boolean;
  triggerKeywords: string[];
};

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const inner = trimmed.slice(1, -1);
      if (first === '"') {
        return inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
      return inner.replace(/''/g, "'");
    }
  }
  return trimmed;
}

function parseTriggerKeywords(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((entry): entry is string => typeof entry === "string");
      }
    } catch {
    }
  }

  return trimmed
    .split(",")
    .map((entry) => stripYamlQuotes(entry))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseSkillMarkdown(raw: string): ParsedSkillMarkdown {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return {
      name: null,
      description: null,
      content: raw.trim(),
      disableModelInvocation: false,
      triggerKeywords: [],
    };
  }

  const frontmatter = match[1] ?? "";
  const body = match[2] ?? "";

  let name: string | null = null;
  let description: string | null = null;
  let disableModelInvocation = false;
  let triggerKeywords: string[] = [];

  const lines = frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line || /^\s/.test(line)) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      const collected: string[] = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1]!;
        if (!/^\s+/.test(next) && next !== "") break;
        collected.push(next.replace(/^\s+/, ""));
        i++;
      }
      value = collected.join(value.startsWith(">") ? " " : "\n").trim();
    } else if (value === "" && key === "trigger-keywords") {
      const collected: string[] = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1]!;
        if (!/^\s*-\s+/.test(next)) break;
        collected.push(next.replace(/^\s*-\s+/, ""));
        i++;
      }
      value = JSON.stringify(collected.map((entry) => stripYamlQuotes(entry)));
    } else {
      value = stripYamlQuotes(value);
    }

    if (key === "name" && !name) {
      name = value;
      continue;
    }
    if (key === "description" && !description) {
      description = value;
      continue;
    }
    if (key === "disable-model-invocation") {
      disableModelInvocation = value === "true";
      continue;
    }
    if (key === "trigger-keywords") {
      triggerKeywords = parseTriggerKeywords(value);
    }
  }

  return {
    name,
    description,
    content: body.trim(),
    disableModelInvocation,
    triggerKeywords,
  };
}

export function buildSkillMarkdown(input: {
  name: string;
  description: string;
  content: string;
  triggerKeywords: string[];
  disableModelInvocation: boolean;
}) {
  const lines = [
    "---",
    `name: ${JSON.stringify(input.name)}`,
    `description: ${JSON.stringify(input.description)}`,
  ];

  if (input.triggerKeywords.length > 0) {
    lines.push(`trigger-keywords: ${JSON.stringify(input.triggerKeywords)}`);
  }

  if (input.disableModelInvocation) {
    lines.push("disable-model-invocation: true");
  }

  lines.push("---", "");
  return lines.join("\n") + input.content;
}
