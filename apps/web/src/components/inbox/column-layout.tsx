import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";

import {
  type ColumnConfig,
  type ColumnMeta,
  type ColumnBreakpoint,
  getColumnSizing,
  getColumnContentAlign,
  getColumnHeaderAlign,
  getColumnLabel,
  getColumnTruncation,
  getColumnWidthBounds,
} from "@g-spot/types/filters";
import { TableHead, TableCell } from "@g-spot/ui/components/table";
import { cn } from "@g-spot/ui/lib/utils";

import { TruncatedText } from "./truncated-text";

// ── Breakpoint → Tailwind class maps ─────────────────────────────────────

const BREAKPOINT_SHOW: Record<ColumnBreakpoint, string> = {
  always: "",
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

const ALIGN_CLASS: Record<string, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

const JUSTIFY_CLASS: Record<string, string> = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end",
};

export function ColumnResizeHandle({
  label,
  isResizing = false,
  onResizeStart,
}: {
  label: string;
  isResizing?: boolean;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      className="absolute top-0 right-[-0.375rem] flex h-full w-3 cursor-col-resize touch-none items-center justify-center"
      onPointerDown={onResizeStart}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-full border-r border-dotted transition-colors",
          isResizing
            ? "border-foreground/70"
            : "border-border/80 group-hover/column-header:border-foreground/40",
        )}
      />
    </div>
  );
}

function resolveColumnWidth(meta: ColumnMeta, column?: ColumnConfig): number | null {
  const bounds = getColumnWidthBounds(meta, column);
  return column?.width ?? meta.width ?? bounds.max ?? bounds.min ?? null;
}

function clampWidth(width: number | null, minWidth?: number): number | null {
  if (width == null) return minWidth ?? null;
  if (minWidth == null) return width;
  return Math.max(width, minWidth);
}

function sizingStyle(meta: ColumnMeta, column?: ColumnConfig): CSSProperties {
  const sizing = getColumnSizing(meta, column);
  const bounds = getColumnWidthBounds(meta, column);
  const width = resolveColumnWidth(meta, column);
  const effectiveWidth = clampWidth(width, bounds.min);

  switch (sizing) {
    case "fixed":
      if (effectiveWidth == null) return {};
      return { width: effectiveWidth, minWidth: effectiveWidth, maxWidth: effectiveWidth };
    case "fit":
      return {
        width: effectiveWidth ?? undefined,
        minWidth: bounds.min,
        maxWidth: bounds.max,
      };
    case "fill":
      return effectiveWidth == null
        ? { width: "100%", minWidth: bounds.min, maxWidth: bounds.max }
        : { width: effectiveWidth, minWidth: effectiveWidth, maxWidth: bounds.max };
  }
}

function baseClasses(meta: ColumnMeta): string {
  const parts: string[] = [];
  if (meta.breakpoint && meta.breakpoint !== "always") {
    parts.push(BREAKPOINT_SHOW[meta.breakpoint]);
  }
  if (meta.align) {
    parts.push(ALIGN_CLASS[meta.align]);
  }
  return parts.join(" ");
}

// ── Header ───────────────────────────────────────────────────────────────

export function ColumnHeader({
  meta,
  column,
  className,
  content,
  onResizeStart,
  isResizing = false,
}: {
  meta: ColumnMeta;
  column?: ColumnConfig;
  className?: string;
  content?: ReactNode;
  onResizeStart?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  isResizing?: boolean;
}) {
  const align = getColumnHeaderAlign(meta, column);
  const label = getColumnLabel(meta, column);
  const truncation = getColumnTruncation(meta, column);

  return (
    <TableHead
      className={cn(
        "relative",
        baseClasses({ ...meta, align }),
        className,
      )}
      style={sizingStyle(meta, column)}
    >
      <div
        className={cn(
          "group/column-header relative flex w-full min-w-0 items-center pr-2.5",
          align && JUSTIFY_CLASS[align],
        )}
      >
        <div className="min-w-0 flex-1">
          {content ?? (
            <TruncatedText text={label} mode={truncation} endChars={6} className="block w-full truncate" />
          )}
        </div>
        {onResizeStart && (
          <ColumnResizeHandle label={label || meta.id} isResizing={isResizing} onResizeStart={onResizeStart} />
        )}
      </div>
    </TableHead>
  );
}

// ── Cell ─────────────────────────────────────────────────────────────────

export function ColumnCell({
  meta,
  column,
  className,
  children,
}: {
  meta: ColumnMeta;
  column?: ColumnConfig;
  className?: string;
  children: ReactNode;
}) {
  const align = getColumnContentAlign(meta, column);

  return (
    <TableCell
      className={cn("overflow-hidden", baseClasses({ ...meta, align }), className)}
      style={sizingStyle(meta, column)}
    >
      <div
        className={cn(
          "flex w-full min-w-0 items-center gap-1 overflow-hidden",
          align && JUSTIFY_CLASS[align],
        )}
      >
        {children}
      </div>
    </TableCell>
  );
}
