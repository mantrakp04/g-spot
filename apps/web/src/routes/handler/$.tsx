import { StackHandler } from "@stackframe/react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/handler/$")({
  component: HandlerComponent,
});

function HandlerComponent() {
  return <StackHandler fullPage />;
}
