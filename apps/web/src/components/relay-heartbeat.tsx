import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { useUser } from "@hexclave/react";

import { relayStatusAtom } from "@/lib/relay-status";
import { trpcClient } from "@/utils/trpc";

const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
const FORCE_RECONNECT_EVERY = 10;

export function RelayHeartbeat() {
  const user = useUser();
  const userId = user?.id;
  const setStatus = useSetAtom(relayStatusAtom);

  const attemptRef = useRef(0);

  useEffect(() => {
    if (!userId) {
      setStatus("unknown");
      return;
    }

    attemptRef.current = 0;

    async function ping() {
      attemptRef.current += 1;
      const forceReconnect = attemptRef.current % FORCE_RECONNECT_EVERY === 0;
      try {
        const result = await trpcClient.relay.heartbeat.mutate({ forceReconnect });
        setStatus(result.status);
      } catch {
        setStatus("closed");
      }
    }

    void ping();
    const interval = setInterval(() => void ping(), HEARTBEAT_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [userId, setStatus]);

  return null;
}
