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
const enableMacSigning = process.env.ELECTROBUN_CODESIGN === "true";

// Map node platform/arch to the suffix conventions each native dep uses.
// sharp + onnxruntime use `win32`; sqlite-vec uses `windows`.
const nodePlatform = process.platform; // "darwin" | "linux" | "win32"
const nodeArch = process.arch; // "arm64" | "x64"
const sqliteVecPlatform =
  nodePlatform === "win32" ? "windows" : nodePlatform;
const sqliteVecExt =
  nodePlatform === "darwin" ? "dylib" : nodePlatform === "win32" ? "dll" : "so";
const sharpSuffix = `${nodePlatform}-${nodeArch}`;
const sqliteVecSuffix = `${sqliteVecPlatform}-${nodeArch}`;

const findPackageDir = (prefix: string): string | undefined =>
  readdirSync(bunModulesDir).find((entry) => entry.startsWith(prefix));

const sqliteVecPackageDir = findPackageDir(`sqlite-vec-${sqliteVecSuffix}@`);
const onnxRuntimePackageDir = findPackageDir("onnxruntime-node@");
const sharpNativePackageDir = findPackageDir(`@img+sharp-${sharpSuffix}@`);
const sharpLibvipsPackageDir = findPackageDir(
  `@img+sharp-libvips-${sharpSuffix}@`,
);

const sqliteVecPath = sqliteVecPackageDir
  ? path.join(
      bunModulesDir,
      sqliteVecPackageDir,
      "node_modules",
      `sqlite-vec-${sqliteVecSuffix}`,
      `vec0.${sqliteVecExt}`,
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
      nodePlatform,
      nodeArch,
    )
  : "";
const sharpNativeDir = sharpNativePackageDir
  ? path.join(
      bunModulesDir,
      sharpNativePackageDir,
      "node_modules",
      "@img",
      `sharp-${sharpSuffix}`,
    )
  : "";
const sharpLibvipsDir = sharpLibvipsPackageDir
  ? path.join(
      bunModulesDir,
      sharpLibvipsPackageDir,
      "node_modules",
      "@img",
      `sharp-libvips-${sharpSuffix}`,
    )
  : "";
const sqliteVecCopyPath = path.relative(desktopRoot, sqliteVecPath);
const onnxRuntimeNativeCopyPath = path.relative(desktopRoot, onnxRuntimeNativeDir);
const sharpNativeCopyPath = path.relative(desktopRoot, sharpNativeDir);
const sharpLibvipsCopyPath = path.relative(desktopRoot, sharpLibvipsDir);

if (!sqliteVecPath || !existsSync(sqliteVecPath)) {
  throw new Error(
    `Missing sqlite-vec ${sqliteVecSuffix} native extension. Run \`bun install\`.`,
  );
}
if (!onnxRuntimeNativeDir || !existsSync(onnxRuntimeNativeDir)) {
  throw new Error(
    `Missing onnxruntime-node ${nodePlatform}/${nodeArch} native files. Run \`bun install\`.`,
  );
}
if (!sharpNativeDir || !existsSync(sharpNativeDir)) {
  throw new Error(
    `Missing sharp ${sharpSuffix} native files. Run \`bun install\`.`,
  );
}
if (!sharpLibvipsDir || !existsSync(sharpLibvipsDir)) {
  throw new Error(
    `Missing sharp libvips ${sharpSuffix} native files. Run \`bun install\`.`,
  );
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
      "package.json": "bun/package.json",
      "../../packages/db/src/migrations": "bun/migrations",
      [onnxRuntimeNativeCopyPath]: `bin/napi-v6/${nodePlatform}/${nodeArch}`,
      [sharpNativeCopyPath]: `bun/node_modules/@img/sharp-${sharpSuffix}`,
      [sharpLibvipsCopyPath]: `bun/node_modules/@img/sharp-libvips-${sharpSuffix}`,
      [sqliteVecCopyPath]: `native/sqlite-vec/vec0.${sqliteVecExt}`,
      "native/libgspot_window_tabs.dylib": "bun/native/libgspot_window_tabs.dylib",
    },
    watchIgnore: [`${webBuildDir}/**`],
    mac: {
      codesign: enableMacSigning,
      notarize: enableMacSigning,
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
