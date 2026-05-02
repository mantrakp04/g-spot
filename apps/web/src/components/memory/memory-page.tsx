import { useCallback, useEffect, useMemo, useState } from "react";

import { Skeleton } from "@g-spot/ui/components/skeleton";
import { motion } from "motion/react";
import {
  Brain,
  CircleDot,
  Eye,
  EyeOff,
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
  deadline: "#f59e0b",
  request: "#fb923c",
};

/** The canonical ordered list of all possible node types. */
const ALL_TYPES = [
  "belief",
  "concept",
  "deadline",
  "event",
  "fact",
  "organization",
  "person",
  "preference",
  "procedure",
  "project",
  "reflection",
  "request",
  "tool",
] as const;

const OVERLAY_CHROME =
  "border border-border bg-card/70 shadow-lg backdrop-blur-xl supports-[backdrop-filter]:bg-card/60";

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
      className={`absolute top-4 left-4 z-20 flex items-center gap-3 rounded-md px-3 py-2 ${OVERLAY_CHROME}`}
    >
      <div className="flex items-center gap-1.5">
        <CircleDot
          className="size-3"
          style={{ color: TYPE_COLORS.person }}
        />
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {entities}
        </span>
      </div>
      <div className="h-3 w-px bg-border" />
      <div className="flex items-center gap-1.5">
        <Layers
          className="size-3"
          style={{ color: TYPE_COLORS.concept }}
        />
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {observations}
        </span>
      </div>
      <div className="h-3 w-px bg-border" />
      <div className="flex items-center gap-1.5">
        <GitBranch className="size-3 text-muted-foreground" />
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {edges}
        </span>
      </div>
    </motion.div>
  );
}

