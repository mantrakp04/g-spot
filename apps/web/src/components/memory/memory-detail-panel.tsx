import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import { Separator } from "@g-spot/ui/components/separator";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";

import type { GraphEntity, GraphNode, GraphObservation, SimEdge } from "./memory-graph-canvas";

interface MemoryDetailPanelProps {
  node: GraphNode | null;
  edges: SimEdge[];
  nodes: GraphNode[];
  onClose: () => void;
}

function formatAge(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function SalienceBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full bg-primary"
          style={{ opacity: 0.6 + value * 0.4 }}
          initial={{ width: 0 }}
          animate={{ width: `${value * 100}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
      <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  );
}

const LABEL_CLASSES =
  "mb-1 block text-[10px] uppercase tracking-[0.15em] text-muted-foreground";

function EntityDetail({
  entity,
  edges,
  nodes,
}: {
  entity: GraphEntity;
  edges: SimEdge[];
  nodes: GraphNode[];
}) {
  const connectedEdges = edges.filter(
    (e) => e.source === entity.id || e.target === entity.id,
  );
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="space-y-4">
      <div>
        <span className={LABEL_CLASSES}>Description</span>
        <p className="text-[13px] leading-relaxed text-foreground">
          {entity.description}
        </p>
      </div>

      {entity.aliases.length > 0 && (
        <div>
          <span className={LABEL_CLASSES}>Aliases</span>
          <div className="flex flex-wrap gap-1">
            {entity.aliases.map((a) => (
              <Badge key={a} variant="outline" className="text-[10px]">
                {a}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <Separator />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className={LABEL_CLASSES}>Salience</span>
          <SalienceBar value={entity.salience} />
        </div>
        <div>
          <span className={LABEL_CLASSES}>Decay rate</span>
          <span className="font-mono text-xs text-foreground">
            {entity.decay_rate.toFixed(4)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-[11px] text-muted-foreground">
        <div>
          <span className={LABEL_CLASSES}>Created</span>
          {formatAge(entity.created_at)}
        </div>
        <div>
          <span className={LABEL_CLASSES}>Last accessed</span>
          {formatAge(entity.last_accessed_at)}
        </div>
      </div>

      {connectedEdges.length > 0 && (
        <>
          <Separator />
          <div>
            <span className={LABEL_CLASSES}>
              Connections ({connectedEdges.length})
            </span>
            <div className="space-y-1.5">
              {connectedEdges.map((edge) => {
                const otherId =
                  edge.source === entity.id ? edge.target : edge.source;
                const other = nodeMap.get(otherId);
                return (
                  <div
                    key={edge.id}
                    className="flex items-center gap-2 rounded-sm border border-border bg-muted/40 px-2.5 py-1.5"
                  >
                    <div
                      className="size-2 shrink-0 rounded-full bg-muted-foreground"
                      style={
                        other
                          ? { backgroundColor: getTypeColor(other.subtype) }
                          : undefined
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
                      {other?.label ?? otherId.slice(0, 8)}
                    </span>
                    {edge.label && (
                      <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                        {edge.label}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ObservationDetail({
  observation,
  edges: _edges,
  nodes,
}: {
  observation: GraphObservation;
  edges: SimEdge[];
  nodes: GraphNode[];
}) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const linkedEntities = observation.entityIds
    .map((id) => nodeMap.get(id))
    .filter(Boolean) as GraphNode[];

  return (
    <div className="space-y-4">
      <div>
        <span className={LABEL_CLASSES}>Content</span>
        <p className="text-[13px] leading-relaxed text-foreground">
          {observation.content}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className={LABEL_CLASSES}>Salience</span>
          <SalienceBar value={observation.salience} />
        </div>
        <div>
          <span className={LABEL_CLASSES}>Confidence</span>
          <SalienceBar value={observation.confidence} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-[11px] text-muted-foreground">
        <div>
          <span className={LABEL_CLASSES}>Created</span>
          {formatAge(observation.created_at)}
        </div>
        <div>
          <span className={LABEL_CLASSES}>Last accessed</span>
          {formatAge(observation.last_accessed_at)}
        </div>
      </div>

      {linkedEntities.length > 0 && (
        <>
          <Separator />
          <div>
            <span className={LABEL_CLASSES}>Linked entities</span>
            <div className="flex flex-wrap gap-1.5">
              {linkedEntities.map((n) => (
                <Badge
                  key={n.id}
                  variant="outline"
                  className="gap-1.5 text-[10px]"
                >
                  <div
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: getTypeColor(n.subtype) }}
                  />
                  {n.label}
                </Badge>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

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

function getTypeColor(subtype: string): string {
  return TYPE_COLORS[subtype] ?? "currentColor";
}

export function MemoryDetailPanel({
  node,
  edges,
  nodes,
  onClose,
}: MemoryDetailPanelProps) {
  return (
    <AnimatePresence>
      {node && (
        <motion.div
          key={node.id}
          initial={{ x: 20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 20, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="absolute top-4 right-4 bottom-4 z-30 flex w-[320px] flex-col overflow-hidden rounded-md border border-border bg-card/80 shadow-xl backdrop-blur-xl supports-[backdrop-filter]:bg-card/70"
        >
          {/* Header */}
          <div className="flex items-start gap-3 border-b border-border p-4">
            <div
              className="mt-0.5 size-3 shrink-0 rounded-full"
              style={{
                backgroundColor: getTypeColor(node.subtype),
                boxShadow: `0 0 8px ${getTypeColor(node.subtype)}40`,
              }}
            />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-medium text-foreground">
                {node.kind === "entity"
                  ? (node.data as GraphEntity).name
                  : "Observation"}
              </h3>
              <div className="mt-0.5 flex items-center gap-1.5">
                <Badge
                  variant="outline"
                  className="text-[9px] uppercase tracking-wider"
                >
                  {node.subtype}
                </Badge>
                <Badge
                  variant="outline"
                  className="text-[9px] uppercase tracking-wider"
                >
                  {node.kind}
                </Badge>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="shrink-0"
            >
              <X className="size-3.5" />
            </Button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4">
            {node.kind === "entity" ? (
              <EntityDetail
                entity={node.data as GraphEntity}
                edges={edges}
                nodes={nodes}
              />
            ) : (
              <ObservationDetail
                observation={node.data as GraphObservation}
                edges={edges}
                nodes={nodes}
              />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
