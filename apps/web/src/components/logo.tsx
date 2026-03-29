import type { ComponentProps } from "react";

import { cn } from "@g-spot/ui/lib/utils";

export function Logo({ className, alt = "", ...props }: ComponentProps<"img">) {
  return (
    <img
      src="/logo.png"
      alt={alt}
      width={100}
      height={100}
      draggable={false}
      className={cn("size-8 shrink-0 object-contain", className)}
      {...props}
    />
  );
}
