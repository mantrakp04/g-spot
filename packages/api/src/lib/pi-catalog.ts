/**
 * Browse the pi.dev package directory. pi.dev itself is a static HTML page
 * that fetches from the npm registry using the `pi-package` keyword and then
 * reads each package's manifest for the canonical type declarations (see
 * https://pi.dev/packages — the client script calls both
 * `registry.npmjs.org/-/v1/search?text=keywords:pi-package` and
 * `registry.npmjs.org/<name>/latest`).
 *
 * We proxy both from the server: the search gives us the ranked list, and
 * the manifest's `pi.extensions|skills|themes|prompts` arrays are how we
 * actually know what type a package is. Keyword-based detection is only a
 * fallback for manifests that don't declare the `pi` field explicitly.
 */
const NPM_SEARCH_URL = "https://registry.npmjs.org/-/v1/search";
const NPM_MANIFEST_URL = "https://registry.npmjs.org/";
const PI_KEYWORD_QUERY = "keywords:pi-package";

const UA = "g-spot-pi-explorer/1.0 (+https://pi.dev)";

export type PiCatalogType = "extension" | "skill" | "theme" | "prompt";

const TYPE_SYNONYMS: Record<PiCatalogType, string[]> = {
  extension: ["extension", "pi-extension", "extensions"],
  skill: ["skill", "pi-skill", "skills"],
  theme: ["theme", "pi-theme", "themes"],
  prompt: ["prompt", "pi-prompt", "prompts"],
};

export interface PiCatalogPackage {
  /** npm package name, used both as id and install source. */
  name: string;
  version: string;
  description: string;
  author: string;
  keywords: string[];
  types: PiCatalogType[];
  monthlyDownloads: number;
  /** ISO timestamp of last publish — exposed for the "recent" sort. */
  publishedAt: string;
  /** `https://www.npmjs.com/package/<name>` — present for anything from npm. */
  npmUrl?: string;
  /** Best-effort homepage/repo URL for the "view on web" link. */
  homepageUrl?: string;
}

export class PiCatalogError extends Error {
  constructor(
    message: string,
    public readonly code: "SEARCH_FAILED" | "FETCH_FAILED",
  ) {
    super(message);
    this.name = "PiCatalogError";
  }
}

interface NpmSearchObject {
  package?: {
    name?: string;
    version?: string;
    description?: string;
    keywords?: string[];
    date?: string;
    publisher?: { username?: string; email?: string };
    links?: { homepage?: string; repository?: string; npm?: string };
  };
  downloads?: { monthly?: number; weekly?: number };
}

interface NpmManifest {
  keywords?: string[];
  pi?: {
    extensions?: unknown[];
    skills?: unknown[];
    themes?: unknown[];
    prompts?: unknown[];
  };
}

function typesFromKeywords(keywords: string[]): PiCatalogType[] {
  const set = new Set(keywords.map((k) => k.toLowerCase()));
  const result: PiCatalogType[] = [];
  for (const [type, aliases] of Object.entries(TYPE_SYNONYMS) as [
    PiCatalogType,
    string[],
  ][]) {
    if (aliases.some((alias) => set.has(alias))) {
      result.push(type);
    }
  }
  return result;
}

/**
 * Read the `pi` field from a package manifest — the canonical place where
 * package authors declare which resource kinds they ship. We treat any
 * non-empty array as a present type, matching pi.dev's own `typesFromManifest`.
 */
function typesFromManifest(manifest: NpmManifest): PiCatalogType[] {
  const pi = manifest.pi;
  if (!pi) return [];
  const result: PiCatalogType[] = [];
  if (Array.isArray(pi.extensions) && pi.extensions.length > 0)
    result.push("extension");
  if (Array.isArray(pi.skills) && pi.skills.length > 0) result.push("skill");
  if (Array.isArray(pi.themes) && pi.themes.length > 0) result.push("theme");
  if (Array.isArray(pi.prompts) && pi.prompts.length > 0)
    result.push("prompt");
  return result;
}

