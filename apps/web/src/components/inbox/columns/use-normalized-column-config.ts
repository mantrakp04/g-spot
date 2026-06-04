import { useRef } from "react";

import type { ColumnConfig, SectionSource } from "@g-spot/types/filters";
import { getDefaultColumns, normalizeColumns } from "@g-spot/types/filters";

type CacheEntry = {
  key: string;
  source: SectionSource;
  columns: ColumnConfig[];
};

export function useNormalizedColumnConfig(
  source: SectionSource,
  columns: ColumnConfig[] | undefined,
) {
  const cacheRef = useRef<CacheEntry | null>(null);
  const key = columns ? JSON.stringify(columns) : "";

  if (cacheRef.current?.source !== source || cacheRef.current.key !== key) {
    cacheRef.current = {
      key,
      source,
      columns: normalizeColumns(
        source,
        columns && columns.length > 0 ? columns : getDefaultColumns(source),
      ),
    };
  }

  return cacheRef.current.columns;
}
