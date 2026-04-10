import type {
  PiAgentConfig,
  PiApprovalPolicy,
  PiNetworkAccess,
  PiSandboxMode,
} from "@g-spot/types";

/**
 * Pi itself has no sandbox/network/approval concept, so g-spot enforces those
 * policies at the `agent.beforeToolCall` hook. This module is the single
 * source of truth for "given this config + this tool call, what should
 * happen?".
 *
 * Three possible outcomes:
 *
 *  - `allow`            — tool runs normally, no approval UI, no block
 *  - `block`            — tool is rejected with `reason` (shown to the model)
 *  - `require-approval` — chat stream must publish a `tool_approval_request`
 *                         event and wait for the user to respond
 */
export type PermissionDecision =
  | { kind: "allow" }
  | { kind: "block"; reason: string }
  | { kind: "require-approval"; reason: string };

/**
 * Tools that write to the filesystem in the user's project. These are
 * governed by `sandboxMode` — `read-only` blocks them outright and
 * `workspace-write` still allows them because the agent's cwd *is* the
 * project path.
 */
const WRITE_TOOLS = new Set(["edit", "write"]);

/**
 * Tools that could do arbitrary things, including reach the network, write
 * files outside the workspace, or delete data. `bash` is the only one in
 * practice, but we keep this as a set to leave room for future mcp / custom
 * tools.
 */
const SHELL_TOOLS = new Set(["bash"]);

/**
 * Cheap heuristic for detecting commands that need network access. Used
 * when `networkAccess === "off"` to block network-touching commands. This
 * is advisory — a determined agent can still open sockets via python/node
 * — but it catches the 90% case (curl/wget/git clone) and makes the intent
 * explicit to the model.
 */
const NETWORK_COMMAND_PATTERNS: RegExp[] = [
  /\bcurl\b/,
  /\bwget\b/,
  /\bhttp(ie|s)?\b/,
  /\bnc\b/,
  /\bping\b/,
  /\btraceroute\b/,
  /\bssh\b/,
  /\bscp\b/,
  /\brsync\b[^\n]*::/, // rsync over network, not local
  /\bgit\s+(clone|fetch|pull|push|remote|ls-remote)/,
  /\bnpm\s+(install|i|add|publish|fetch|view|search)/,
  /\bpnpm\s+(install|i|add|publish|fetch|view|search)/,
  /\byarn\s+(add|install|publish)/,
  /\bbun\s+(add|install|i|x|create|publish)/,
  /\bpip\s+(install|download|search)/,
  /\bapt(\-get)?\s+(install|update|upgrade|download)/,
  /\bbrew\s+(install|update|upgrade|fetch|search)/,
];

function bashCommandLooksNetworky(args: unknown): boolean {
  if (!args || typeof args !== "object") return false;
  const command = (args as { command?: unknown }).command;
  if (typeof command !== "string") return false;
  return NETWORK_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

function sandboxDecision(
  toolName: string,
  mode: PiSandboxMode,
): PermissionDecision {
  if (mode === "full-access") {
    return { kind: "allow" };
  }

  if (mode === "read-only") {
    if (WRITE_TOOLS.has(toolName)) {
      return {
        kind: "block",
        reason:
          "Sandbox is read-only — writes are disabled. Switch the chat's permission mode to Auto or Bypass to edit files.",
      };
    }

    if (SHELL_TOOLS.has(toolName)) {
      return {
        kind: "block",
        reason:
          "Sandbox is read-only — shell commands that could mutate state are disabled. Switch the chat's permission mode to Auto or Bypass to run commands.",
      };
    }
  }

  // workspace-write: writes and shell commands are allowed but confined to
  // the project's cwd at the Pi level (since agent.cwd === project.path).
  return { kind: "allow" };
}

function networkDecision(
  toolName: string,
  args: unknown,
  access: PiNetworkAccess,
): PermissionDecision {
  if (access === "on") {
    return { kind: "allow" };
  }
  if (!SHELL_TOOLS.has(toolName)) {
    return { kind: "allow" };
  }
  if (!bashCommandLooksNetworky(args)) {
    return { kind: "allow" };
  }
  return {
    kind: "block",
    reason:
      "Network access is disabled for this chat. Toggle it on in the chat's permission mode if this command really needs the network.",
  };
}

function approvalDecision(
  toolName: string,
  policy: PiApprovalPolicy,
): PermissionDecision {
  if (policy === "auto") {
    return { kind: "allow" };
  }

  // `approval-required` only gates tools that can have side effects. Pure
  // reads (grep/ls/find/read) still run without prompting to keep the
  // conversation interactive.
  if (WRITE_TOOLS.has(toolName) || SHELL_TOOLS.has(toolName)) {
    return {
      kind: "require-approval",
      reason: `This chat is set to approval-required, so ${toolName} needs user approval before it can run.`,
    };
  }

  return { kind: "allow" };
}

/**
 * Run the full policy pipeline against a single tool call. The caller (the
 * `beforeToolCall` hook inside `chat-stream.ts`) acts on the result:
 *
 * - `allow`           → let the tool run
 * - `block`           → throw so Pi surfaces the error to the model
 * - `require-approval`→ publish a `tool_approval_request` event, wait
 */
export function decidePermission(
  toolName: string,
  args: unknown,
  config: PiAgentConfig,
): PermissionDecision {
  const sandbox = sandboxDecision(toolName, config.sandboxMode);
  if (sandbox.kind !== "allow") {
    return sandbox;
  }

  const network = networkDecision(toolName, args, config.networkAccess);
  if (network.kind !== "allow") {
    return network;
  }

  return approvalDecision(toolName, config.approvalPolicy);
}
