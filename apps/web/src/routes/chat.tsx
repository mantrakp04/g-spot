import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/chat")({
  component: ChatLayout,
});

function ChatLayout() {
  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
