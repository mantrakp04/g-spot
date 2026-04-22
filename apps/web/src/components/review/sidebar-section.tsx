import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";

import { Button } from "@g-spot/ui/components/button";

export function SidebarSection({
  label,
  action,
  defaultOpen = true,
  children,
}: {
  label: string;
  action?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-border/50 py-3 last:border-b-0">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen((s) => !s)}
          className="-ml-1 px-1 text-[13px] font-medium text-foreground"
        >
          {open ? (
            <ChevronDown className="text-muted-foreground/70" />
          ) : (
            <ChevronRight className="text-muted-foreground/70" />
          )}
          {label}
        </Button>
        {action}
      </div>
      {open ? <div className="mt-2">{children}</div> : null}
    </section>
  );
}

export function SidebarAddButton({ onClick }: { onClick?: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      aria-label="Add"
    >
      <Plus />
    </Button>
  );
}

export function SidebarEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="text-[12px] italic text-muted-foreground/70">
      {children}
    </div>
  );
}
