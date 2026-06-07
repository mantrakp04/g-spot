import type { DiffLineAnnotation } from "@pierre/diffs";

import type { ReviewComment } from "@/hooks/use-github-detail";

export type ReviewAnnotationPayload =
  | {
      kind: "thread";
      root: ReviewComment;
      replies: ReviewComment[];
    }
  | {
      kind: "compose";
      startLine?: number;
    };

function githubSideToPierre(
  side: "LEFT" | "RIGHT",
): "deletions" | "additions" {
  return side === "LEFT" ? "deletions" : "additions";
}

export function getReviewCommentLine(
  comment: Pick<ReviewComment, "line" | "originalLine">,
) {
  return comment.line ?? comment.originalLine;
}

export function getReviewCommentStartLine(
  comment: Pick<
    ReviewComment,
    "side" | "startLine" | "originalStartLine" | "line" | "originalLine"
  >,
) {
  if (comment.side === "LEFT") {
    return comment.originalStartLine ?? comment.originalLine ?? comment.line;
  }
  return (
    comment.startLine ??
    comment.originalStartLine ??
    comment.line ??
    comment.originalLine
  );
}

export function getReviewCommentRange(
  comment: Pick<
    ReviewComment,
    "side" | "startLine" | "originalStartLine" | "line" | "originalLine"
  >,
) {
  const endLine = getReviewCommentLine(comment);
  if (endLine == null) return null;

  const rawStartLine = getReviewCommentStartLine(comment);
  const startLine =
    rawStartLine == null ? endLine : Math.min(rawStartLine, endLine);
  return {
    startLine,
    endLine,
    lineCount: Math.max(1, endLine - startLine + 1),
  };
}

export function formatReviewCommentRange(
  comment: Pick<
    ReviewComment,
    "side" | "startLine" | "originalStartLine" | "line" | "originalLine"
  >,
) {
  const range = getReviewCommentRange(comment);
  if (!range) return null;
  if (range.startLine === range.endLine) return `L${range.endLine}`;
  return `L${range.startLine}-L${range.endLine}`;
}

export function buildReviewAnnotations(
  comments: ReviewComment[],
  compose:
    | { side: "LEFT" | "RIGHT"; line: number; startLine?: number }
    | null,
): DiffLineAnnotation<ReviewAnnotationPayload>[] {
  const roots = comments.filter((c) => c.inReplyToId == null);
  const repliesByRoot = new Map<number, ReviewComment[]>();
  for (const c of comments) {
    if (c.inReplyToId != null) {
      const arr = repliesByRoot.get(c.inReplyToId) ?? [];
      arr.push(c);
      repliesByRoot.set(c.inReplyToId, arr);
    }
  }
  for (const arr of repliesByRoot.values()) {
    arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  const out: DiffLineAnnotation<ReviewAnnotationPayload>[] = [];
  for (const root of roots) {
    const line = getReviewCommentLine(root);
    if (line == null) continue;
    out.push({
      side: githubSideToPierre(root.side),
      lineNumber: line,
      metadata: {
        kind: "thread",
        root,
        replies: repliesByRoot.get(root.id) ?? [],
      },
    });
  }

  if (compose) {
    out.push({
      side: githubSideToPierre(compose.side),
      lineNumber: compose.line,
      metadata: { kind: "compose", startLine: compose.startLine },
    });
  }
  return out;
}

export function reviewAnnotationKey(
  filename: string,
  annotation: DiffLineAnnotation<ReviewAnnotationPayload>,
) {
  const payload = annotation.metadata;
  if (payload.kind === "thread") return `thread:${payload.root.id}`;
  const start = payload.startLine ?? "";
  return `compose:${filename}:${annotation.side}:${annotation.lineNumber}:${start}`;
}
