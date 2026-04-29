"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@g-spot/ui/components/collapsible";
import { cn } from "@g-spot/ui/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";

import type { DynamicToolUIPart, ToolUIPart } from "@/lib/chat-ui";
import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible className={cn("group not-prose w-full", className)} {...props} />
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
  title?: ReactNode;
  className?: string;
} & (
  | { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never; input?: unknown }
  | {
      type: DynamicToolUIPart["type"];
      state: DynamicToolUIPart["state"];
      toolName: string;
      input?: unknown;
    }
);

const stateClass: Record<ToolPart["state"], string> = {
  "approval-requested": "text-yellow-500",
  "approval-responded": "text-muted-foreground",
  "input-available": "text-foreground",
  "input-streaming": "text-muted-foreground/60",
  "output-available": "text-muted-foreground",
  "output-denied": "text-orange-500",
  "output-error": "text-destructive",
};

/**
 * Back-compat for sandbox.tsx and any other consumers — returns a small
 * status dot styled by tool state. The redesigned ToolHeader doesn't use it.
 */
export const getStatusBadge = (state: ToolPart["state"]) => (
  <span
    className={cn(
      "inline-block size-1.5 rounded-full bg-current",
      stateClass[state],
    )}
  />
);

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Derive a concise verb + target label from the raw tool name and input.
 * Falls back to the bare tool name when the shape isn't recognized.
 */
export function getToolDisplayLabel(
  toolName: string,
  input: unknown,
): { verb: string; target?: string } {
  const name = toolName.toLowerCase();
  const i = (input ?? {}) as Record<string, unknown>;
  const path =
    asString(i.file_path) ??
    asString(i.filePath) ??
    asString(i.path) ??
    asString(i.target) ??
    asString(i.notebook_path);
  const cmd = asString(i.command);
  const pattern = asString(i.pattern) ?? asString(i.query);
  const url = asString(i.url);

  if (name === "edit" || name === "multiedit" || name === "notebookedit") {
    return { verb: "Edited", target: path && basename(path) };
  }
  if (name === "write") return { verb: "Wrote", target: path && basename(path) };
  if (name === "read") return { verb: "Read", target: path && basename(path) };
  if (name === "bash") return { verb: "Ran", target: cmd && truncate(cmd, 60) };
  if (name === "grep" || name === "search") {
    return { verb: "Searched", target: pattern && truncate(pattern, 50) };
  }
  if (name === "glob") return { verb: "Globbed", target: pattern };
  if (name === "ls") return { verb: "Listed", target: path };
  if (name === "webfetch") return { verb: "Fetched", target: url };
  if (name === "websearch") {
    return { verb: "Searched web", target: pattern && truncate(pattern, 50) };
  }
  if (name === "task" || name === "agent") {
    return { verb: "Delegated", target: asString(i.description) };
  }
  if (toolName.startsWith("mcp__")) {
    const suffix = toolName.slice("mcp__".length);
    return { verb: "Called", target: suffix };
  }
  return { verb: toolName };
}

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  input,
  ...props
}: ToolHeaderProps) => {
  const derivedName =
    toolName ?? (type.startsWith("tool-") ? type.slice("tool-".length) : type);
  const label = title ?? (() => {
    const { verb, target } = getToolDisplayLabel(derivedName, input);
    return (
      <>
        <span>{verb}</span>
        {target && (
          <span className="font-mono text-foreground">{target}</span>
        )}
      </>
    );
  })();

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center gap-1.5 text-left text-sm transition-colors hover:text-foreground",
        stateClass[state],
        state === "input-available" && "animate-pulse",
        className,
      )}
      {...props}
    >
      <span className="flex flex-1 items-center gap-1.5 truncate">
        {label}
      </span>
      <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 mt-1.5 ml-2 space-y-2 border-muted border-l pl-3 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className,
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("overflow-hidden", className)} {...props}>
    <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let Output = <div>{output as ReactNode}</div>;

  if (typeof output === "object" && !isValidElement(output)) {
    Output = <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />;
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-md text-xs [&_table]:w-full",
        errorText ? "text-destructive" : "text-foreground",
        className,
      )}
      {...props}
    >
      {errorText ? <div className="font-mono">{errorText}</div> : Output}
    </div>
  );
};
