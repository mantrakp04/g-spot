import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { sidebarKeys } from "@/lib/query-keys";

const STORAGE_KEY = "gspot.sidebar.setup-checklist-dismissed";

export function useSetupChecklistDismissed() {
  const queryClient = useQueryClient();

  const { data: dismissed = false } = useQuery({
    queryKey: sidebarKeys.setupChecklistDismissed(),
    queryFn: () => {
      if (typeof window === "undefined") {
        return false;
      }

      return window.localStorage.getItem(STORAGE_KEY) === "true";
    },
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const dismiss = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "true");
    }

    queryClient.setQueryData(sidebarKeys.setupChecklistDismissed(), true);
  }, [queryClient]);

  return { dismissed, dismiss } as const;
}
