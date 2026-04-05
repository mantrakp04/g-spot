import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { Badge, badgeVariants } from "@g-spot/ui/components/badge";
import { TableCell, TableRow } from "@g-spot/ui/components/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@g-spot/ui/components/tooltip";
import { cn } from "@g-spot/ui/lib/utils";

import type { ColumnConfig } from "@g-spot/types/filters";
import { getColumnTruncation, GMAIL_COLUMN_META } from "@g-spot/types/filters";
import type { GmailLabelCatalogEntry } from "@/hooks/use-gmail-options";
import type { GmailThread } from "@/lib/gmail/types";
import { ColumnCell } from "./column-layout";
import { GmailSenderAvatar } from "./gmail-sender-avatar";
import { RowPreviewPopover, GmailThreadPreview, ROW_PREVIEW_BLOCK_ATTR } from "./row-preview";
import { formatDate } from "./shared";
import { TruncatedText } from "./truncated-text";

// ── Column Cell Renderers ─────────────────────────────────────────────────

function FromCell({
  thread,
  truncation,
}: {
  thread: GmailThread;
  truncation: "end" | "middle";
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex shrink-0 items-center gap-2">
        {thread.isUnread ? (
          <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />
        ) : (
          <span className="size-1.5 shrink-0 rounded-full bg-transparent" />
        )}
        <GmailSenderAvatar
          size="sm"
          name={thread.from.name}
          email={thread.from.email}
          avatarUrl={thread.avatarUrl}
        />
      </div>
      <div className="min-w-0 flex-1">
        <Tooltip>
          <TooltipTrigger render={
            <TruncatedText
              {...{ [ROW_PREVIEW_BLOCK_ATTR]: "" }}
              text={thread.from.name}
              mode={truncation}
              endChars={6}
              className={cn(
                thread.isUnread ? "font-medium" : "text-muted-foreground",
                "text-sm",
              )}
            />
          } />
          <TooltipContent side="bottom" align="start">
            {thread.from.name} &lt;{thread.from.email}&gt;
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

type GmailLabelCatalogMap = Record<string, GmailLabelCatalogEntry>;
type ResolvedGmailLabel = {
  id: string;
  label: string;
  style?: CSSProperties;
};

const LABEL_GAP_PX = 4;

function getLabelBadgeStyle(label?: GmailLabelCatalogEntry): CSSProperties | undefined {
  if (!label?.color?.backgroundColor && !label?.color?.textColor) {
    return undefined;
  }

  return {
    backgroundColor: label.color?.backgroundColor,
    borderColor: label.color?.backgroundColor,
    color: label.color?.textColor,
  };
}

function LabelsCell({
  thread,
  labelCatalog,
}: {
  thread: GmailThread;
  labelCatalog?: GmailLabelCatalogMap;
}) {
  const SYSTEM_LABEL_DISPLAY: Record<string, string> = {
    UNREAD: "Unread",
    STARRED: "Starred",
    IMPORTANT: "Important",
    CATEGORY_PERSONAL: "Primary",
    CATEGORY_SOCIAL: "Social",
    CATEGORY_PROMOTIONS: "Promotions",
    CATEGORY_UPDATES: "Updates",
    CATEGORY_FORUMS: "Forums",
  };

  const hiddenSystemLabels = new Set([
    "INBOX",
    "SENT",
    "DRAFT",
    "SPAM",
    "TRASH",
  ]);

  const resolvedLabels = useMemo<ResolvedGmailLabel[]>(() => {
    const userLabels = thread.labels.flatMap((labelId) => {
      if (hiddenSystemLabels.has(labelId)) return [];

      const label = labelCatalog?.[labelId];
      if (label?.type === "user") {
        return [{
          id: labelId,
          label: label.label,
          style: getLabelBadgeStyle(label),
        }];
      }

      return [];
    });

    const fallbackSystemLabels = thread.labels.flatMap((labelId) => {
      if (hiddenSystemLabels.has(labelId)) return [];

      const label = labelCatalog?.[labelId];
      if (label?.type === "system") {
        return [{
          id: labelId,
          label: label.label,
          style: getLabelBadgeStyle(label),
        }];
      }

      if (labelId in SYSTEM_LABEL_DISPLAY) {
        return [{
          id: labelId,
          label: SYSTEM_LABEL_DISPLAY[labelId],
          style: undefined,
        }];
      }

      return [];
    });

    const candidates = userLabels.length > 0 ? userLabels : fallbackSystemLabels;
    const seen = new Set<string>();

    return candidates.filter((label) => {
      const dedupeKey = `${label.id}:${label.label}`;
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    });
  }, [labelCatalog, thread.labels]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const overflowMeasureRef = useRef<HTMLSpanElement | null>(null);
  const labelMeasureRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const [visibleCount, setVisibleCount] = useState(resolvedLabels.length);

  useEffect(() => {
    setVisibleCount(resolvedLabels.length);
  }, [resolvedLabels.length]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const availableWidth = container.clientWidth;
      if (availableWidth <= 0 || resolvedLabels.length === 0) {
        setVisibleCount(resolvedLabels.length);
        return;
      }

      const overflowWidth = overflowMeasureRef.current?.offsetWidth ?? 0;
      let usedWidth = 0;
      let nextVisibleCount = 0;

      for (let index = 0; index < resolvedLabels.length; index += 1) {
        const label = resolvedLabels[index];
        const labelWidth = labelMeasureRefs.current[label.id]?.offsetWidth ?? 0;
        if (labelWidth <= 0) continue;

        const gapBeforeLabel = nextVisibleCount > 0 ? LABEL_GAP_PX : 0;
        const remainingCount = resolvedLabels.length - (index + 1);
        const reservedOverflowWidth = remainingCount > 0
          ? (nextVisibleCount > 0 || index > 0 ? LABEL_GAP_PX : 0) + overflowWidth
          : 0;

        if (usedWidth + gapBeforeLabel + labelWidth + reservedOverflowWidth > availableWidth) {
          break;
        }

        usedWidth += gapBeforeLabel + labelWidth;
        nextVisibleCount += 1;
      }

      if (nextVisibleCount === resolvedLabels.length) {
        setVisibleCount(resolvedLabels.length);
        return;
      }

      if (nextVisibleCount === 0 && overflowWidth > 0 && overflowWidth <= availableWidth) {
        setVisibleCount(0);
        return;
      }

      setVisibleCount(Math.max(0, nextVisibleCount));
    };

    measure();

    const observer = new ResizeObserver(() => {
      measure();
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [resolvedLabels]);

  if (resolvedLabels.length === 0) return null;

  const shownLabels = resolvedLabels.slice(0, visibleCount);
  const hiddenLabels = resolvedLabels.slice(visibleCount);

  return (
    <>
      <div ref={containerRef} className="flex min-w-0 items-center gap-1 overflow-hidden">
        {shownLabels.map((label) => (
          <Badge
            key={label.id}
            variant="outline"
            className="px-1.5 py-0 text-[10px]"
            style={label.style}
          >
            {label.label}
          </Badge>
        ))}
        {hiddenLabels.length > 0 && (
            <Tooltip>
              <TooltipTrigger render={
              <Badge
                {...{ [ROW_PREVIEW_BLOCK_ATTR]: "" }}
                variant="outline"
                className="px-1.5 py-0 text-[10px]"
              >
                +{hiddenLabels.length}
              </Badge>
            } />
            <TooltipContent
              side="bottom"
              align="start"
              className="max-w-sm border border-border bg-popover text-popover-foreground shadow-md [&>svg]:bg-popover [&>svg]:fill-popover"
            >
              <div className="flex max-w-sm flex-wrap gap-1">
                {hiddenLabels.map((label) => (
                  <Badge
                    key={label.id}
                    variant="outline"
                    className="px-1.5 py-0 text-[10px]"
                    style={label.style}
                  >
                    {label.label}
                  </Badge>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 -z-10 flex items-center gap-1 opacity-0"
      >
        {resolvedLabels.map((label) => (
          <span
            key={`measure-${label.id}`}
            ref={(node) => {
              labelMeasureRefs.current[label.id] = node;
            }}
            className={cn(badgeVariants({ variant: "outline" }), "px-1.5 py-0 text-[10px]")}
            style={label.style}
          >
            {label.label}
          </span>
        ))}
        <span
          ref={overflowMeasureRef}
          className={cn(badgeVariants({ variant: "outline" }), "px-1.5 py-0 text-[10px]")}
        >
          +{resolvedLabels.length}
        </span>
      </div>
    </>
  );
}

export const GMAIL_CELL_RENDERERS: Record<string, (
  thread: GmailThread,
  truncation: "end" | "middle",
  labelCatalog?: GmailLabelCatalogMap,
) => React.ReactNode> = {
  from: (thread, truncation) => <FromCell thread={thread} truncation={truncation} />,
  labels: (thread, _truncation, labelCatalog) => <LabelsCell thread={thread} labelCatalog={labelCatalog} />,
  subject: (thread) => (
    <div className="flex min-w-0 items-center gap-2 overflow-hidden">
      <span
        className={cn(
          "shrink-0 whitespace-nowrap text-sm",
          thread.isUnread ? "font-medium" : "text-muted-foreground",
        )}
      >
        {thread.subject}
      </span>
      {thread.snippet && (
        <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground/60 lg:inline">
          - {thread.snippet}
        </span>
      )}
    </div>
  ),
  date: (thread) => (
    <span className="whitespace-nowrap text-xs text-muted-foreground">
      {formatDate(thread.date)}
    </span>
  ),
};

// ── Row ───────────────────────────────────────────────────────────────────

type GmailThreadRowProps = {
  thread: GmailThread;
  isSelected?: boolean;
  onClick?: (thread: GmailThread) => void;
  columns: ColumnConfig[];
  labelCatalog?: GmailLabelCatalogMap;
};

export function GmailThreadRow({
  thread,
  isSelected,
  onClick,
  columns,
  labelCatalog,
}: GmailThreadRowProps) {
  const visibleColumns = columns.filter((c) => c.visible);
  const hasFromColumn = visibleColumns.some((c) => c.id === "from");

  return (
    <RowPreviewPopover preview={<GmailThreadPreview thread={thread} />}>
    <TableRow
      className={cn("group cursor-pointer", isSelected && "bg-accent")}
      onClick={() => onClick?.(thread)}
    >
      {!hasFromColumn && (
        <TableCell className="w-8 pl-3">
          {thread.isUnread ? (
            <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />
          ) : (
            <span className="size-1.5 shrink-0 rounded-full bg-transparent" />
          )}
        </TableCell>
      )}

      {visibleColumns.map((col) => {
        const render = GMAIL_CELL_RENDERERS[col.id];
        const meta = GMAIL_COLUMN_META[col.id as keyof typeof GMAIL_COLUMN_META];
        if (!render || !meta) return null;
        return (
          <ColumnCell key={col.id} meta={meta} column={col} className={col.id === "from" ? "pl-3" : undefined}>
            {render(thread, getColumnTruncation(meta, col), labelCatalog)}
          </ColumnCell>
        );
      })}
    </TableRow>
    </RowPreviewPopover>
  );
}
