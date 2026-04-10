import { useCallback, useMemo, useState } from "react";

import { Skeleton } from "@g-spot/ui/components/skeleton";
import { motion } from "motion/react";
import {
  Brain,
  CircleDot,
  GitBranch,
  Layers,
} from "lucide-react";

import { useMemoryGraph, useMemoryStats } from "@/hooks/use-memory";
import {
  MemoryGraphCanvas,
  type GraphNode,
  type SimEdge,
} from "./memory-graph-canvas";
import { MemoryDetailPanel } from "./memory-detail-panel";

const TYPE_COLORS: Record<string, string> = {
  person: "#22d3ee",
  organization: "#818cf8",
  project: "#34d399",
  concept: "#a78bfa",
  tool: "#f97316",
  event: "#fbbf24",
  preference: "#f472b6",
  fact: "#60a5fa",
  belief: "#c084fc",
  procedure: "#2dd4bf",
  reflection: "#e879f9",
};

function StatsOverlay({
  entities,
  observations,
  edges,
}: {
  entities: number;
  observations: number;
  edges: number;
}) {
  return (
    <motion.div
      initial={{ y: -10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.2 }}
      className="memory-stats-bar absolute top-4 left-4 z-20 flex items-center gap-3 rounded-lg px-3 py-2"
    >
      <div className="flex items-center gap-1.5">
        <CircleDot className="size-3 text-cyan-400/60" />
        <span className="font-mono text-[11px] tabular-nums text-white/50">
          {entities}
        </span>
      </div>
      <div className="h-3 w-px bg-white/8" />
      <div className="flex items-center gap-1.5">
        <Layers className="size-3 text-violet-400/60" />
        <span className="font-mono text-[11px] tabular-nums text-white/50">
          {observations}
        </span>
      </div>
      <div className="h-3 w-px bg-white/8" />
      <div className="flex items-center gap-1.5">
        <GitBranch className="size-3 text-slate-400/60" />
        <span className="font-mono text-[11px] tabular-nums text-white/50">
          {edges}
        </span>
      </div>
    </motion.div>
  );
}

function Legend({ types }: { types: string[] }) {
  if (types.length === 0) return null;

  return (
    <motion.div
      initial={{ y: 10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.3 }}
      className="memory-legend absolute bottom-4 left-4 z-20 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2"
    >
      {types.map((type) => (
        <div key={type} className="flex items-center gap-1.5">
          <div
            className="size-2 rounded-full"
            style={{ backgroundColor: TYPE_COLORS[type] ?? "#94a3b8" }}
          />
          <span className="text-[10px] text-white/35">{type}</span>
        </div>
      ))}
    </motion.div>
  );
}

function EmptyState() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="text-center"
      >
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl border border-white/5 bg-white/[0.02]">
          <Brain className="size-7 text-white/15" />
        </div>
        <h3 className="mb-1 text-sm font-medium text-white/40">
          No memories yet
        </h3>
        <p className="max-w-[240px] text-[12px] leading-relaxed text-white/20">
          Memories will appear here as the agent processes conversations and
          extracts knowledge.
        </p>
      </motion.div>
    </div>
  );
}

export function MemoryPage() {
  const graphQuery = useMemoryGraph();
  const statsQuery = useMemoryStats();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const data = graphQuery.data;
  const isEmpty =
    !data ||
    (data.entities.length === 0 && data.observations.length === 0);

  // Build flat list of types present in the graph
  const activeTypes = useMemo(() => {
    if (!data) return [];
    const types = new Set<string>();
    for (const e of data.entities) types.add(e.entity_type);
    for (const o of data.observations) types.add(o.observation_type);
    return Array.from(types).sort();
  }, [data]);

  // Build graph nodes for detail panel
  const allNodes = useMemo((): GraphNode[] => {
    if (!data) return [];
    const nodes: GraphNode[] = [];
    for (const e of data.entities) {
      nodes.push({
        id: e.id,
        kind: "entity",
        label: e.name,
        subtype: e.entity_type,
        salience: e.salience,
        data: e,
        x: 0, y: 0, vx: 0, vy: 0, fx: 0, fy: 0,
        radius: 14, pinned: false,
      });
    }
    for (const o of data.observations) {
      nodes.push({
        id: o.id,
        kind: "observation",
        label: o.content.length > 40 ? o.content.slice(0, 37) + "..." : o.content,
        subtype: o.observation_type,
        salience: o.salience,
        data: o,
        x: 0, y: 0, vx: 0, vy: 0, fx: 0, fy: 0,
        radius: 8, pinned: false,
      });
    }
    return nodes;
  }, [data]);

  const allEdges = useMemo((): SimEdge[] => {
    if (!data) return [];
    const edges: SimEdge[] = [];
    const nodeIds = new Set(allNodes.map((n) => n.id));
    for (const e of data.edges) {
      if (nodeIds.has(e.source_id) && nodeIds.has(e.target_id)) {
        edges.push({
          id: e.id,
          source: e.source_id,
          target: e.target_id,
          weight: e.weight,
          label: e.relationship_type,
        });
      }
    }
    for (const o of data.observations) {
      for (const entityId of o.entityIds) {
        if (nodeIds.has(entityId)) {
          edges.push({
            id: `obs-${o.id}-${entityId}`,
            source: o.id,
            target: entityId,
            weight: 0.3,
            label: "",
          });
        }
      }
    }
    return edges;
  }, [data, allNodes]);

  const selectedNode = useMemo(
    () => allNodes.find((n) => n.id === selectedNodeId) ?? null,
    [allNodes, selectedNodeId],
  );

  const handleSelect = useCallback((id: string | null) => {
    setSelectedNodeId(id);
  }, []);

  const handleHover = useCallback((id: string | null) => {
    setHoveredNodeId(id);
  }, []);

  if (graphQuery.isLoading) {
    return (
      <div className="relative h-full bg-[#08080e]">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="space-y-3 text-center">
            <Skeleton className="mx-auto size-12 rounded-xl bg-white/5" />
            <Skeleton className="mx-auto h-3 w-24 bg-white/5" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden bg-[#08080e]">
      {/* Back button */}
      <motion.div
        initial={{ x: -10, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        className="absolute top-4 left-1/2 z-20 -translate-x-1/2"
      >
        <div className="memory-title-bar flex items-center gap-3 rounded-lg px-4 py-2">
          <Brain className="size-4 text-cyan-400/50" />
          <span className="text-[13px] font-medium tracking-tight text-white/60">
            Memory Graph
          </span>
        </div>
      </motion.div>

      {/* Stats */}
      {!isEmpty && statsQuery.data && (
        <StatsOverlay
          entities={statsQuery.data.activeEntities}
          observations={statsQuery.data.activeObservations}
          edges={statsQuery.data.activeEdges}
        />
      )}

      {/* Legend */}
      <Legend types={activeTypes} />

      {/* Canvas */}
      {isEmpty ? (
        <EmptyState />
      ) : (
        <MemoryGraphCanvas
          entities={data.entities}
          observations={data.observations}
          edges={data.edges}
          selectedNodeId={selectedNodeId}
          hoveredNodeId={hoveredNodeId}
          onSelectNode={handleSelect}
          onHoverNode={handleHover}
        />
      )}

      {/* Detail panel */}
      <MemoryDetailPanel
        node={selectedNode}
        edges={allEdges}
        nodes={allNodes}
        onClose={() => setSelectedNodeId(null)}
      />
    </div>
  );
}
