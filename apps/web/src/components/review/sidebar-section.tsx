import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";

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
        <button
          type="button"
          onClick={() => setOpen((s) => !s)}
          className="flex items-center gap-1.5 text-[13px] font-medium text-foreground"
        >
          {open ? (
            <ChevronDown className="size-3.5 text-muted-foreground/70" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground/70" />
          )}
          {label}
        </button>
        {action}
      </div>
      {open ? <div className="mt-2">{children}</div> : null}
    </section>
  );
}

export function SidebarAddButton({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex size-5 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-muted hover:text-foreground"
      aria-label="Add"
    >
      <Plus className="size-3.5" />
    </button>
  );
}

export function SidebarEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="text-[12px] italic text-muted-foreground/70">
      {children}
    </div>
  );
}
