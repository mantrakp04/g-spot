import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  console.log("Skipping macOS native tabs build on non-darwin platform.");
  process.exit(0);
}

const result = spawnSync(
  "clang",
  [
    "-dynamiclib",
    "-fobjc-arc",
    "-framework",
    "Cocoa",
    "native/window-tabs.m",
    "-o",
    "native/libgspot_window_tabs.dylib",
  ],
  { stdio: "inherit" },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
