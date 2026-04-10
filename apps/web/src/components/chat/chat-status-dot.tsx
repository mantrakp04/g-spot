import { cn } from "@g-spot/ui/lib/utils";

export type ChatRuntimeDotStatus =
  | "running"
  | "pending-approval"
  | "finished-unread";

type DotStyle = {
  background: string;
  ring: string;
  pulse: boolean;
  label: string;
};

/**
 * Inline-style colour table. We hand-roll `backgroundColor` and `boxShadow`
 * instead of using Tailwind utilities because the v4 JIT was inconsistently
 * including some of the colour classes used here — leaving the dot
 * background-less in production builds. Inline styles dodge that entirely.
 */
const STATUS_STYLES: Record<ChatRuntimeDotStatus, DotStyle> = {
  running: {
    background: "rgb(14, 165, 233)", // sky-500
    ring: "rgba(14, 165, 233, 0.25)",
    pulse: true,
    label: "Agent is running",
  },
  "pending-approval": {
    background: "rgb(245, 158, 11)", // amber-500
    ring: "rgba(245, 158, 11, 0.25)",
    pulse: true,
    label: "Waiting for your approval",
  },
  "finished-unread": {
    background: "rgb(16, 185, 129)", // emerald-500
    ring: "rgba(16, 185, 129, 0.25)",
    pulse: false,
    label: "Finished — open to acknowledge",
  },
};

interface ChatStatusDotProps {
  status: ChatRuntimeDotStatus | undefined | null;
  className?: string;
}

/**
 * The little dot rendered next to a chat row in the sidebar. Returns
 * `null` when there's no status, so callers can drop it in unconditionally.
 */
export function ChatStatusDot({ status, className }: ChatStatusDotProps) {
  if (!status) {
    return null;
  }

  const style = STATUS_STYLES[status];

  return (
    <span
      role="img"
      aria-label={style.label}
      title={style.label}
      style={{
        backgroundColor: style.background,
        boxShadow: `0 0 0 2px ${style.ring}`,
      }}
      className={cn(
        "block size-2 shrink-0 rounded-full",
        style.pulse && "animate-pulse",
        className,
      )}
    />
  );
}
