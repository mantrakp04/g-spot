import type { ReactNode } from "react";

import { Markdown } from "./markdown";

/** Graphite section heading: small uppercase-ish title row. */
export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-baseline gap-2 text-[13px] font-medium text-foreground">
      {children}
    </h2>
  );
}

export function DescriptionCard({
  markdown,
}: {
  markdown: string | null | undefined;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card p-4">
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
