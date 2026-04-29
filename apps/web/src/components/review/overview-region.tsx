import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "@g-spot/ui/components/button";

import { Markdown } from "./markdown";

/** Graphite section heading: small uppercase-ish title row. */
export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-baseline gap-2 text-[13px] font-medium text-foreground">
      {children}
    </h2>
  );
}

export function ActivitySection({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const contentId = useId();

  return (
    <section>
      <h2 className="mb-3 flex items-center">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-controls={contentId}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? (
            <ChevronDown className="text-muted-foreground/70" />
          ) : (
            <ChevronRight className="text-muted-foreground/70" />
          )}
          Activity
        </Button>
      </h2>
      <div id={contentId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

export function DescriptionCard({
  markdown,
}: {
  markdown: string | null | undefined;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-card p-4">
      {markdown?.trim() ? (
        <Markdown>{markdown}</Markdown>
      ) : (
        <div className="text-[13px] italic text-muted-foreground/70">
          No description provided.
        </div>
      )}
    </div>
  );
}
