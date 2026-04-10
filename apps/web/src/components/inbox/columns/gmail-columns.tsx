import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { GMAIL_COLUMN_META } from "@g-spot/types/filters";
import { Badge, badgeVariants } from "@g-spot/ui/components/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@g-spot/ui/components/tooltip";
import { cn } from "@g-spot/ui/lib/utils";

import type { GmailLabelCatalogEntry } from "@/hooks/use-gmail-options";
import type { GmailThread } from "@/lib/gmail/types";
import { GmailSenderAvatar } from "../gmail-sender-avatar";
import { ROW_PREVIEW_BLOCK_ATTR } from "../row-preview";
import { formatDate } from "../shared";
import { TruncatedText } from "../truncated-text";

type GmailLabelCatalogMap = Record<string, GmailLabelCatalogEntry>;
type ResolvedGmailLabel = {
  id: string;
  label: string;
  style?: CSSProperties;
};

const LABEL_GAP_PX = 4;

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

const HIDDEN_SYSTEM_LABELS = new Set(["INBOX", "SENT", "DRAFT", "SPAM", "TRASH"]);

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

// ── Cell components ──────────────────────────────────────────────────────

function UnreadDotCell({ thread }: { thread: GmailThread }) {
  return thread.isUnread ? (
    <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />
  ) : (
    <span className="size-1.5 shrink-0 rounded-full bg-transparent" />
  );
}

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
        <UnreadDotCell thread={thread} />
        <GmailSenderAvatar
          size="sm"
          name={thread.from.name}
          email={thread.from.email}
          avatarUrl={thread.avatarUrl}
        />
      </div>
      <div className="min-w-0 flex-1">
        <Tooltip>
          <TooltipTrigger
            render={
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
            }
          />
          <TooltipContent side="bottom" align="start">
            {thread.from.name} &lt;{thread.from.email}&gt;
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function LabelsCell({
  thread,
  labelCatalog,
}: {
  thread: GmailThread;
  labelCatalog?: GmailLabelCatalogMap;
}) {
  const resolvedLabels = useMemo<ResolvedGmailLabel[]>(() => {
    const userLabels = thread.labels.flatMap((labelId) => {
      if (HIDDEN_SYSTEM_LABELS.has(labelId)) return [];
      const label = labelCatalog?.[labelId];
      if (label?.type === "user") {
        return [{ id: labelId, label: label.label, style: getLabelBadgeStyle(label) }];
      }
      return [];
    });

    const fallbackSystemLabels = thread.labels.flatMap((labelId) => {
      if (HIDDEN_SYSTEM_LABELS.has(labelId)) return [];
      const label = labelCatalog?.[labelId];
      if (label?.type === "system") {
        return [{ id: labelId, label: label.label, style: getLabelBadgeStyle(label) }];
      }
      if (labelId in SYSTEM_LABEL_DISPLAY) {
        return [{ id: labelId, label: SYSTEM_LABEL_DISPLAY[labelId], style: undefined }];
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
        const reservedOverflowWidth =
          remainingCount > 0
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
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
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
            <TooltipTrigger
              render={
                <Badge
                  {...{ [ROW_PREVIEW_BLOCK_ATTR]: "" }}
                  variant="outline"
                  className="px-1.5 py-0 text-[10px]"
                >
                  +{hiddenLabels.length}
                </Badge>
              }
            />
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

// ── Column definitions ──────────────────────────────────────────────────

export const LEADING_UNREAD_COLUMN_ID = "_leading_unread";

type GmailColumnInput = {
  columnConfig: { id: string; visible: boolean; truncation: "end" | "middle"; label: string | null }[];
  labelCatalog?: GmailLabelCatalogMap;
};

export function buildGmailColumns({
  columnConfig,
  labelCatalog,
}: GmailColumnInput): ColumnDef<GmailThread, unknown>[] {
  const fromColumn = columnConfig.find((c) => c.id === "from");
  const needsLeadingDot = !fromColumn || !fromColumn.visible;
  const truncationFor = (id: string) =>
    columnConfig.find((c) => c.id === id)?.truncation ?? "end";
  const labelOverride = (id: string) =>
    columnConfig.find((c) => c.id === id)?.label?.trim() || null;

  return [
    // Leading unread-dot fallback (only when "from" is hidden)
    ...(needsLeadingDot
      ? [
          {
            id: LEADING_UNREAD_COLUMN_ID,
            header: () => null,
            cell: ({ row }) => <UnreadDotCell thread={row.original} />,
            size: 32,
            enableResizing: false,
            enableHiding: false,
            meta: {
              align: "left",
              cellClassName: "pl-3",
              headerClassName: "w-8",
            },
          } satisfies ColumnDef<GmailThread, unknown>,
        ]
      : []),
    {
      id: "from",
      header: () => labelOverride("from") ?? GMAIL_COLUMN_META.from.label,
      cell: ({ row }) => <FromCell thread={row.original} truncation={truncationFor("from")} />,
      size: GMAIL_COLUMN_META.from.width ?? 176,
      meta: {
        align: GMAIL_COLUMN_META.from.align,
        truncation: GMAIL_COLUMN_META.from.truncation,
        breakpoint: GMAIL_COLUMN_META.from.breakpoint,
        cellClassName: "pl-3",
        headerClassName: "pl-3",
      },
    },
    {
      id: "labels",
      header: () => labelOverride("labels") ?? GMAIL_COLUMN_META.labels.label,
      cell: ({ row }) => <LabelsCell thread={row.original} labelCatalog={labelCatalog} />,
      size: 120,
      meta: {
        align: GMAIL_COLUMN_META.labels.align,
        truncation: GMAIL_COLUMN_META.labels.truncation,
        breakpoint: GMAIL_COLUMN_META.labels.breakpoint,
      },
    },
    {
      id: "subject",
      header: () => labelOverride("subject") ?? GMAIL_COLUMN_META.subject.label,
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <span
            className={cn(
              "shrink-0 whitespace-nowrap text-sm",
              row.original.isUnread ? "font-medium" : "text-muted-foreground",
            )}
          >
            {row.original.subject}
          </span>
          {row.original.snippet && (
            <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground/60 lg:inline">
              - {row.original.snippet}
            </span>
          )}
        </div>
      ),
      size: 560,
      meta: {
        align: GMAIL_COLUMN_META.subject.align,
        truncation: GMAIL_COLUMN_META.subject.truncation,
        breakpoint: GMAIL_COLUMN_META.subject.breakpoint,
      },
    },
    {
      id: "date",
      header: () => labelOverride("date") ?? GMAIL_COLUMN_META.date.label,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDate(row.original.date)}
        </span>
      ),
      size: GMAIL_COLUMN_META.date.width ?? 80,
      meta: {
        align: GMAIL_COLUMN_META.date.align,
        truncation: GMAIL_COLUMN_META.date.truncation,
        breakpoint: GMAIL_COLUMN_META.date.breakpoint,
      },
    },
  ];
}

