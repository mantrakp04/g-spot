/**
 * Integration with the public Agent Skills directory at https://skills.sh.
 *
 * The CLI (`vercel-labs/skills`) exposes one relevant HTTP endpoint for us:
 *
 *   GET https://skills.sh/api/search?q=<query>&limit=<n>
 *   → { skills: Array<{ id, skillId, name, installs, source }> }
 *
 * `source` is always `owner/repo` and `id` is `owner/repo/<slug>`. There is
 * no `list-all` endpoint; everything is driven by search. The minimum query
 * length enforced by the remote API is 2 characters.
 *
 * Installing a catalog entry means:
 *   1. Walk the target repo's git tree via GitHub's REST API.
 *   2. Find the `SKILL.md` whose parent directory matches the skill slug.
 *   3. Fetch the raw `SKILL.md`, split off the YAML frontmatter.
 *   4. Pull `name` + `description` out of the frontmatter and the rest of
 *      the file becomes `content`.
 *
 * Everything here is best-effort and hits public endpoints only — unauth'd
 * GitHub requests have a fairly low rate limit, which is fine for the
 * occasional interactive install from the explorer.
 */

const SEARCH_API_BASE =
  process.env.SKILLS_API_URL?.replace(/\/$/, "") ?? "https://skills.sh";

export interface CatalogSearchResult {
  /** `owner/repo/<slug>` — canonical id from skills.sh */
  id: string;
  /** The bare skill slug (directory name). */
  skillId: string;
  /** Display name as stored in skills.sh (usually same as slug). */
  name: string;
  /** `owner/repo` */
  source: string;
  /** Cumulative install count reported by skills.sh, for ranking. */
  installs: number;
}

export class SkillCatalogError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "SEARCH_FAILED"
      | "SOURCE_INVALID"
      | "SOURCE_NOT_FOUND"
      | "SKILL_NOT_FOUND"
      | "FRONTMATTER_INVALID"
      | "FETCH_FAILED",
  ) {
    super(message);
    this.name = "SkillCatalogError";
  }
}

/**
 * Proxy a search against skills.sh so the web client doesn't need to call
 * the third party directly (keeps CORS, UA and rate-limit handling on our
 * side). Query must already be validated to be >=2 chars by the caller.
 */
