import { useEffect } from "react";
import { useUser } from "@stackframe/react";

import { trpcClient } from "@/utils/trpc";

const HEARTBEAT_INTERVAL_MS = 30_000;

export function RelayHeartbeat() {
  const user = useUser();
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;

    async function ping() {
      try {
        await trpcClient.relay.heartbeat.mutate();
      } catch {
        // Heartbeat is best-effort; the next tick/focus event retries.
      }
    }

    void ping();
    const interval = setInterval(() => void ping(), HEARTBEAT_INTERVAL_MS);
    const onFocus = () => void ping();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void ping();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId]);

  return null;
}
