import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";

export function useMemoryGraph() {
  return useQuery(trpc.memory.graph.queryOptions());
}

export function useMemoryStats() {
  return useQuery(trpc.memory.stats.queryOptions());
}
