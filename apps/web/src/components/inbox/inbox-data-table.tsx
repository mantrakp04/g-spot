import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnSizingState,
  type RowData,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import type { ColumnConfig } from "@g-spot/types/filters";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@g-spot/ui/components/table";
import { TooltipProvider } from "@g-spot/ui/components/tooltip";
import { cn } from "@g-spot/ui/lib/utils";
import { Loader2 } from "lucide-react";

import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";

// ── Meta typing ───────────────────────────────────────────────────────────

export type InboxBreakpoint = "always" | "sm" | "md" | "lg" | "xl";
export type InboxAlign = "left" | "center" | "right";
export type InboxTruncation = "end" | "middle";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Responsive breakpoint — column is hidden via CSS below this size */
    breakpoint?: InboxBreakpoint;
    /** Body cell text/flex alignment */
    align?: InboxAlign;
    /** Header cell text alignment (falls back to `align`) */
    headerAlign?: InboxAlign;
    /** How long text truncates inside the cell */
    truncation?: InboxTruncation;
    /** Extra Tailwind classes merged into the `<th>` */
    headerClassName?: string;
    /** Extra Tailwind classes merged into the `<td>` */
    cellClassName?: string;
    /** Inner flex-row wrapper classes merged into both header & cell contents */
    contentClassName?: string;
  }
}

const BREAKPOINT_CLASS: Record<InboxBreakpoint, string> = {
  always: "",
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

const ALIGN_TEXT: Record<InboxAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

const ALIGN_JUSTIFY: Record<InboxAlign, string> = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end",
};

function resolveMeta<TData>(
  column: { columnDef: { meta?: ColumnDef<TData, unknown>["meta"] } },
) {
  const meta = column.columnDef.meta;
  return {
    breakpoint: meta?.breakpoint ?? "always",
    align: meta?.align ?? "left",
    headerAlign: meta?.headerAlign ?? meta?.align ?? "left",
    headerClassName: meta?.headerClassName,
    cellClassName: meta?.cellClassName,
    contentClassName: meta?.contentClassName,
  };
}

// ── Row wrapper contract ─────────────────────────────────────────────────

/**
 * Row wrappers (e.g. `RowPreviewPopover`) typically clone their single
 * element child and attach listeners. Consumers provide a function that
 * receives the already-rendered `<TableRow>` element and returns the
 * wrapped element.
 */
export type RowWrapper<TData> = (
  row: TData,
  element: ReactElement,
) => ReactNode;

// ── Props ────────────────────────────────────────────────────────────────

type InboxDataTableProps<TData> = {
  /**
   * TanStack Table column definitions. Column IDs that also appear in
   * `columnConfig` are user-managed (visible/ordered/resizable); any other
   * columns render in natural order and are not persisted.
   *
   * Each column def is expected to set `size`, and optionally `minSize` /
   * `maxSize` — those drive TanStack's native column-resizing behaviour.
   */
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  getRowId: (row: TData) => string;

  /** Persisted user-managed column state (order, visibility, width, …) */
  columnConfig: ColumnConfig[];
  /** Called when the user finishes resizing a column */
  onColumnConfigChange?: (next: ColumnConfig[]) => void;

  onRowClick?: (row: TData) => void;
  rowClassName?: (row: TData) => string | undefined;
  /** Wrap each `<TableRow>` (e.g. with a preview popover) */
  rowWrapper?: RowWrapper<TData>;

  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;

  isLoading?: boolean;
  /** Number of skeleton rows rendered while the first page is loading */
  skeletonRowCount?: number;
  /** Rendered when data is empty and not loading/erroring */
  emptyState: ReactNode;
  /** Rendered on error */
  errorState?: ReactNode;

  /**
   * Column ID that should absorb remaining container space so the table
   * never overflows or leaves a gap. Typically `"title"` or `"subject"`.
   * If the user explicitly resizes that column, the persisted width acts
   * as a floor; otherwise the rendered width is `max(120, remainingSpace)`.
   */
  fillColumnId?: string;

  /** Max height wrapper around the table body (for infinite scroll) */
  scrollContainerClassName?: string;
};

