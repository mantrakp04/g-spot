import { cn } from "@g-spot/ui/lib/utils";

/**
 * Truncates text in the middle, preserving both the start and end.
 * e.g. "mantrakp04 · stack-auth/stack-auth#1298" → "mantrakp04 · sta...th#1298"
 *
 * Uses a two-span flex approach: the first span truncates with CSS ellipsis,
 * the second span is shrink-0 to always show the last `endChars` characters.
 */
export function MiddleTruncate({
  text,
  endChars = 10,
  className,
}: {
  text: string;
  endChars?: number;
  className?: string;
}) {
  if (text.length <= endChars) {
    return <span className={className}>{text}</span>;
  }

  const start = text.slice(0, -endChars);
  const end = text.slice(-endChars);

  return (
    <span className={cn("flex w-full min-w-0 overflow-hidden whitespace-nowrap", className)}>
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {start}
      </span>
      <span className="shrink-0 whitespace-nowrap">{end}</span>
    </span>
  );
}
