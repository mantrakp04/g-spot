/**
 * Map a file path to a Monaco language id. Monaco ships built-in tokenization
 * for these — anything else falls back to plain text.
 */
const EXT_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  mdx: "markdown",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  sql: "sql",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  lua: "lua",
  dart: "dart",
  vue: "html",
  svelte: "html",
  graphql: "graphql",
  gql: "graphql",
  dockerfile: "dockerfile",
  xml: "xml",
  diff: "diff",
  patch: "diff",
};

const FILENAME_MAP: Record<string, string> = {
  Dockerfile: "dockerfile",
  ".gitignore": "ini",
  ".dockerignore": "ini",
  ".env": "ini",
};

export function languageFromPath(filePath: string): string {
  const name = filePath.split("/").pop() ?? filePath;
  if (FILENAME_MAP[name]) return FILENAME_MAP[name]!;
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx === -1) return "plaintext";
  const ext = name.slice(dotIdx + 1).toLowerCase();
  return EXT_MAP[ext] ?? "plaintext";
}
