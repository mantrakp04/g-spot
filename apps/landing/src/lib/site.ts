export const REPO = "mantrakp04/g-spot";
export const REPO_URL = `https://github.com/${REPO}`;
export const DOWNLOAD_RELEASE_TAG = "desktop-nightly";
export const RELEASES_URL = `${REPO_URL}/releases/tag/${DOWNLOAD_RELEASE_TAG}`;
export const NIGHTLY_URL = `${REPO_URL}/releases/tag/desktop-nightly`;
export const DEMO_URL = import.meta.env.VITE_DEMO_URL ?? "https://demo.g-spot.dev";
export const CLI_PACKAGE_URL = "https://www.npmjs.com/package/g-spot-cli";
export const SOCKET_BADGE_URL = "https://badge.socket.dev/npm/package/g-spot-cli";

export type Feature = {
  title: string;
  body: string;
  /** layout weight — wide blocks span two columns for rhythm */
  wide?: boolean;
};

export const FEATURES: Feature[] = [
  {
    title: "One inbox for mail and code",
    body: "Gmail threads, GitHub PRs, and issues triaged side by side. Sectioned, filterable, reorderable. No two tabs, no context-switch tax.",
    wide: true,
  },
  {
    title: "Agents build your filters",
    body: 'Describe the slice you want, "unread PRs from my team waiting on me", and the agent assembles the rules, account, and columns for you.',
  },
  {
    title: "Review PRs without leaving home",
    body: "Inline comment threads, CI checks, timelines, stack visualization, and a quiet keyboard-driven action bar.",
  },
  {
    title: "Notes that link back",
    body: "CodeMirror markdown with wikilinks, tags, KaTeX, Mermaid, daily notes, embeds, and full-text search. Stored locally, linked everywhere.",
  },
  {
    title: "A memory that actually remembers",
    body: "Local knowledge graph with sqlite-vec embeddings. Chat turns auto-ingested, salience decays over time. The agent recalls last week.",
  },
  {
    title: "Gmail, fully wired",
    body: "Read, compose, drafts, labels, attachments, inline reply in-thread, a floating draft dock, real-time push sync. The whole thing.",
    wide: true,
  },
];

export const STACK: [string, string][] = [
  ["runtime", "bun"],
  ["server", "elysia · tRPC"],
  ["web", "tanstack router · shadcn"],
  ["relay", "gmail pub/sub → websocket"],
  ["data", "drizzle · sqlite · sqlite-vec"],
  ["agent", "pi sdk · approval-gated tool calls · mcp · skills · extensions"],
  ["notes", "codemirror 6 · katex · mermaid · wikilinks"],
  ["desktop", "electrobun"],
  ["cli", "npm package · bundled web + server · bunx g-spot-cli"],
  ["license", "MIT"],
];
