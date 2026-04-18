import path from "node:path";

import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
  type ResolvedResource,
} from "@mariozechner/pi-coding-agent";

export type PiAddonScope = "global" | "project";

export type PiAddonPackageRecord = {
  source: string;
  scope: PiAddonScope;
  filtered: boolean;
  installedPath?: string;
  extensionCount: number;
};

export type PiAddonExtensionRecord = {
  path: string;
  enabled: boolean;
  scope: PiAddonScope;
  source: string;
  origin: "package" | "top-level";
};

export type PiAddonInventory = {
  scope: PiAddonScope;
  directory: string;
  packages: PiAddonPackageRecord[];
  dropInExtensions: PiAddonExtensionRecord[];
};

function getPlaceholderCwd(agentDir: string) {
  return path.join(agentDir, "__gspot_global_scope__");
}

export function createPiAddonServices(projectPath?: string | null) {
  const agentDir = getAgentDir();
  const cwd = projectPath ?? getPlaceholderCwd(agentDir);
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir,
    settingsManager,
  });

  return {
    agentDir,
    cwd,
    settingsManager,
    packageManager,
  };
}

function toScope(
  value: "user" | "project" | "temporary",
): PiAddonScope {
  return value === "project" ? "project" : "global";
}

function countPackageExtensions(
  source: string,
  scope: PiAddonScope,
  resources: ResolvedResource[],
) {
  return resources.filter(
    (resource) =>
      resource.metadata.origin === "package" &&
      resource.metadata.source === source &&
      toScope(resource.metadata.scope) === scope,
  ).length;
}

export async function listPiAddons(projectPath?: string | null): Promise<PiAddonInventory> {
  const scope: PiAddonScope = projectPath ? "project" : "global";
  const { agentDir, cwd, packageManager } = createPiAddonServices(projectPath);
  const resolved = await packageManager.resolve(async () => "skip");
  const packages = packageManager
    .listConfiguredPackages()
    .filter((pkg) => toScope(pkg.scope) === scope)
    .map((pkg) => ({
      source: pkg.source,
      scope,
      filtered: pkg.filtered,
      installedPath: pkg.installedPath,
      extensionCount: countPackageExtensions(pkg.source, scope, resolved.extensions),
    }))
    .sort((a, b) => a.source.localeCompare(b.source));

  const dropInExtensions = resolved.extensions
    .filter(
      (resource) =>
        resource.metadata.origin === "top-level" &&
        toScope(resource.metadata.scope) === scope,
    )
    .map((resource) => ({
      path: resource.path,
      enabled: resource.enabled,
      scope,
      source: resource.metadata.source,
      origin: resource.metadata.origin,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    scope,
    directory: scope === "project" ? path.join(cwd, ".pi", "extensions") : path.join(agentDir, "extensions"),
    packages,
    dropInExtensions,
  };
}

export async function installPiAddon(
  source: string,
  projectPath?: string | null,
) {
  const { settingsManager, packageManager } = createPiAddonServices(projectPath);
  await packageManager.installAndPersist(source, {
    local: Boolean(projectPath),
  });
  await settingsManager.flush();
}

export async function removePiAddon(
  source: string,
  projectPath?: string | null,
) {
  const { settingsManager, packageManager } = createPiAddonServices(projectPath);
  await packageManager.removeAndPersist(source, {
    local: Boolean(projectPath),
  });
  await settingsManager.flush();
}