/**
 * Short-lived in-memory cache so a burst of explorer searches doesn't
 * re-fetch the same manifests. The npm registry is fine with these rates,
 * but doing 36 fetches on every keystroke-driven search is wasteful.
 */
const MANIFEST_CACHE_TTL = 10 * 60 * 1000;
const manifestCache = new Map<
  string,
  { at: number; types: PiCatalogType[] }
>();

async function fetchManifestTypes(name: string): Promise<PiCatalogType[]> {
  const cached = manifestCache.get(name);
  if (cached && Date.now() - cached.at < MANIFEST_CACHE_TTL) {
    return cached.types;
  }

  const url = `${NPM_MANIFEST_URL}${encodeURIComponent(name)}/latest`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": UA } });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  let data: NpmManifest;
  try {
    data = (await res.json()) as NpmManifest;
  } catch {
    return [];
  }

  const types = typesFromManifest(data);
  manifestCache.set(name, { at: Date.now(), types });
  return types;
}

function normalize(obj: NpmSearchObject): PiCatalogPackage | null {
  const pkg = obj.package;
  if (!pkg?.name) return null;
  return {
    name: pkg.name,
    version: pkg.version ?? "",
    description: pkg.description ?? "",
    author: pkg.publisher?.username ?? "",
    keywords: pkg.keywords ?? [],
    types: typesFromKeywords(pkg.keywords ?? []),
    monthlyDownloads: obj.downloads?.monthly ?? 0,
    publishedAt: pkg.date ?? "",
    npmUrl: pkg.links?.npm,
    homepageUrl: pkg.links?.homepage ?? pkg.links?.repository,
  };
}

async function searchRegistry(
  text: string,
  size: number,
): Promise<PiCatalogPackage[]> {
  const url = `${NPM_SEARCH_URL}?text=${encodeURIComponent(text)}&size=${encodeURIComponent(
    String(size),
  )}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": UA } });
  } catch (err) {
    throw new PiCatalogError(
      err instanceof Error ? err.message : "npm registry request failed",
      "FETCH_FAILED",
    );
  }
  if (!res.ok) {
    throw new PiCatalogError(
      `npm registry returned ${res.status}`,
      "SEARCH_FAILED",
    );
  }

  const data = (await res.json()) as { objects?: NpmSearchObject[] };
  return (data.objects ?? [])
    .map(normalize)
    .filter((p): p is PiCatalogPackage => p !== null);
}

async function enrichTypesFromManifests(
  packages: PiCatalogPackage[],
): Promise<PiCatalogPackage[]> {
  // Fan out all manifest fetches in parallel. The registry handles bursts of
  // a few dozen gracefully, and any that fail just fall back to the
  // keyword-derived types we already set on the package.
  const manifestTypes = await Promise.all(
    packages.map((pkg) => fetchManifestTypes(pkg.name)),
  );
  return packages.map((pkg, i) => {
    const fromManifest = manifestTypes[i] ?? [];
    // Manifest declarations take precedence when present — pi.dev does the
    // same. When the manifest says nothing, keep the keyword signal.
    const types = fromManifest.length > 0 ? fromManifest : pkg.types;
    return { ...pkg, types };
  });
}

export async function listPopularPiCatalog(
  limit: number,
): Promise<PiCatalogPackage[]> {
  const raw = await searchRegistry(PI_KEYWORD_QUERY, Math.max(limit, 25));
  const sorted = raw
    .sort((a, b) => b.monthlyDownloads - a.monthlyDownloads)
    .slice(0, limit);
  return enrichTypesFromManifests(sorted);
}

export async function searchPiCatalog(
  query: string,
  limit: number,
): Promise<PiCatalogPackage[]> {
  // Registry search lets us combine free text with keyword filters via
  // `+` as an AND connector. Wrapping the user text in quotes would
  // disable stemming, so we join as separate terms.
  const text = `${PI_KEYWORD_QUERY} ${query}`.trim();
  const raw = await searchRegistry(text, Math.max(limit, 25));
  // Preserve the registry's relevance ranking for searches. Sorting by
  // downloads here buries exact matches under popular unrelated packages.
  return enrichTypesFromManifests(raw.slice(0, limit));
}
