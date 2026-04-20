import { createFileRoute, Link } from "@tanstack/react-router";
import { Inbox } from "lucide-react";

export const Route = createFileRoute("/review/")({
  component: ReviewIndex,
});

function ReviewIndex() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <Inbox
        className="size-10 text-muted-foreground/70"
        strokeWidth={1.25}
      />
      <div className="space-y-1">
        <h1 className="text-[17px] font-medium">No review open</h1>
        <p className="text-[13px] text-muted-foreground">
          Click a PR or issue in the inbox to open it here.
        </p>
      </div>
      <Link
        to="/"
        className="rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
      >
        Go to inbox
      </Link>
    </div>
  );
}
