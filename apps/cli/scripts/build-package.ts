import { existsSync, readdirSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = path.resolve(cliRoot, "../..");
const distDir = path.join(cliRoot, "dist");
const bunModulesDir = path.join(repoRoot, "node_modules", ".bun");
const nodePlatform = process.platform;
const nodeArch = process.arch;
const sqliteVecPlatform = nodePlatform === "win32" ? "windows" : nodePlatform;
const sqliteVecExt =
  nodePlatform === "darwin" ? "dylib" : nodePlatform === "win32" ? "dll" : "so";
const sharpSuffix = `${nodePlatform}-${nodeArch}`;
const sqliteVecSuffix = `${sqliteVecPlatform}-${nodeArch}`;

function findPackageDir(prefix: string): string {
  const packageDir = readdirSync(bunModulesDir).find((entry) => entry.startsWith(prefix));
  if (!packageDir) throw new Error(`Missing package matching ${prefix}. Run \`bun install\`.`);
  return path.join(bunModulesDir, packageDir, "node_modules");
}

async function copyExisting(source: string, destination: string): Promise<void> {
  if (!existsSync(source)) {
    throw new Error(`Missing package asset at ${source}. Run \`bun install\`.`);
  }
  await cp(source, destination, { recursive: true });
}

async function run(command: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const proc = Bun.spawn(command, {
    cwd: repoRoot,
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`${command.join(" ")} exited with ${code}`);
  }
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await run(["bun", "run", "--filter", "web", "build"], {
  ...process.env,
  VITE_SERVER_URL: "/",
});
await run(["bun", "run", "--filter", "server", "build"]);
await mkdir(path.join(distDir, "server"), { recursive: true });
await run([
  "bun",
  "build",
  path.join(repoRoot, "apps/server/src/index.ts"),
  "--target=bun",
  "--format=esm",
  "--outfile",
  path.join(distDir, "server/index.mjs"),
]);
await run([
  "bun",
  "build",
  path.join(cliRoot, "src/index.ts"),
  "--target=bun",
  "--format=esm",
  "--outfile",
  path.join(distDir, "index.js"),
]);

await cp(path.join(repoRoot, "apps/web/dist"), path.join(distDir, "web"), {
  recursive: true,
});
await cp(
  path.join(repoRoot, "packages/db/src/migrations"),
  path.join(distDir, "migrations"),
  { recursive: true },
);
await cp(
  path.join(repoRoot, "packages/db/src/migrations"),
  path.join(distDir, "server/migrations"),
  { recursive: true },
);

await copyExisting(
  path.join(
    findPackageDir("onnxruntime-node@"),
    "onnxruntime-node",
    "bin",
    "napi-v6",
    nodePlatform,
    nodeArch,
  ),
  path.join(distDir, "bin", "napi-v6", nodePlatform, nodeArch),
);
await copyExisting(
  path.join(
    findPackageDir(`sqlite-vec-${sqliteVecSuffix}@`),
    `sqlite-vec-${sqliteVecSuffix}`,
    `vec0.${sqliteVecExt}`,
  ),
  path.join(distDir, "native", "sqlite-vec", `vec0.${sqliteVecExt}`),
);
await copyExisting(
  path.join(findPackageDir(`@img+sharp-${sharpSuffix}@`), "@img", `sharp-${sharpSuffix}`),
  path.join(distDir, "server", "node_modules", "@img", `sharp-${sharpSuffix}`),
);
await copyExisting(
  path.join(
    findPackageDir(`@img+sharp-libvips-${sharpSuffix}@`),
    "@img",
    `sharp-libvips-${sharpSuffix}`,
  ),
  path.join(distDir, "server", "node_modules", "@img", `sharp-libvips-${sharpSuffix}`),
);

await Bun.write(
  path.join(distDir, "package.json"),
  `${JSON.stringify({ type: "module", bin: { "g-spot": "./index.js" } }, null, 2)}\n`,
);