export async function searchCatalog(
  query: string,
  limit: number,
): Promise<CatalogSearchResult[]> {
  const url = `${SEARCH_API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": "g-spot-skill-explorer/1.0 (+https://skills.sh)" },
    });
  } catch (err) {
    throw new SkillCatalogError(
      err instanceof Error ? err.message : "Search request failed",
      "SEARCH_FAILED",
    );
  }

  if (!res.ok) {
    throw new SkillCatalogError(
      `skills.sh search returned ${res.status}`,
      "SEARCH_FAILED",
    );
  }

  const data = (await res.json()) as {
    skills?: Array<{
      id?: string;
      skillId?: string;
      name?: string;
      source?: string;
      installs?: number;
    }>;
  };

  return (data.skills ?? [])
    .filter(
      (s): s is Required<Pick<CatalogSearchResult, "id" | "name">> & {
        skillId?: string;
        source?: string;
        installs?: number;
      } => typeof s.id === "string" && typeof s.name === "string",
    )
    .map((s) => ({
      id: s.id,
      skillId: s.skillId ?? s.name,
      name: s.name,
      source: s.source ?? "",
      installs: typeof s.installs === "number" ? s.installs : 0,
    }));
}

interface OwnerRepo {
  owner: string;
  repo: string;
}

function parseOwnerRepo(source: string): OwnerRepo | null {
  // Accept `owner/repo` — skills.sh always hands us this shape, but we
  // strip any trailing subpath defensively.
  const match = source.trim().match(/^([^/\s]+)\/([^/\s]+)/);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]! };
}

interface GitHubTreeEntry {
  path?: string;
  type?: string;
}

/**
 * Walk the default branch's git tree and return every SKILL.md path (sorted
 * by depth, shallowest first). The caller decides how to match a slug
 * against this list — directory name first, then frontmatter `name` as a
 * fallback for repos where skills.sh's slug doesn't match the directory.
 */
async function listSkillMdPaths(
  owner: string,
  repo: string,
): Promise<string[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "user-agent": "g-spot-skill-explorer/1.0",
        accept: "application/vnd.github+json",
      },
    });
  } catch (err) {
    throw new SkillCatalogError(
      err instanceof Error ? err.message : "GitHub tree request failed",
      "FETCH_FAILED",
    );
  }

  if (res.status === 404) {
    throw new SkillCatalogError(
      `Repository ${owner}/${repo} not found or is private`,
      "SOURCE_NOT_FOUND",
    );
  }
  if (!res.ok) {
    throw new SkillCatalogError(
      `GitHub returned ${res.status} for ${owner}/${repo}`,
      "FETCH_FAILED",
    );
  }

  const data = (await res.json()) as { tree?: GitHubTreeEntry[] };
  const entries = data.tree ?? [];

  return entries
    .filter(
      (e): e is { path: string; type: string } =>
        e.type === "blob" &&
        typeof e.path === "string" &&
        e.path.endsWith("SKILL.md"),
    )
    .map((e) => e.path)
    .sort((a, b) => a.split("/").length - b.split("/").length);
}

/**
 * Try to find a SKILL.md matching `skillSlug` by directory name. Prefers the
 * shallowest match so `skills/foo/SKILL.md` wins over `archive/skills/foo/
 * SKILL.md`. Returns null if no directory-name match exists, in which case
 * the caller should fall back to frontmatter matching.
 */
function pickByDirectoryName(
  paths: string[],
  skillSlug: string,
): string | null {
  const suffix = `/${skillSlug}/SKILL.md`;
  for (const path of paths) {
    if (path === `${skillSlug}/SKILL.md` || path.endsWith(suffix)) {
      return path;
    }
  }
  return null;
}

async function fetchRawFile(
  owner: string,
  repo: string,
  path: string,
): Promise<string> {
  // raw.githubusercontent.com resolves HEAD to the default branch and
  // streams the file contents with no API rate limit surprises.
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": "g-spot-skill-explorer/1.0" },
    });
  } catch (err) {
    throw new SkillCatalogError(
      err instanceof Error ? err.message : "Raw file request failed",
      "FETCH_FAILED",
    );
  }
  if (!res.ok) {
    throw new SkillCatalogError(
      `GitHub raw returned ${res.status} for ${path}`,
      "FETCH_FAILED",
    );
  }
  return res.text();
}

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const inner = trimmed.slice(1, -1);
      // Unescape the common escapes for double quotes. Single-quoted YAML
      // only needs '' → ' handling.
      if (first === '"') {
        return inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
      return inner.replace(/''/g, "'");
    }
  }
  return trimmed;
}

interface ParsedSkillMarkdown {
  name: string | null;
  description: string | null;
  content: string;
}

/**
 * Minimal frontmatter extractor. Skills spec frontmatter is simple key/value
 * YAML — we only care about `name` and `description`. Pulling in a YAML
 * dependency just to read two strings is overkill, and the vercel/skills CLI
 * itself handles frontmatter through its own thin wrapper.
 *
 * If the frontmatter is missing or malformed we return the whole body as
 * content with null metadata, letting the caller fall back to the search
 * result's name.
 */
function parseSkillMarkdown(raw: string): ParsedSkillMarkdown {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { name: null, description: null, content: raw.trim() };
  }
  const frontmatter = match[1] ?? "";
  const body = match[2] ?? "";

  let name: string | null = null;
  let description: string | null = null;

  // Walk lines at indent=0 only; nested keys (e.g. metadata.internal) are
  // ignored for now — we don't use them.
  const lines = frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line || /^\s/.test(line)) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Support YAML folded (`>`) and literal (`|`) block scalars — skills.sh
    // descriptions occasionally use them.
    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      const collected: string[] = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1]!;
        if (!/^\s+/.test(next) && next !== "") break;
        collected.push(next.replace(/^\s+/, ""));
        i++;
      }
      value = collected.join(value.startsWith(">") ? " " : "\n").trim();
    } else {
      value = stripYamlQuotes(value);
    }

    if (key === "name" && !name) name = value;
    else if (key === "description" && !description) description = value;
  }

  return { name, description, content: body.trim() };
}

export interface FetchedSkill {
  /** Slug from the SKILL.md frontmatter (falls back to catalog name). */
  name: string;
  /** Human-readable description from the frontmatter. */
  description: string;
  /** Markdown body (frontmatter stripped). */
  content: string;
  /** GitHub path the SKILL.md was loaded from, for traceability. */
  sourcePath: string;
}

/**
 * Cap on how many SKILL.md files we'll fetch in parallel during the
 * frontmatter fallback. A monorepo of skills is usually tens of files, not
 * thousands, but we clamp to stay polite on raw.githubusercontent.com and
 * avoid runaway bandwidth if someone points us at a huge repo.
 */
const FRONTMATTER_SCAN_LIMIT = 40;

/**
 * Fetches a SKILL.md from a GitHub `owner/repo` by slug and normalises it
 * into the shape the DB layer expects. The caller decides how to handle
 * the returned name — for instance, the router may need to slugify it or
 * append a suffix on conflict.
 *
 * Resolution strategy:
 *   1. Walk the repo tree once to collect every SKILL.md path.
 *   2. Try matching the slug against the terminal directory name — works
 *      for most repos where the directory and skill name align.
 *   3. If that fails, fetch up to FRONTMATTER_SCAN_LIMIT candidates in
 *      parallel and match against the `name:` field in the YAML
 *      frontmatter. This is the case for repos like
 *      `vercel-labs/agent-skills`, where the skill is filed under
 *      `skills/react-best-practices/SKILL.md` but its frontmatter name is
 *      `vercel-react-best-practices` — which is what skills.sh returns.
 */
export async function fetchSkillFromSource(
  source: string,
  skillSlug: string,
): Promise<FetchedSkill> {
  const parsed = parseOwnerRepo(source);
  if (!parsed) {
    throw new SkillCatalogError(
      `Invalid source "${source}" — expected owner/repo`,
      "SOURCE_INVALID",
    );
  }
  const { owner, repo } = parsed;
  const allPaths = await listSkillMdPaths(owner, repo);

  if (allPaths.length === 0) {
    throw new SkillCatalogError(
      `No SKILL.md files found in ${owner}/${repo}`,
      "SKILL_NOT_FOUND",
    );
  }

  // Fast path: directory name matches the slug. We still fetch and parse
  // the file so we can populate description and content.
  const dirMatch = pickByDirectoryName(allPaths, skillSlug);
  if (dirMatch) {
    const raw = await fetchRawFile(owner, repo, dirMatch);
    const md = parseSkillMarkdown(raw);
    // If the frontmatter `name` disagrees with the directory, trust the
    // frontmatter — it's what skills.sh uses.
    return buildFetchedSkill(md, dirMatch, source, skillSlug);
  }

  // Fallback: scan frontmatters. Sort by depth so shallow candidates are
  // checked first and limit the fan-out.
  const candidates = allPaths.slice(0, FRONTMATTER_SCAN_LIMIT);
  const fetched = await Promise.all(
    candidates.map(async (path) => {
      try {
        const raw = await fetchRawFile(owner, repo, path);
        return { path, md: parseSkillMarkdown(raw) } as const;
      } catch {
        return null;
      }
    }),
  );

  const target = skillSlug.toLowerCase();
  const match = fetched.find(
    (entry) => entry && entry.md.name?.trim().toLowerCase() === target,
  );

  if (!match) {
    throw new SkillCatalogError(
      `No SKILL.md found for "${skillSlug}" in ${owner}/${repo}`,
      "SKILL_NOT_FOUND",
    );
  }

  return buildFetchedSkill(match.md, match.path, source, skillSlug);
}

function buildFetchedSkill(
  md: ParsedSkillMarkdown,
  path: string,
  source: string,
  skillSlug: string,
): FetchedSkill {
  const name = md.name?.trim() || skillSlug;
  const description =
    md.description?.trim() ||
    `Imported from ${source} (${skillSlug}). Edit this description.`;

  if (!name) {
    throw new SkillCatalogError(
      "SKILL.md has no name and no fallback slug",
      "FRONTMATTER_INVALID",
    );
  }

  return {
    name,
    description,
    content: md.content,
    sourcePath: path,
  };
}
