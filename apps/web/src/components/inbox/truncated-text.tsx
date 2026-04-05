import type { ColumnTruncation } from "@g-spot/types/filters";
import { cn } from "@g-spot/ui/lib/utils";

import { MiddleTruncate } from "./middle-truncate";

export function TruncatedText({
  text,
  mode = "end",
  endChars = 6,
  className,
}: {
  text: string;
  mode?: ColumnTruncation;
  endChars?: number;
  className?: string;
}) {
  if (mode === "middle") {
    return <MiddleTruncate text={text} endChars={endChars} className={className} />;
  }

  return (
    <span
      className={cn(
        "block w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
        className,
      )}
    >
      {text}
    </span>
  );
}
