#!/usr/bin/env bun
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { z } from "zod";

type CliOptionDefinition = {
  aliases: readonly string[];
  description: string;
  valueLabel?: string;
};

const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 3000;
const optionDefinitions: Record<string, CliOptionDefinition> = {
  port: {
    aliases: ["-p", "--port"],
    description: `Server port. Defaults to ${DEFAULT_PORT}.`,
    valueLabel: "port",
  },
  host: {
    aliases: ["-h", "--host"],
    description: `Server host. Defaults to ${DEFAULT_HOST}.`,
    valueLabel: "host",
  },
  kill: {
    aliases: ["--kill"],
    description: "Kill the process listening on the selected port.",
  },
  help: {
    aliases: ["--help", "-h"],
    description: "Show this help.",
  },
};

const cliArgsSchema = z.object({
  host: z.string().min(1).default(DEFAULT_HOST),
  kill: z.boolean().default(false),
  port: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),
});

type CliOptions = z.infer<typeof cliArgsSchema>;

function usage(): string {
  const optionLines = Object.values(optionDefinitions).map((option) => {
    const names = option.aliases
      .map((alias) => (option.valueLabel ? `${alias} <${option.valueLabel}>` : alias))
      .join(", ");
    return `  ${names.padEnd(26)}${option.description}`;
  });

  return [
    "Usage: g-spot [--port <port> | -p <port>] [--host <host> | -h <host>] [--kill]",
    "",
    "Options:",
    ...optionLines,
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const rawOptions: Record<string, unknown> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    const optionEntry = Object.entries(optionDefinitions).find(([, option]) =>
      option.aliases.includes(arg),
    );
    if (!optionEntry) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const [name, definition] = optionEntry;
    if (name === "help") {
      console.log(usage());
      process.exit(0);
    }

    if (!definition.valueLabel) {
      rawOptions[name] = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("-")) {
      throw new Error(`${arg} requires a ${definition.valueLabel}`);
    }
    rawOptions[name] = value;
    index += 1;
  }

  return cliArgsSchema.parse(rawOptions);
}

function resolveDataDir(): string {
  switch (process.platform) {
    case "darwin":
      return path.join(homedir(), "Library", "Application Support", "dev.bettertstack.g-spot.cli");
    case "win32":
      return path.join(
        process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"),
        "dev.bettertstack.g-spot.cli",
      );
    default:
      return path.join(
        process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share"),
        "dev.bettertstack.g-spot.cli",
      );
  }
}

function runtimeDir(): string {
  return path.resolve(fileURLToPath(new URL(".", import.meta.url)));
}

function bundledPath(relativePath: string): string | null {
  const candidate = path.join(runtimeDir(), relativePath);
  return existsSync(candidate) ? candidate : null;
}

function openUrl(url: string): void {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];

  Bun.spawn(command, {
    stdout: "ignore",
    stderr: "ignore",
  });
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return;
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(100);
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Server did not become ready: ${message}`);
}

async function runMigrations(): Promise<void> {
  const { runMigrations: migrate } = await import("@g-spot/db/migrate");
  migrate({
    log(message) {
      console.log(`[cli:migrate] ${message}`);
    },
  });
}

async function pidsForPort(port: number): Promise<number[]> {
  const proc = Bun.spawn(["lsof", "-ti", `tcp:${port}`], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return output
    .split(/\s+/)
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

async function killPort(port: number): Promise<void> {
  const pids = await pidsForPort(port);
  if (pids.length === 0) {
    console.log(`No process is listening on port ${port}.`);
    return;
  }

  for (const pid of pids) {
    process.kill(pid, "SIGTERM");
  }

  await Bun.sleep(500);
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      process.kill(pid, "SIGKILL");
    } catch {
    }
  }

  console.log(`Killed ${pids.length} process${pids.length === 1 ? "" : "es"} on port ${port}.`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.kill) {
    await killPort(options.port);
    return;
  }

  const webDir = bundledPath("web") ?? path.resolve(runtimeDir(), "../../web/dist");
  const serverEntry =
    bundledPath("server/index.mjs") ?? path.resolve(runtimeDir(), "../../server/dist/index.mjs");
  if (!existsSync(path.join(webDir, "index.html"))) {
    throw new Error("Bundled web build is missing. Run `bun run --filter cli build` first.");
  }
  if (!existsSync(serverEntry)) {
    throw new Error("Bundled server build is missing. Run `bun run --filter cli build` first.");
  }

  const dataDir = resolveDataDir();
  mkdirSync(dataDir, { recursive: true });

  process.env.NODE_ENV = "production";
  process.env.DEMO_MODE = "false";
  process.env.SERVER_HOST = options.host;
  process.env.SERVER_PORT = String(options.port);
  process.env.G_SPOT_WEB_DIST_DIR = webDir;
  process.env.DATABASE_URL ??= `file:${path.join(dataDir, "local.db")}`;
  process.env.CHAT_STATE_SQLITE_PATH ??= path.join(dataDir, "chat-state.db");

  await runMigrations();
  await import(serverEntry);

  const url = `http://${options.host}:${options.port}`;
  await waitForServer(url);
  console.log(`g-spot running at ${url}`);
  openUrl(url);
}

main().catch((error) => {
  if (error instanceof z.ZodError) {
    console.error(error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"));
    process.exit(1);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