// ── Component ────────────────────────────────────────────────────────────

export function InboxDataTable<TData>({
  columns,
  data,
  getRowId,
  columnConfig,
  onColumnConfigChange,
  onRowClick,
  rowClassName,
  rowWrapper,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  isLoading,
  skeletonRowCount = 7,
  emptyState,
  errorState,
  fillColumnId,
  scrollContainerClassName,
}: InboxDataTableProps<TData>) {
  // ── Derive TanStack state from persisted ColumnConfig ────────────────

  const managedIds = useMemo(
    () => new Set(columnConfig.map((column) => column.id)),
    [columnConfig],
  );

  const columnOrder = useMemo<ColumnOrderState>(() => {
    const firstManagedIndex = columns.findIndex(
      (def) => typeof def.id === "string" && managedIds.has(def.id),
    );
    const leading =
      firstManagedIndex === -1
        ? columns
            .map((def) => def.id)
            .filter((id): id is string => typeof id === "string" && !managedIds.has(id))
        : columns
            .slice(0, firstManagedIndex)
            .map((def) => def.id)
            .filter((id): id is string => typeof id === "string" && !managedIds.has(id));
    const trailing =
      firstManagedIndex === -1
        ? []
        : columns
            .slice(firstManagedIndex)
            .map((def) => def.id)
            .filter((id): id is string => typeof id === "string" && !managedIds.has(id));
    return [...leading, ...columnConfig.map((c) => c.id), ...trailing];
  }, [columnConfig, columns, managedIds]);

  const columnVisibility = useMemo<VisibilityState>(() => {
    const state: VisibilityState = {};
    for (const column of columnConfig) {
      state[column.id] = column.visible;
    }
    return state;
  }, [columnConfig]);

  const initialSizing = useMemo<ColumnSizingState>(() => {
    const state: ColumnSizingState = {};
    for (const column of columnConfig) {
      if (column.width != null) state[column.id] = column.width;
    }
    return state;
  }, [columnConfig]);

  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(initialSizing);

  // If the persisted config reference changes (e.g. section switched,
  // another tab saved widths, etc.) re-seed the local sizing map.
  const configKeyRef = useRef<string>("");
  const configKey = useMemo(
    () => columnConfig.map((c) => `${c.id}:${c.width ?? ""}`).join("|"),
    [columnConfig],
  );
  useEffect(() => {
    if (configKeyRef.current !== configKey) {
      configKeyRef.current = configKey;
      setColumnSizing(initialSizing);
    }
  }, [configKey, initialSizing]);

  const table = useReactTable({
    data,
    columns,
    getRowId: (row) => getRowId(row),
    getCoreRowModel: getCoreRowModel(),
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    manualPagination: true,
    manualSorting: true,
    state: {
      columnOrder,
      columnVisibility,
      columnSizing,
    },
    onColumnSizingChange: setColumnSizing,
  });

  // ── Fill column: measure container and absorb remaining space ──────

  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!scrollContainer) return;
    const measure = () => {
      const width = scrollContainer.clientWidth;
      if (width > 0) {
        setContainerWidth((prev) => (prev === width ? prev : width));
      }
    };

    measure();

    const ro = new ResizeObserver(() => {
      measure();
    });
    ro.observe(scrollContainer);
    return () => ro.disconnect();
  }, [scrollContainer]);

  const visibleLeafColumns = table.getVisibleLeafColumns();
  const fillColumn = useMemo(
    () =>
      fillColumnId
        ? visibleLeafColumns.find((column) => column.id === fillColumnId) ?? null
        : null,
    [fillColumnId, visibleLeafColumns],
  );
  const hasExplicitFillWidth = fillColumnId
    ? Object.prototype.hasOwnProperty.call(columnSizing, fillColumnId)
    : false;
  const nonFillColumnsWidth = useMemo(
    () =>
      visibleLeafColumns.reduce(
        (sum, column) => sum + (column.id === fillColumnId ? 0 : column.getSize()),
        0,
      ),
    [fillColumnId, visibleLeafColumns],
  );
  const fillWidthFloor = fillColumnId
    ? Math.max(120, Math.round(columnSizing[fillColumnId] ?? 120))
    : 120;
  const renderedFillWidth = fillColumn
    ? containerWidth > 0
      ? Math.max(
          hasExplicitFillWidth ? fillWidthFloor : 120,
          containerWidth - nonFillColumnsWidth,
        )
      : Math.max(fillColumn.getSize(), hasExplicitFillWidth ? fillWidthFloor : 120)
    : null;
  const renderedTableWidth = fillColumn
    ? nonFillColumnsWidth + (renderedFillWidth ?? fillColumn.getSize())
    : visibleLeafColumns.reduce((sum, column) => sum + column.getSize(), 0);
  const getRenderedColumnWidth = useCallback(
    (columnId: string, fallbackWidth: number) =>
      columnId === fillColumnId && renderedFillWidth != null
        ? renderedFillWidth
        : fallbackWidth,
    [fillColumnId, renderedFillWidth],
  );

  // ── Persist exactly once per drag, on release ───────────────────────

  const isResizingColumn = Boolean(
    table.getState().columnSizingInfo.isResizingColumn,
  );
  const wasResizingRef = useRef(false);
  useEffect(() => {
    const wasResizing = wasResizingRef.current;
    wasResizingRef.current = isResizingColumn;
    if (!wasResizing || isResizingColumn) return;
    if (!onColumnConfigChange) return;

    onColumnConfigChange(
      columnConfig.map((column) => ({
        ...column,
        width: Object.prototype.hasOwnProperty.call(columnSizing, column.id)
          ? Math.round(columnSizing[column.id]!)
          : column.width,
      })),
    );
  }, [isResizingColumn, columnSizing, columnConfig, onColumnConfigChange]);
  const sentinelRef = useInfiniteScroll({
    hasNextPage: hasNextPage ?? false,
    isFetchingNextPage: isFetchingNextPage ?? false,
    fetchNextPage: () => fetchNextPage?.(),
    root: scrollContainer,
  });

  // ── Branchy render states ───────────────────────────────────────────

  if (errorState !== undefined && errorState !== null) {
    return <>{errorState}</>;
  }
  // `emptyState` only fires once loading is finished. While loading we
  // render the same table shell with skeleton rows — this avoids a DOM
  // swap (and the accompanying layout flash) between loading and data.
  if (!isLoading && data.length === 0) {
    return <>{emptyState}</>;
  }

  // ── Main render ─────────────────────────────────────────────────────

  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;
  const showSkeletonRows = isLoading && rows.length === 0;
  const visibleColumnCount = visibleLeafColumns.length;

  const rowVirtualizer = useVirtualizer({
    count: showSkeletonRows ? 0 : rows.length,
    getScrollElement: () => scrollContainer,
    estimateSize: () => 40,
    overscan: 8,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualTotalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]!.start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? virtualTotalSize - virtualRows[virtualRows.length - 1]!.end
      : 0;

  return (
    <TooltipProvider>
      <div
        ref={setScrollContainer}
        className={cn(
          "max-h-[28rem] overflow-x-auto overflow-y-auto [&_[data-slot=table-container]]:overflow-visible",
          scrollContainerClassName,
        )}
      >
        <Table
          className="table-fixed"
          style={{
            width: renderedTableWidth > 0 ? renderedTableWidth : undefined,
            minWidth: "100%",
          }}
        >
          <TableHeader className="sticky top-0 z-10 bg-card">
            {headerGroups.map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => {
                  const meta = resolveMeta(header.column);
                  const canResize = header.column.getCanResize();
                  const isResizing = header.column.getIsResizing();
                  return (
                    <TableHead
                      key={header.id}
                      style={{
                        width: getRenderedColumnWidth(
                          header.column.id,
                          header.getSize(),
                        ),
                      }}
                      className={cn(
                        "relative",
                        BREAKPOINT_CLASS[meta.breakpoint],
                        ALIGN_TEXT[meta.headerAlign],
                        meta.headerClassName,
                      )}
                    >
                      <div
                        className={cn(
                          "flex w-full min-w-0 items-center pr-2.5",
                          ALIGN_JUSTIFY[meta.headerAlign],
                          meta.contentClassName,
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                        </div>
                      </div>
                      {canResize && (
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize ${String(header.column.id)} column`}
                          onMouseDown={(event) => {
                            event.stopPropagation();
                            header.getResizeHandler()(event);
                          }}
                          onTouchStart={(event) => {
                            event.stopPropagation();
                            header.getResizeHandler()(event);
                          }}
                          onDoubleClick={() => header.column.resetSize()}
                          className={cn(
                            "absolute top-0 right-0 z-20 h-full w-1.5 cursor-col-resize touch-none select-none",
                            "transition-colors",
                            isResizing
                              ? "bg-foreground/60"
                              : "bg-transparent hover:bg-foreground/30",
                          )}
                        />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {showSkeletonRows
              ? Array.from({ length: skeletonRowCount }, (_, rowIndex) => (
                  <TableRow
                    key={`skeleton-${rowIndex}`}
                    className="pointer-events-none hover:bg-transparent"
                  >
                    {table.getVisibleLeafColumns().map((column) => {
                      const meta = resolveMeta(column);
                      return (
                        <TableCell
                          key={column.id}
                          style={{
                            width: getRenderedColumnWidth(
                              column.id,
                              column.getSize(),
                            ),
                          }}
                          className={cn(
                            "overflow-hidden",
                            BREAKPOINT_CLASS[meta.breakpoint],
                            ALIGN_TEXT[meta.align],
                            meta.cellClassName,
                          )}
                        >
                          <div
                            className={cn(
                              "flex w-full min-w-0 items-center gap-1 overflow-hidden",
                              ALIGN_JUSTIFY[meta.align],
                              meta.contentClassName,
                            )}
                          >
                            <Skeleton className="h-3.5 w-full max-w-[85%]" />
                          </div>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              : (
                <>
                  {paddingTop > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={visibleColumnCount} style={{ height: paddingTop, padding: 0, border: 0 }} />
                    </tr>
                  )}
                  {virtualRows.map((virtualRow) => {
                    const row = rows[virtualRow.index]!;
                    const rowEl = (
                      <TableRow
                        key={row.id}
                        data-index={virtualRow.index}
                        ref={rowVirtualizer.measureElement}
                        className={cn(
                          "group",
                          onRowClick && "cursor-pointer",
                          rowClassName?.(row.original),
                        )}
                        onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                      >
                        {row.getVisibleCells().map((cell) => {
                          const meta = resolveMeta(cell.column);
                          return (
                            <TableCell
                              key={cell.id}
                              style={{
                                width: getRenderedColumnWidth(
                                  cell.column.id,
                                  cell.column.getSize(),
                                ),
                              }}
                              className={cn(
                                "overflow-hidden",
                                BREAKPOINT_CLASS[meta.breakpoint],
                                ALIGN_TEXT[meta.align],
                                meta.cellClassName,
                              )}
                            >
                              <div
                                className={cn(
                                  "flex w-full min-w-0 items-center gap-1 overflow-hidden",
                                  ALIGN_JUSTIFY[meta.align],
                                  meta.contentClassName,
                                )}
                              >
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </div>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );

                    return rowWrapper ? (
                      <RowWrapperSlot key={row.id} wrapper={rowWrapper} row={row.original}>
                        {rowEl}
                      </RowWrapperSlot>
                    ) : (
                      rowEl
                    );
                  })}
                  {paddingBottom > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={visibleColumnCount} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                    </tr>
                  )}
                </>
              )}
          </TableBody>
        </Table>

        {hasNextPage && <div ref={sentinelRef} className="h-1" />}
        {isFetchingNextPage && (
          <div className="flex justify-center py-2">
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function RowWrapperSlot<TData>({
  wrapper,
  row,
  children,
}: {
  wrapper: RowWrapper<TData>;
  row: TData;
  children: ReactElement;
}) {
  return <>{wrapper(row, children)}</>;
}
