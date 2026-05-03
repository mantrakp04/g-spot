import type { ReactNode } from "react";

export type ToolOutputContext = {
  toolName?: string;
  /** Lowercased, last-segment-after-dot form of `toolName`. */
  normalizedToolName?: string;
  input: unknown;
  output: unknown;
  errorText?: string;
};

/**
 * Returns a rendered output for the given tool invocation, or `null`/`undefined`
 * if this renderer doesn't apply (the registry will then try the next one).
 */
export type ToolOutputRenderer = (ctx: ToolOutputContext) => ReactNode | null | undefined;

const renderers: ToolOutputRenderer[] = [];

export function registerToolOutputRenderer(renderer: ToolOutputRenderer) {
  renderers.push(renderer);
}

/**
 * Walk the registry in registration order, returning the first non-null result.
 * Falls through to caller's default rendering when nothing matches.
 */
export function renderToolOutput(ctx: ToolOutputContext): ReactNode | null {
  for (const renderer of renderers) {
    const result = renderer(ctx);
    if (result != null) return result;
  }
  return null;
}

export function normalizeToolName(toolName: string | undefined) {
  return toolName?.toLowerCase().split(".").pop();
}
