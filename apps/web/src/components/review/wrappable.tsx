import { useState, type ReactNode } from "react";
import { ArrowLeftRight, WrapText } from "lucide-react";

import { Button } from "@g-spot/ui/components/button";
import { cn } from "@g-spot/ui/lib/utils";

/**
 * Wraps content (markdown, code blocks) with a hover-revealed toggle at the
 * top-right that flips between horizontal internal-scroll (default) and
 * line-wrap. Prevents long lines — URLs, one-liner code, diff dumps — from
 * blowing past their container.
 */
export function Wrappable({
  children,
  className,
  defaultWrap = false,
}: {
  children: ReactNode;
  className?: string;
  defaultWrap?: boolean;
}) {
  const [wrap, setWrap] = useState(defaultWrap);
  return (
    <div className={cn("group relative", className)}>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setWrap((w) => !w);
        }}
        className="absolute right-1 top-1 z-10 bg-card/80 opacity-0 backdrop-blur transition group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={wrap ? "Switch to scroll" : "Wrap lines"}
        title={wrap ? "Switch to scroll" : "Wrap lines"}
      >
        {wrap ? <ArrowLeftRight /> : <WrapText />}
      </Button>
      <div
        className={cn(
          wrap
            ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere] [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:break-words"
            : "overflow-x-auto",
        )}
      >
        {children}
      </div>
    </div>
  );
}
