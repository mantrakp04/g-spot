#!/usr/bin/env bun
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [command = "verify-download", ...args] = process.argv.slice(2);
const scriptDir = dirname(fileURLToPath(import.meta.url));

const run = (cmd, cmdArgs, options = {}) => {
  const result = spawnSync(cmd, cmdArgs, {
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
    env: options.env ?? process.env,
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(output || `${cmd} ${cmdArgs.join(" ")} failed`);
  }

  return result;
};

const scrubMacMetadata = (target) => {
  if (!existsSync(target)) return;
  const resolvedTarget = realpathSync(target);

  for (const [cmd, cmdArgs] of [
    ["/bin/chflags", ["nohidden", resolvedTarget]],
    ["/usr/bin/xattr", ["-c", resolvedTarget]],
    ["/usr/bin/xattr", ["-d", "com.apple.FinderInfo", resolvedTarget]],
    ["/usr/bin/xattr", ["-d", "com.apple.fileprovider.fpfs#P", resolvedTarget]],
    ["/usr/bin/xattr", ["-d", "com.apple.metadata:kMDItemWhereFroms", resolvedTarget]],
    ["/usr/bin/xattr", ["-d", "com.apple.provenance", resolvedTarget]],
    ["/usr/bin/xattr", ["-d", "com.apple.quarantine", resolvedTarget]],
  ]) {
    spawnSync(cmd, cmdArgs, { stdio: "ignore" });
  }
};

const findBundle = (target) => {
  let current = dirname(target);
  while (current && current !== "/") {
    scrubMacMetadata(current);
    if (current.endsWith(".app")) return current;
    current = dirname(current);
  }
  return "";
};

const scrubCodesignTarget = (target) => {
  if (!existsSync(target)) return;
  scrubMacMetadata(target);

  const bundle = findBundle(target);
  if (!bundle) return;
  spawnSync("/usr/bin/xattr", ["-cr", bundle], { stdio: "ignore" });
  scrubMacMetadata(bundle);

  const result = spawnSync("/usr/bin/find", [bundle, "-print0"], {
    encoding: "buffer",
  });
  if (result.status !== 0 || !result.stdout) return;

  for (const entry of result.stdout.toString("utf8").split("\0")) {
    if (entry) scrubMacMetadata(entry);
  }
};

const build = () => {
  const env = { ...process.env };
  if (process.platform === "darwin") {
    env.PATH = `${join(scriptDir, "mac-release-bin")}:${env.PATH ?? ""}`;
  }
  run("bunx", ["electrobun", "build", ...args], { env });
};

const codesign = () => {
  const target = args.at(-1);
  if (target) scrubCodesignTarget(target);
  run("/usr/bin/codesign", args);
};

const failDownloadCheck = (message) => {
  console.error(message);
  process.exit(1);
};

const verifyDownload = () => {
  const required = process.env.REQUIRE_MAC_DOWNLOAD_CHECKS === "true";
  const macTarget =
    process.env.ELECTROBUN_OS === "macos" || process.platform === "darwin";

  if (!required || !macTarget) return;

  if (process.platform !== "darwin") {
    failDownloadCheck("Mac download checks must run on a Mac runner.");
  }
  const notarized = process.env.ELECTROBUN_NOTARIZE === "true";

  const artifactDir = process.env.ELECTROBUN_ARTIFACT_DIR;
  if (!artifactDir || !existsSync(artifactDir)) {
    failDownloadCheck("Could not find the desktop release artifacts.");
  }

  const dmgPath = readdirSync(artifactDir)
    .filter((entry) => entry.endsWith(".dmg"))
    .map((entry) => join(artifactDir, entry))[0];
  if (!dmgPath) failDownloadCheck(`No Mac installer found in ${artifactDir}.`);

  const mountDir = mkdtempSync(join(tmpdir(), "g-spot-dmg-"));

  try {
    run("hdiutil", ["verify", dmgPath]);
    run("hdiutil", [
      "attach",
      "-nobrowse",
      "-readonly",
      "-mountpoint",
      mountDir,
      dmgPath,
    ]);

    const appPath = readdirSync(mountDir)
      .filter((entry) => entry.endsWith(".app"))
      .map((entry) => join(mountDir, entry))[0];
    if (!appPath) failDownloadCheck(`No Mac app was found inside ${dmgPath}.`);

    run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
    if (notarized) {
      run("spctl", ["-a", "-vv", "-t", "exec", appPath]);
      run("spctl", ["-a", "-vv", "-t", "open", dmgPath]);
    } else {
      console.warn(
        "Mac artifact is ad-hoc signed but not notarized. Users may need to allow it in Privacy & Security.",
      );
    }
  } finally {
    spawnSync("hdiutil", ["detach", mountDir], { stdio: "ignore" });
    rmSync(mountDir, { recursive: true, force: true });
  }
};

switch (command) {
  case "build":
    build();
    break;
  case "codesign":
    codesign();
    break;
  case "verify-download":
    verifyDownload();
    break;
  default:
    console.error("Usage: mac-release.js {build|codesign|verify-download}");
    process.exit(2);
}
