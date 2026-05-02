import { createFileRoute } from "@tanstack/react-router";

import { MemoryPage } from "@/components/memory/memory-page";
import { AppLayout } from "@/components/shell/app-layout";

type MemorySearch = {
  memoryId?: string;
};

export const Route = createFileRoute("/memory")({
  validateSearch: (search: Record<string, unknown>): MemorySearch => ({
    memoryId: typeof search.memoryId === "string" ? search.memoryId : undefined,
  }),
  component: MemoryRoute,
});

function MemoryRoute() {
  const routeSearch = Route.useSearch();

  return (
    <AppLayout>
      <MemoryPage selectedMemoryId={routeSearch.memoryId} />
    </AppLayout>
  );
}
