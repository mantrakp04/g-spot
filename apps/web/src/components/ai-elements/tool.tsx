"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@g-spot/ui/components/collapsible";
import { cn } from "@g-spot/ui/lib/utils";
import type { FileContents, SupportedLanguages } from "@pierre/diffs";
import { File as PierreFile, PatchDiff } from "@pierre/diffs/react";
import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
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
  "approval-requested": "text-yellow-600/80 dark:text-yellow-400/70",
  "approval-responded": "text-muted-foreground/70",
  "input-available": "text-muted-foreground/80",
  "input-streaming": "text-muted-foreground/55",
  "output-available": "text-muted-foreground/65",
  "output-denied": "text-orange-600/80 dark:text-orange-400/70",
  "output-error": "text-destructive/80",
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
  state?: ToolPart["state"],
): { verb: string; target?: string } {
  const isActive = state === "input-streaming" || state === "input-available";
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
    return { verb: isActive ? "Editing" : "Edited", target: path && basename(path) };
  }
  if (name === "write") return { verb: isActive ? "Writing" : "Wrote", target: path && basename(path) };
  if (name === "read") return { verb: isActive ? "Reading" : "Read", target: path && basename(path) };
  if (name === "bash") return { verb: isActive ? "Running" : "Ran", target: cmd && truncate(cmd, 60) };
  if (name === "grep" || name === "search") {
    return { verb: isActive ? "Searching" : "Searched", target: pattern && truncate(pattern, 50) };
  }
  if (name === "glob") return { verb: isActive ? "Globbing" : "Globbed", target: pattern };
  if (name === "ls") return { verb: isActive ? "Listing" : "Listed", target: path };
  if (name === "webfetch") return { verb: isActive ? "Fetching" : "Fetched", target: url };
  if (name === "websearch") {
    return { verb: isActive ? "Searching web" : "Searched web", target: pattern && truncate(pattern, 50) };
  }
  if (name === "task" || name === "agent") {
    return { verb: isActive ? "Delegating" : "Delegated", target: asString(i.description) };
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
    const { verb, target } = getToolDisplayLabel(derivedName, input, state);
    return (
      <>
        <span>{verb}</span>
        {target && (
          <span className="truncate font-mono text-muted-foreground/75">{target}</span>
        )}
      </>
    );
  })();

  return (
    <CollapsibleTrigger
      className={cn(
        "group/trigger inline-flex min-h-5 max-w-full items-center gap-1.5 text-left text-sm leading-5 transition-colors hover:text-muted-foreground", 
        stateClass[state],
        state === "input-available" && "animate-pulse",
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 items-center gap-1.5 truncate leading-5">
        {label}
      </span>
      <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-data-[open]:rotate-180 group-data-[panel-open]/trigger:rotate-180 group-aria-expanded/trigger:rotate-180" />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "mt-1.5 ml-2 space-y-2 border-muted border-l pl-3 text-popover-foreground outline-none data-[closed]:fade-out-0 data-[closed]:animate-out data-[open]:fade-in-0 data-[open]:animate-in",
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
  toolName?: string;
  input?: ToolPart["input"];
};

type ToolInputObject = Record<string, unknown>;

const DIFF_HOST_STYLE = {
  "--diffs-font-family":
    "ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, monospace",
  "--diffs-font-size": "12px",
  "--diffs-line-height": "1.55",
  "--diffs-bg": "var(--card)",
  "--diffs-fg": "var(--foreground)",
} as CSSProperties;

function asObject(v: unknown): ToolInputObject | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as ToolInputObject)
    : undefined;
}

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

function patchLine(prefix: " " | "+" | "-", line: string) {
  return `${prefix}${line}`;
}

function hunkFromEdit(edit: ToolInputObject): string | undefined {
  const oldText = asString(edit.oldText) ?? asString(edit.old_text);
  const newText = asString(edit.newText) ?? asString(edit.new_text);
  if (oldText === undefined || newText === undefined) return undefined;

  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  if (oldLines.at(-1) === "") oldLines.pop();
  if (newLines.at(-1) === "") newLines.pop();

  const oldCount = Math.max(1, lineCount(oldText));
  const newCount = Math.max(1, lineCount(newText));
  return [
    `@@ -1,${oldCount} +1,${newCount} @@`,
    ...oldLines.map((line) => patchLine("-", line)),
    ...newLines.map((line) => patchLine("+", line)),
  ].join("\n");
}

function getToolPath(input: unknown): string | undefined {
  const i = asObject(input);
  if (!i) return undefined;
  return (
    asString(i.file_path) ??
    asString(i.filePath) ??
    asString(i.path) ??
    asString(i.target) ??
    asString(i.notebook_path)
  );
}

function patchFromEditInput(input: unknown, output: unknown): string | undefined {
  if (typeof output === "string" && /(^|\n)diff --git /.test(output)) {
    return output.slice(output.search(/(^|\n)diff --git /)).trim();
  }

  const i = asObject(input);
  if (!i) return undefined;
  const path = getToolPath(input) ?? "edited-file";
  const rawEdits = Array.isArray(i.edits) ? i.edits : [i];
  const hunks = rawEdits
    .map(asObject)
    .map((edit) => edit && hunkFromEdit(edit))
    .filter((hunk): hunk is string => Boolean(hunk));

  if (hunks.length === 0) return undefined;
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    ...hunks,
  ].join("\n");
}

const extensionLanguage: Record<string, SupportedLanguages> = {
  bash: "bash",
  cjs: "javascript",
  css: "css",
  html: "html",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  md: "markdown",
  mjs: "javascript",
  py: "python",
  sh: "bash",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  yaml: "yaml",
  yml: "yaml",
};

function languageFromPath(path: string | undefined): SupportedLanguages {
  const ext = path?.split(".").pop()?.toLowerCase();
  return (ext && extensionLanguage[ext]) || "text";
}

function ReadOutput({ input, output }: { input: unknown; output: string }) {
  const path = getToolPath(input);
  const file: FileContents = {
    name: path ? basename(path) : "read-output",
    contents: output,
    lang: languageFromPath(path),
  };

  return (
    <div className="max-h-[32rem] overflow-auto rounded-md border bg-card">
      <PierreFile
        disableWorkerPool
        file={file}
        options={{ overflow: "scroll" }}
        style={DIFF_HOST_STYLE}
      />
    </div>
  );
}

function EditOutput({ patch }: { patch: string }) {
  return (
    <div className="max-h-[32rem] overflow-auto rounded-md border bg-card">
      <PatchDiff
        disableWorkerPool
        options={{ diffStyle: "unified", overflow: "scroll" }}
        patch={patch}
        style={DIFF_HOST_STYLE}
      />
    </div>
  );
}

export const ToolOutput = ({
  className,
  output,
  errorText,
  toolName,
  input,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  const normalizedToolName = toolName?.toLowerCase().split(".").pop();
  const editPatch =
    !errorText &&
    (normalizedToolName === "edit" || normalizedToolName === "multiedit")
      ? patchFromEditInput(input, output)
      : undefined;
  let Output = <div>{output as ReactNode}</div>;

  if (editPatch) {
    Output = <EditOutput patch={editPatch} />;
  } else if (
    !errorText &&
    normalizedToolName === "read" &&
    typeof output === "string"
  ) {
    Output = <ReadOutput input={input} output={output} />;
  } else if (typeof output === "object" && !isValidElement(output)) {
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