function Legend({
  activeTypes,
  hiddenTypes,
  onToggleType,
  onShowAll,
  onHideAll,
}: {
  activeTypes: Set<string>;
  hiddenTypes: Set<string>;
  onToggleType: (type: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}) {
  const allVisible = hiddenTypes.size === 0;

  return (
    <motion.div
      initial={{ y: 10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.3 }}
      className={`absolute bottom-4 left-4 z-20 flex flex-wrap items-center gap-1.5 rounded-md px-3 py-2 ${OVERLAY_CHROME}`}
    >
      {ALL_TYPES.map((type) => {
        const presentInData = activeTypes.has(type);
        const hidden = hiddenTypes.has(type);
        const color = TYPE_COLORS[type] ?? "currentColor";

        return (
          <button
            key={type}
            type="button"
            disabled={!presentInData}
            onClick={() => onToggleType(type)}
            className={
              "flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-0.5 transition-all duration-200" +
              (presentInData
                ? " hover:bg-accent/50"
                : " cursor-default opacity-30")
            }
            style={{ opacity: !presentInData ? 0.3 : hidden ? 0.45 : 1 }}
          >
            <div
              className="size-2 rounded-full bg-muted transition-colors duration-200"
              style={hidden ? undefined : { backgroundColor: color }}
            />
            <span
              className={
                "text-[10px] transition-all duration-200" +
                (hidden
                  ? " text-muted-foreground/50 line-through"
                  : " text-muted-foreground")
              }
            >
              {type}
            </span>
          </button>
        );
      })}

      {/* Divider */}
      <div className="mx-1 h-3 w-px bg-border" />

      {/* Show/hide all toggle */}
      <button
        type="button"
        onClick={allVisible ? onHideAll : onShowAll}
        className="flex cursor-pointer items-center justify-center rounded-sm p-1 text-muted-foreground transition-colors duration-200 hover:bg-accent/50 hover:text-foreground"
      >
        {allVisible ? (
          <Eye className="size-3.5" />
        ) : (
          <EyeOff className="size-3.5" />
        )}
      </button>
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
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-lg border border-border bg-card">
          <Brain className="size-7 text-muted-foreground" />
        </div>
        <h3 className="mb-1 text-sm font-medium text-foreground">
          No memories yet
        </h3>
        <p className="max-w-[240px] text-[12px] leading-relaxed text-muted-foreground">
          Memories will appear here as the agent processes conversations and
          extracts knowledge.
        </p>
      </motion.div>
    </div>
  );
}

export function MemoryPage({ selectedMemoryId }: { selectedMemoryId?: string }) {
  const graphQuery = useMemoryGraph();
  const statsQuery = useMemoryStats();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (selectedMemoryId) {
      setSelectedNodeId(selectedMemoryId);
    }
  }, [selectedMemoryId]);

  const data = graphQuery.data;
  const isEmpty =
    !data ||
    (data.entities.length === 0 && data.observations.length === 0);

  // Build set of types present in the graph
  const activeTypes = useMemo(() => {
    if (!data) return new Set<string>();
    const types = new Set<string>();
    for (const e of data.entities) types.add(e.entity_type);
    for (const o of data.observations) types.add(o.observation_type);
    return types;
  }, [data]);

  // ---- Filter data by hidden types before passing to canvas / detail panel ----
  const filteredEntities = useMemo(() => {
    if (!data || hiddenTypes.size === 0) return data?.entities ?? [];
    return data.entities.filter((e) => !hiddenTypes.has(e.entity_type));
  }, [data, hiddenTypes]);

  const filteredObservations = useMemo(() => {
    if (!data || hiddenTypes.size === 0) return data?.observations ?? [];
    return data.observations.filter((o) => !hiddenTypes.has(o.observation_type));
  }, [data, hiddenTypes]);

  const filteredEdges = useMemo(() => {
    if (!data || hiddenTypes.size === 0) return data?.edges ?? [];
    const visibleIds = new Set([
      ...filteredEntities.map((e) => e.id),
      ...filteredObservations.map((o) => o.id),
    ]);
    return data.edges.filter(
      (e) => visibleIds.has(e.source_id) && visibleIds.has(e.target_id),
    );
  }, [data, hiddenTypes, filteredEntities, filteredObservations]);

  const filteredIsEmpty =
    filteredEntities.length === 0 && filteredObservations.length === 0;

  // Build graph nodes for detail panel (using filtered data)
  const allNodes = useMemo((): GraphNode[] => {
    const nodes: GraphNode[] = [];
    for (const e of filteredEntities) {
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
    for (const o of filteredObservations) {
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
  }, [filteredEntities, filteredObservations]);

  const allEdges = useMemo((): SimEdge[] => {
    const edges: SimEdge[] = [];
    const nodeIds = new Set(allNodes.map((n) => n.id));
    for (const e of filteredEdges) {
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
    for (const o of filteredObservations) {
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
  }, [filteredEdges, filteredObservations, allNodes]);

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

  const handleToggleType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const handleShowAll = useCallback(() => {
    setHiddenTypes(new Set());
  }, []);

  const handleHideAll = useCallback(() => {
    setHiddenTypes(new Set(activeTypes));
  }, [activeTypes]);

  if (graphQuery.isLoading) {
    return (
      <div className="relative h-full bg-background">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="space-y-3 text-center">
            <Skeleton className="mx-auto size-12 rounded-md" />
            <Skeleton className="mx-auto h-3 w-24" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden bg-background">
      {/* Back button */}
      <motion.div
        initial={{ x: -10, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        className="absolute top-4 left-1/2 z-20 -translate-x-1/2"
      >
        <div
          className={`flex items-center gap-3 rounded-md px-4 py-2 ${OVERLAY_CHROME}`}
        >
          <Brain
            className="size-4"
            style={{ color: TYPE_COLORS.person }}
          />
          <span className="text-[13px] font-medium tracking-tight text-foreground">
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
      <Legend
        activeTypes={activeTypes}
        hiddenTypes={hiddenTypes}
        onToggleType={handleToggleType}
        onShowAll={handleShowAll}
        onHideAll={handleHideAll}
      />

      {/* Canvas */}
      {isEmpty ? (
        <EmptyState />
      ) : filteredIsEmpty ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-[13px] text-muted-foreground">
            All node types are hidden
          </p>
        </div>
      ) : (
        <MemoryGraphCanvas
          entities={filteredEntities}
          observations={filteredObservations}
          edges={filteredEdges}
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
