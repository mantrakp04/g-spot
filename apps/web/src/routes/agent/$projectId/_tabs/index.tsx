import { createFileRoute } from "@tanstack/react-router";

/**
 * The project's bare URL renders nothing of its own — the parent `_tabs`
 * layout paints the active tab (or the empty state when no tabs are open).
 */
export const Route = createFileRoute("/agent/$projectId/_tabs/")({
  component: () => null,
});
