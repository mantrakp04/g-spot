import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  defineTool,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { Type, type TSchema } from "@sinclair/typebox";

/**
 * Tool name we expose to the agent. Same convention as Claude Desktop / Claude
 * Code: `mcp__<server>__<tool>`. The double underscore lets `pi-permissions.ts`
 * cheaply detect MCP-origin tools and route them through the approval policy.
 */
export function buildMcpToolName(serverName: string, toolName: string): string {
  const safeServer = serverName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `mcp__${safeServer}__${safeTool}`;
}

type RemoteToolListEntry = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

/**
 * Wrap a single tool advertised by an MCP server as a Pi `ToolDefinition`. The
 * agent only sees the wrapped tool — calls flow through this adapter back to
 * `client.callTool`. The MCP `inputSchema` (JSON Schema) is shipped to the
 * model unchanged via `Type.Unsafe`, since Pi forwards `parameters` straight
 * to the LLM without re-parsing.
 */
export function buildMcpToolDefinition(args: {
  client: Client;
  serverName: string;
  remoteTool: RemoteToolListEntry;
}): ToolDefinition {
  const { client, serverName, remoteTool } = args;
  const wrappedName = buildMcpToolName(serverName, remoteTool.name);

  const parameters: TSchema =
    remoteTool.inputSchema && typeof remoteTool.inputSchema === "object"
      ? Type.Unsafe<unknown>(remoteTool.inputSchema as Record<string, unknown>)
      : Type.Unsafe<unknown>({ type: "object", properties: {} });

  return defineTool({
    name: wrappedName,
    label: `MCP · ${serverName} · ${remoteTool.name}`,
    description:
      remoteTool.description ??
      `Tool '${remoteTool.name}' provided by MCP server '${serverName}'.`,
    promptSnippet: `${wrappedName}: ${
      remoteTool.description ?? `MCP tool ${serverName}/${remoteTool.name}`
    }`,
    parameters,
    async execute(_toolCallId, params, signal) {
      const result = await client.callTool(
        {
          name: remoteTool.name,
          arguments:
            params && typeof params === "object"
              ? (params as Record<string, unknown>)
              : undefined,
        },
        undefined,
        { signal },
      );

      // Pi expects `{ content: [{ type: "text", text }], details }`. Translate
      // MCP's richer result shape down to text where possible; non-text parts
      // are summarised so the model still gets a signal.
      const content = Array.isArray(result.content) ? result.content : [];
      const textParts: { type: "text"; text: string }[] = [];

      for (const part of content as Array<Record<string, unknown>>) {
        if (part.type === "text" && typeof part.text === "string") {
          textParts.push({ type: "text", text: part.text });
          continue;
        }
        if (part.type === "image" || part.type === "audio") {
          textParts.push({
            type: "text",
            text: `[mcp:${String(part.type)} payload omitted from text channel]`,
          });
          continue;
        }
        if (part.type === "resource") {
          const resource = part.resource as
            | { uri?: string; text?: string }
            | undefined;
          textParts.push({
            type: "text",
            text:
              typeof resource?.text === "string"
                ? resource.text
                : `[mcp:resource ${resource?.uri ?? "<no-uri>"}]`,
          });
          continue;
        }
        textParts.push({
          type: "text",
          text: JSON.stringify(part),
        });
      }

      if (textParts.length === 0) {
        textParts.push({ type: "text", text: "" });
      }

      if (result.isError === true) {
        const message = textParts.map((part) => part.text).join("\n").trim();
        throw new Error(
          message.length > 0 ? message : `MCP tool ${wrappedName} returned isError`,
        );
      }

      return {
        content: textParts,
        details: undefined,
      };
    },
  });
}
