import { createFileRoute, Outlet } from "@tanstack/react-router";

import { DiffsProvider } from "@/components/review/diffs-provider";

import "./review/graphite-tokens.css";

export const Route = createFileRoute("/review")({
  component: ReviewLayout,
});

function ReviewLayout() {
  return (
    <DiffsProvider>
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <Outlet />
      </div>
    </DiffsProvider>
  );
}
