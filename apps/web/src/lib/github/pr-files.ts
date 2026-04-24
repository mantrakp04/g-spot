export type NormalizablePRFile = {
  filename: string;
};

export function normalizePullRequestFiles<T extends NormalizablePRFile>(
  files: readonly T[],
  context: {
    owner: string;
    repo: string;
    number: number;
    rangeKey?: string;
  },
): T[] {
  const byName = new Map<string, T>();
  const duplicates = new Set<string>();

  for (const file of files) {
    if (byName.has(file.filename)) duplicates.add(file.filename);
    byName.set(file.filename, file);
  }

  if (duplicates.size > 0 && import.meta.env.DEV) {
    console.warn("[github-pr-files] duplicate PR file entries", {
      ...context,
      duplicates: Array.from(duplicates),
    });
  }

  return Array.from(byName.values());
}
