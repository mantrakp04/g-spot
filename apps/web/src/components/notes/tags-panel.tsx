import { Loader2 } from "lucide-react";

import { useNoteTags } from "@/hooks/use-notes";

interface TagsPanelProps {
  activeTag: string | null;
  onSelectTag: (tag: string | null) => void;
}

/**
 * Flat list of every inline `#tag` across the vault. Selecting a tag drives the
 * tag-filtered note list; selecting again clears the filter.
 */
export function TagsPanel({ activeTag, onSelectTag }: TagsPanelProps) {
  const tagsQuery = useNoteTags();
  const tags = tagsQuery.data ?? [];

  if (tagsQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> loading tags…
      </div>
    );
  }

  if (tags.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        No tags yet — type <code className="rounded bg-muted px-1">#tag</code>{" "}
        anywhere in a note.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 p-2">
      {tags.map(({ tag, count }) => {
        const isActive = activeTag === tag;
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onSelectTag(isActive ? null : tag)}
            className={`flex items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-muted/60 ${
              isActive ? "bg-muted text-primary" : ""
            }`}
          >
            <span className="truncate">#{tag}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
