import { useEffect } from "react";
import { useUser } from "@stackframe/react";

import { trpcClient } from "@/utils/trpc";

const HEARTBEAT_INTERVAL_MS = 5 * 60_000;

export function RelayHeartbeat() {
  const user = useUser();
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;

    async function ping() {
      try {
        await trpcClient.relay.heartbeat.mutate();
      } catch {
        // Heartbeat is best-effort; the next scheduled tick retries.
      }
    }

    void ping();
    const interval = setInterval(() => void ping(), HEARTBEAT_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [userId]);

  return null;
}
