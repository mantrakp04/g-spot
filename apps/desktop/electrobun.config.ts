import type { ElectrobunConfig } from "electrobun";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import desktopPackage from "./package.json";

const webBuildDir = "../web/dist";
const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const releaseRepository = process.env.GITHUB_REPOSITORY ?? "mantrakp04/g-spot";
const releaseTag = process.env.DESKTOP_RELEASE_TAG ?? "desktop-stable";
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const bunModulesDir = path.join(repoRoot, "node_modules", ".bun");
const sqliteVecPackageDir = readdirSync(bunModulesDir).find((entry) =>
  entry.startsWith("sqlite-vec-darwin-arm64@"),
);
const onnxRuntimePackageDir = readdirSync(bunModulesDir).find((entry) =>
  entry.startsWith("onnxruntime-node@"),
);
const sharpNativePackageDir = readdirSync(bunModulesDir).find((entry) =>
  entry.startsWith("@img+sharp-darwin-arm64@"),
);
const sharpLibvipsPackageDir = readdirSync(bunModulesDir).find((entry) =>
  entry.startsWith("@img+sharp-libvips-darwin-arm64@"),
);
const sqliteVecPath = sqliteVecPackageDir
  ? path.join(
      bunModulesDir,
      sqliteVecPackageDir,
      "node_modules",
      "sqlite-vec-darwin-arm64",
      "vec0.dylib",
    )
  : "";
const onnxRuntimeNativeDir = onnxRuntimePackageDir
  ? path.join(
      bunModulesDir,
      onnxRuntimePackageDir,
      "node_modules",
      "onnxruntime-node",
      "bin",
      "napi-v6",
      "darwin",
      "arm64",
    )
  : "";
const sharpNativeDir = sharpNativePackageDir
  ? path.join(
      bunModulesDir,
      sharpNativePackageDir,
      "node_modules",
      "@img",
      "sharp-darwin-arm64",
    )
  : "";
const sharpLibvipsDir = sharpLibvipsPackageDir
  ? path.join(
      bunModulesDir,
      sharpLibvipsPackageDir,
      "node_modules",
      "@img",
      "sharp-libvips-darwin-arm64",
    )
  : "";
const sqliteVecCopyPath = path.relative(desktopRoot, sqliteVecPath);
const onnxRuntimeNativeCopyPath = path.relative(desktopRoot, onnxRuntimeNativeDir);
const sharpNativeCopyPath = path.relative(desktopRoot, sharpNativeDir);
const sharpLibvipsCopyPath = path.relative(desktopRoot, sharpLibvipsDir);

if (!sqliteVecPath || !existsSync(sqliteVecPath)) {
  throw new Error("Missing sqlite-vec darwin arm64 native extension. Run `bun install`.");
}
if (!onnxRuntimeNativeDir || !existsSync(onnxRuntimeNativeDir)) {
  throw new Error("Missing onnxruntime-node darwin arm64 native files. Run `bun install`.");
}
if (!sharpNativeDir || !existsSync(sharpNativeDir)) {
  throw new Error("Missing sharp darwin arm64 native files. Run `bun install`.");
}
if (!sharpLibvipsDir || !existsSync(sharpLibvipsDir)) {
  throw new Error("Missing sharp libvips darwin arm64 native files. Run `bun install`.");
}

export default {
  app: {
    name: "g-spot",
    identifier: "dev.bettertstack.g-spot.desktop",
    version: desktopPackage.version,
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    copy: {
      [webBuildDir]: "views/mainview",
      "../../packages/db/src/migrations": "bun/migrations",
      [onnxRuntimeNativeCopyPath]: "bin/napi-v6/darwin/arm64",
      [sharpNativeCopyPath]: "bun/node_modules/@img/sharp-darwin-arm64",
      [sharpLibvipsCopyPath]: "bun/node_modules/@img/sharp-libvips-darwin-arm64",
      [sqliteVecCopyPath]: "native/sqlite-vec/vec0.dylib",
    },
    watchIgnore: [`${webBuildDir}/**`],
    mac: {
      bundleCEF: false,
      defaultRenderer: "native",
      icons: "icon.iconset",
    },
    linux: {
      bundleCEF: true,
      defaultRenderer: "cef",
      icon: "../web/public/logo.png",
    },
    win: {
      bundleCEF: true,
      defaultRenderer: "cef",
      icon: "../web/public/logo.png",
    },
  },
  release: {
    baseUrl: `https://github.com/${releaseRepository}/releases/download/${releaseTag}`,
  },
} satisfies ElectrobunConfig;
