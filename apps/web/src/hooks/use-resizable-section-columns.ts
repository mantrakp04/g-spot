import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ColumnConfig, SectionSource } from "@g-spot/types/filters";
import {
  clampColumnWidth,
  getColumnMeta,
  getColumnSizing,
  getColumnWidthBounds,
  normalizeColumns,
} from "@g-spot/types/filters";

import { useUpdateSectionMutation } from "@/hooks/use-sections";

type ResizeState = {
  columnId: string;
  startX: number;
  startWidth: number;
};

const PERSIST_DEBOUNCE_MS = 250;

function resolveColumnWidth(source: SectionSource, column: ColumnConfig): number {
  const meta = getColumnMeta(source, column.id);
  if (!meta) return 96;

  const bounds = getColumnWidthBounds(meta, column);

  return column.width
    ?? meta.width
    ?? bounds.max
    ?? bounds.min
    ?? 96;
}

function normalizeWidth(source: SectionSource, column: ColumnConfig, width: number): number {
  const meta = getColumnMeta(source, column.id);
  if (!meta) return Math.round(width);

  const bounds = getColumnWidthBounds(meta, column);

  return clampColumnWidth(meta, width, column)
    ?? bounds.min
    ?? meta.width
    ?? bounds.max
    ?? Math.round(width);
}

function columnsMatch(left: ColumnConfig[], right: ColumnConfig[]): boolean {
  if (left.length !== right.length) return false;

  return left.every((column, index) => {
    const other = right[index];
    return other != null
      && other.id === column.id
      && other.visible === column.visible
      && other.sizing === column.sizing
      && other.width === column.width
      && other.minWidth === column.minWidth
      && other.maxWidth === column.maxWidth
      && other.label === column.label
      && other.headerAlign === column.headerAlign
      && other.align === column.align
      && other.truncation === column.truncation;
  });
}

export function useResizableSectionColumns(
  sectionId: string,
  source: SectionSource,
  columns: ColumnConfig[] | null | undefined,
) {
  const updateSectionMutation = useUpdateSectionMutation();
  const normalizedColumns = useMemo(
    () => normalizeColumns(source, columns),
    [columns, source],
  );
  const sectionKey = `${sectionId}:${source}`;

  const [localColumns, setLocalColumns] = useState<ColumnConfig[]>(normalizedColumns);
  const [resizingColumnId, setResizingColumnId] = useState<string | null>(null);

  const localColumnsRef = useRef(localColumns);
  const persistedColumnsRef = useRef(normalizedColumns);
  const hydratedSectionKeyRef = useRef<string | null>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRef = useRef<number | null>(null);
  const queuedColumnsRef = useRef<ColumnConfig[] | null>(null);

  useEffect(() => {
    localColumnsRef.current = localColumns;
  }, [localColumns]);

  useEffect(() => {
    const isNewSection = hydratedSectionKeyRef.current !== sectionKey
      || localColumnsRef.current.length === 0;

    if (isNewSection) {
      hydratedSectionKeyRef.current = sectionKey;
      persistedColumnsRef.current = normalizedColumns;
      localColumnsRef.current = normalizedColumns;
      setLocalColumns(normalizedColumns);
      return;
    }

    if (resizeStateRef.current) {
      return;
    }

    persistedColumnsRef.current = normalizedColumns;

    if (columnsMatch(normalizedColumns, localColumnsRef.current)) {
      return;
    }

    localColumnsRef.current = normalizedColumns;
    setLocalColumns(normalizedColumns);
  }, [normalizedColumns, sectionKey]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const queueColumnsForRender = useCallback((nextColumns: ColumnConfig[]) => {
    queuedColumnsRef.current = nextColumns;

    if (frameRef.current != null) return;

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const queued = queuedColumnsRef.current;
      if (!queued) return;
      queuedColumnsRef.current = null;
      setLocalColumns(queued);
    });
  }, []);

  const commitLocalColumns = useCallback((nextColumns: ColumnConfig[]) => {
    localColumnsRef.current = nextColumns;
    queueColumnsForRender(nextColumns);
  }, [queueColumnsForRender]);

  const persistColumns = useCallback((nextColumns: ColumnConfig[]) => {
    if (columnsMatch(nextColumns, persistedColumnsRef.current)) {
      return;
    }

    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
    }

    persistedColumnsRef.current = nextColumns;

    persistTimeoutRef.current = setTimeout(() => {
      persistTimeoutRef.current = null;
      updateSectionMutation.mutate({
        id: sectionId,
        columns: nextColumns,
      });
    }, PERSIST_DEBOUNCE_MS);
  }, [sectionId, updateSectionMutation]);

  const beginResize = useCallback((
    columnId: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;

    const activeColumn = localColumnsRef.current.find((column) => column.id === columnId);
    if (!activeColumn) return;

    event.preventDefault();
    event.stopPropagation();

    const headerCell = event.currentTarget.closest("th");
    const meta = getColumnMeta(source, activeColumn.id);
    const startWidth = meta
      && getColumnSizing(meta, activeColumn) === "fill"
      && activeColumn.width == null
      && headerCell instanceof HTMLElement
      ? Math.round(headerCell.getBoundingClientRect().width)
      : resolveColumnWidth(source, activeColumn);
    const startX = event.clientX;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;

    resizeStateRef.current = { columnId, startX, startWidth };
    setResizingColumnId(columnId);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const resetInteractionStyles = () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    };

    const applyWidth = (clientX: number): ColumnConfig[] => {
      const state = resizeStateRef.current;
      if (!state) return localColumnsRef.current;

      const targetColumn = localColumnsRef.current.find((column) => column.id === state.columnId);
      if (!targetColumn) return localColumnsRef.current;

      const nextWidth = normalizeWidth(
        source,
        targetColumn,
        state.startWidth + (clientX - state.startX),
      );

      const nextColumns = localColumnsRef.current.map((column) =>
        column.id === state.columnId ? { ...column, width: nextWidth } : column,
      );

      commitLocalColumns(nextColumns);
      return nextColumns;
    };

    const finishResize = (clientX: number) => {
      const nextColumns = applyWidth(clientX);
      resizeStateRef.current = null;
      setResizingColumnId(null);
      resetInteractionStyles();
      persistColumns(nextColumns);
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      applyWidth(moveEvent.clientX);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      cleanupRef.current?.();
      finishResize(upEvent.clientX);
    };

    cleanupRef.current = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      resetInteractionStyles();
      cleanupRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }, [commitLocalColumns, persistColumns, source]);

  return {
    columns: localColumns,
    resizingColumnId,
    beginResize,
  };
}
