import type { GitHubLabel } from "@/lib/github/types";

export function relativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1d";
  return `${days}d`;
}

export function formatDate(date: string): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);

  if (days === 0) {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;

  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function fullDate(date: string): string {
  return new Date(date).toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function GitHubLabels({
  labels,
  max = 3,
}: {
  labels: GitHubLabel[];
  max?: number;
}) {
  if (labels.length === 0) return null;
  const visible = labels.slice(0, max);
  const extra = labels.length - max;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((label) => (
        <span
          key={label.name}
          className="inline-flex max-w-[8rem] items-center truncate rounded-full px-1.5 py-0 text-[10px] font-medium leading-4"
          style={{
            backgroundColor: `#${label.color}20`,
            color: `#${label.color}`,
            border: `1px solid #${label.color}40`,
          }}
        >
          {label.name}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[10px] text-muted-foreground">+{extra}</span>
      )}
    </div>
  );
}
