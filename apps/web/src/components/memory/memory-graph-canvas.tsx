import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface GraphEntity {
  id: string;
  name: string;
  entity_type: string;
  description: string;
  aliases: string[];
  salience: number;
  decay_rate: number;
  created_at: number;
  updated_at: number;
  last_accessed_at: number;
}

export interface GraphObservation {
  id: string;
  content: string;
  observation_type: string;
  confidence: number;
  salience: number;
  entityIds: string[];
  created_at: number;
  updated_at: number;
  last_accessed_at: number;
}

export interface GraphEdge {
  id: string;
  source_id: string;
  target_id: string;
  source_type: string;
  target_type: string;
  relationship_type: string;
  description: string;
  weight: number;
  confidence: number;
  triplet_text: string;
  created_at: number;
}

export type GraphNode = {
  id: string;
  kind: "entity" | "observation";
  label: string;
  subtype: string;
  salience: number;
  data: GraphEntity | GraphObservation;
  // simulation state
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number;
  fy: number;
  radius: number;
  pinned: boolean;
};

export type SimEdge = {
  id: string;
  source: string;
  target: string;
  weight: number;
  label: string;
};

interface MemoryGraphCanvasProps {
  entities: GraphEntity[];
  observations: GraphObservation[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onHoverNode: (id: string | null) => void;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------
const TYPE_COLORS: Record<string, string> = {
  person: "#22d3ee",      // cyan
  organization: "#818cf8", // indigo
  project: "#34d399",     // emerald
  concept: "#a78bfa",     // violet
  tool: "#f97316",        // orange
  event: "#fbbf24",       // amber
  preference: "#f472b6",  // pink
  deadline: "#f59e0b",    // amber
  request: "#fb923c",     // orange-400
  // Observation types
  fact: "#60a5fa",        // blue
  belief: "#c084fc",      // purple
  procedure: "#2dd4bf",   // teal
  reflection: "#e879f9",  // fuchsia
};

function getNodeColor(subtype: string): string {
  return TYPE_COLORS[subtype] ?? "#94a3b8";
}

// ---------------------------------------------------------------------------
// Force simulation
// ---------------------------------------------------------------------------
const REPULSION = 800;
const ATTRACTION = 0.005;
const DAMPING = 0.92;
const CENTER_GRAVITY = 0.01;
const EDGE_LENGTH = 160;

function initNodes(
  entities: GraphEntity[],
  observations: GraphObservation[],
): GraphNode[] {
  const nodes: GraphNode[] = [];
  const cx = 0;
  const cy = 0;
  const total = entities.length + observations.length;

  entities.forEach((e, i) => {
    const angle = (2 * Math.PI * i) / Math.max(total, 1);
    const r = 100 + Math.random() * 200;
    nodes.push({
      id: e.id,
      kind: "entity",
      label: e.name,
      subtype: e.entity_type,
      salience: e.salience,
      data: e,
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      vx: 0,
      vy: 0,
      fx: 0,
      fy: 0,
      radius: 14 + e.salience * 16,
      pinned: false,
    });
  });

  observations.forEach((o, i) => {
    const angle = (2 * Math.PI * (entities.length + i)) / Math.max(total, 1);
    const r = 150 + Math.random() * 250;
    nodes.push({
      id: o.id,
      kind: "observation",
      label: o.content.length > 40 ? o.content.slice(0, 37) + "..." : o.content,
      subtype: o.observation_type,
      salience: o.salience,
      data: o,
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      vx: 0,
      vy: 0,
      fx: 0,
      fy: 0,
      radius: 6 + o.salience * 8,
      pinned: false,
    });
  });

  return nodes;
}

function buildEdges(
  graphEdges: GraphEdge[],
  observations: GraphObservation[],
  nodeIds: Set<string>,
): SimEdge[] {
  const edges: SimEdge[] = [];

  // Graph edges
  for (const e of graphEdges) {
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

  // Observation → entity links
  for (const o of observations) {
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
}

function simulate(nodes: GraphNode[], edges: SimEdge[]) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Reset forces
  for (const n of nodes) {
    n.fx = 0;
    n.fy = 0;
  }

  // Center gravity
  for (const n of nodes) {
    n.fx -= n.x * CENTER_GRAVITY;
    n.fy -= n.y * CENTER_GRAVITY;
  }

  // Repulsion (all pairs)
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distSq = dx * dx + dy * dy + 1;
      const force = REPULSION / distSq;
      const fx = dx * force;
      const fy = dy * force;
      a.fx -= fx;
      a.fy -= fy;
      b.fx += fx;
      b.fy += fy;
    }
  }

  // Attraction along edges
  for (const e of edges) {
    const a = nodeMap.get(e.source);
    const b = nodeMap.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) + 1;
    const displacement = dist - EDGE_LENGTH;
    const force = displacement * ATTRACTION * e.weight;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    a.fx += fx;
    a.fy += fy;
    b.fx -= fx;
    b.fy -= fy;
  }

  // Velocity Verlet integration
  for (const n of nodes) {
    if (n.pinned) continue;
    n.vx = (n.vx + n.fx) * DAMPING;
    n.vy = (n.vy + n.fy) * DAMPING;
    n.x += n.vx;
    n.y += n.vy;
  }
}

// ---------------------------------------------------------------------------
// Canvas renderer
// ---------------------------------------------------------------------------

export function MemoryGraphCanvas({
  entities,
  observations,
  edges: graphEdges,
  selectedNodeId,
  hoveredNodeId,
  onSelectNode,
  onHoverNode,
}: MemoryGraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<SimEdge[]>([]);
  const frameRef = useRef<number>(0);

  // Camera state
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });
  const dragRef = useRef<{
    type: "pan" | "node";
    startX: number;
    startY: number;
    nodeId?: string;
    startCamX: number;
    startCamY: number;
  } | null>(null);

  // Store latest callbacks in refs
  const onSelectRef = useRef(onSelectNode);
  onSelectRef.current = onSelectNode;
  const onHoverRef = useRef(onHoverNode);
  onHoverRef.current = onHoverNode;
  const selectedRef = useRef(selectedNodeId);
  selectedRef.current = selectedNodeId;
  const hoveredRef = useRef(hoveredNodeId);
  hoveredRef.current = hoveredNodeId;

  // Initialize simulation nodes and edges when data changes
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    nodesRef.current = initNodes(entities, observations);
    const nodeIds = new Set(nodesRef.current.map((n) => n.id));
    edgesRef.current = buildEdges(graphEdges, observations, nodeIds);
    setInitialized(true);
  }, [entities, observations, graphEdges]);

  // Screen to world coords
  const screenToWorld = useCallback((sx: number, sy: number) => {
    const cam = cameraRef.current;
    return {
      x: (sx - window.innerWidth / 2) / cam.zoom - cam.x,
      y: (sy - window.innerHeight / 2) / cam.zoom - cam.y,
    };
  }, []);

  // Find node at world coords
  const hitTest = useCallback((wx: number, wy: number): GraphNode | null => {
    // Reverse order: top-drawn nodes first
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const n = nodesRef.current[i]!;
      const dx = wx - n.x;
      const dy = wy - n.y;
      const hitRadius = n.radius + 4;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) return n;
    }
    return null;
  }, []);

  // Mouse events
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      // Check if click lands on the minimap
      const miniHit = minimapHitToWorld(
        sx,
        sy,
        nodesRef.current,
        canvas.clientWidth,
        selectedRef.current != null,
      );
      if (miniHit) {
        // Pan camera so this world point is centered
        const cam = cameraRef.current;
        cam.x = -miniHit.wx;
        cam.y = -miniHit.wy;
        return; // consume the event
      }

      const { x: wx, y: wy } = screenToWorld(sx + rect.left, sy + rect.top);
      const hit = hitTest(wx, wy);

      if (hit) {
        dragRef.current = {
          type: "node",
          startX: e.clientX,
          startY: e.clientY,
          nodeId: hit.id,
          startCamX: cameraRef.current.x,
          startCamY: cameraRef.current.y,
        };
        hit.pinned = true;
      } else {
        dragRef.current = {
          type: "pan",
          startX: e.clientX,
          startY: e.clientY,
          startCamX: cameraRef.current.x,
          startCamY: cameraRef.current.y,
        };
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();

      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;

        if (dragRef.current.type === "pan") {
          const cam = cameraRef.current;
          cam.x = dragRef.current.startCamX + dx / cam.zoom;
          cam.y = dragRef.current.startCamY + dy / cam.zoom;
        } else if (dragRef.current.type === "node" && dragRef.current.nodeId) {
          const node = nodesRef.current.find(
            (n) => n.id === dragRef.current?.nodeId,
          );
          if (node) {
            const { x: wx, y: wy } = screenToWorld(
              e.clientX - rect.left + rect.left,
              e.clientY - rect.top + rect.top,
            );
            node.x = wx;
            node.y = wy;
            node.vx = 0;
            node.vy = 0;
          }
        }
        return;
      }

      // Hover detection
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { x: wx, y: wy } = screenToWorld(sx + rect.left, sy + rect.top);
      const hit = hitTest(wx, wy);
      const newHoverId = hit?.id ?? null;
      if (newHoverId !== hoveredRef.current) {
        onHoverRef.current(newHoverId);
      }
      canvas.style.cursor = hit ? "pointer" : "grab";
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        const moved = Math.abs(dx) + Math.abs(dy) > 3;

        if (dragRef.current.type === "node" && dragRef.current.nodeId) {
          const node = nodesRef.current.find(
            (n) => n.id === dragRef.current?.nodeId,
          );
          if (node) node.pinned = false;
          if (!moved) {
            onSelectRef.current(dragRef.current.nodeId);
          }
        } else if (!moved) {
          onSelectRef.current(null);
        }

        dragRef.current = null;
      }
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = cameraRef.current;
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      cam.zoom = Math.max(0.15, Math.min(5, cam.zoom * factor));
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [screenToWorld, hitTest]);

  // Render loop
  useEffect(() => {
    if (!initialized) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;

    const render = () => {
      if (!running) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Simulation tick
      simulate(nodesRef.current, edgesRef.current);

      const cam = cameraRef.current;
      const halfW = w / 2;
      const halfH = h / 2;

      // Clear
      ctx.fillStyle = "#08080e";
      ctx.fillRect(0, 0, w, h);

      // Radial gradient background
      const bgGrad = ctx.createRadialGradient(halfW, halfH, 0, halfW, halfH, Math.max(w, h) * 0.7);
      bgGrad.addColorStop(0, "rgba(20, 20, 40, 0.5)");
      bgGrad.addColorStop(1, "rgba(8, 8, 14, 0)");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Grid dots
      ctx.save();
      ctx.translate(halfW, halfH);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(cam.x, cam.y);

      const gridSize = 40;
      const viewLeft = -halfW / cam.zoom - cam.x;
      const viewTop = -halfH / cam.zoom - cam.y;
      const viewRight = halfW / cam.zoom - cam.x;
      const viewBottom = halfH / cam.zoom - cam.y;
      const startX = Math.floor(viewLeft / gridSize) * gridSize;
      const startY = Math.floor(viewTop / gridSize) * gridSize;

      ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
      for (let gx = startX; gx <= viewRight; gx += gridSize) {
        for (let gy = startY; gy <= viewBottom; gy += gridSize) {
          ctx.beginPath();
          ctx.arc(gx, gy, 0.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const nodes = nodesRef.current;
      const simEdges = edgesRef.current;
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      // Draw edges
      for (const e of simEdges) {
        const a = nodeMap.get(e.source);
        const b = nodeMap.get(e.target);
        if (!a || !b) continue;

        const isHighlighted =
          selectedRef.current === a.id ||
          selectedRef.current === b.id ||
          hoveredRef.current === a.id ||
          hoveredRef.current === b.id;

        const alpha = isHighlighted
          ? 0.5 + e.weight * 0.4
          : 0.08 + e.weight * 0.15;

        // Curved edge
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const curve = dist * 0.08;
        const cpX = midX - (dy / dist) * curve;
        const cpY = midY + (dx / dist) * curve;

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(cpX, cpY, b.x, b.y);

        const sourceColor = getNodeColor(a.subtype);
        const targetColor = getNodeColor(b.subtype);

        if (isHighlighted) {
          const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
          grad.addColorStop(0, sourceColor + hex(alpha));
          grad.addColorStop(1, targetColor + hex(alpha));
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.5;
        } else {
          ctx.strokeStyle = `rgba(100, 116, 139, ${alpha})`;
          ctx.lineWidth = 0.8;
        }
        ctx.stroke();

        // Edge label (only on hover/selected, nearby edges)
        if (isHighlighted && e.label) {
          ctx.fillStyle = `rgba(148, 163, 184, ${alpha + 0.3})`;
          ctx.font = "9px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(e.label, cpX, cpY - 4);
        }
      }

      // Draw nodes
      for (const n of nodes) {
        const color = getNodeColor(n.subtype);
        const isSelected = selectedRef.current === n.id;
        const isHovered = hoveredRef.current === n.id;
        const isConnected =
          selectedRef.current != null &&
          simEdges.some(
            (e) =>
              (e.source === selectedRef.current && e.target === n.id) ||
              (e.target === selectedRef.current && e.source === n.id),
          );

        const glowIntensity = n.salience;
        const dimmed = selectedRef.current != null && !isSelected && !isConnected && !isHovered;

        // Glow
        if ((isSelected || isHovered || glowIntensity > 0.3) && !dimmed) {
          const glowRadius = n.radius * (isSelected ? 3.5 : isHovered ? 3 : 1.5 + glowIntensity);
          const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glowRadius);
          const glowAlpha = isSelected ? 0.35 : isHovered ? 0.25 : glowIntensity * 0.15;
          glow.addColorStop(0, color + hex(glowAlpha));
          glow.addColorStop(1, color + "00");
          ctx.beginPath();
          ctx.arc(n.x, n.y, glowRadius, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }

        // Node body
        ctx.beginPath();
        if (n.kind === "entity") {
          ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        } else {
          // Rounded square for observations
          const s = n.radius * 0.85;
          roundedRect(ctx, n.x - s, n.y - s, s * 2, s * 2, s * 0.35);
        }

        // Fill
        const fillAlpha = dimmed ? 0.15 : 0.7 + n.salience * 0.3;
        ctx.fillStyle = color + hex(fillAlpha * 0.3);
        ctx.fill();

        // Border
        const borderAlpha = dimmed ? 0.2 : 0.6 + n.salience * 0.4;
        ctx.strokeStyle = color + hex(borderAlpha);
        ctx.lineWidth = isSelected ? 2.5 : isHovered ? 2 : 1;
        ctx.stroke();

        // Selection ring
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.radius + 6, 0, Math.PI * 2);
          ctx.strokeStyle = color + "60";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Label
        if (!dimmed || isHovered) {
          const labelAlpha = dimmed ? 0.4 : 0.7 + n.salience * 0.3;
          ctx.fillStyle = `rgba(226, 232, 240, ${labelAlpha})`;
          ctx.textAlign = "center";

          if (n.kind === "entity") {
            ctx.font = `600 ${Math.max(10, 11 + n.salience * 2)}px Inter, sans-serif`;
            ctx.fillText(n.label, n.x, n.y + n.radius + 14);
          } else if (isHovered || isSelected || isConnected) {
            ctx.font = "9px Inter, sans-serif";
            // Word wrap for observations
            const maxWidth = 120;
            const words = n.label.split(" ");
            let line = "";
            let lineY = n.y + n.radius + 12;
            for (const word of words) {
              const testLine = line + (line ? " " : "") + word;
              if (ctx.measureText(testLine).width > maxWidth && line) {
                ctx.fillText(line, n.x, lineY);
                line = word;
                lineY += 11;
              } else {
                line = testLine;
              }
            }
            if (line) ctx.fillText(line, n.x, lineY);
          }
        }
      }

      ctx.restore();

      // --- Minimap overlay (drawn in screen space, after ctx.restore) ---
      drawMinimap(
        ctx,
        nodes,
        simEdges,
        cam,
        w,
        h,
        selectedRef.current != null,
      );

      frameRef.current = requestAnimationFrame(render);
    };

    frameRef.current = requestAnimationFrame(render);

    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
    };
  }, [initialized]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      style={{ cursor: "grab" }}
    />
  );
}

// ---------------------------------------------------------------------------
// Minimap
// ---------------------------------------------------------------------------
const MINIMAP_W = 180;
const MINIMAP_H = 120;
const MINIMAP_PAD = 12;
const MINIMAP_MARGIN = 16;
const MINIMAP_RADIUS = 8;

/** Returns the pixel rect `{ mx, my, mw, mh }` of the minimap on the canvas. */
function minimapRect(
  canvasW: number,
  detailPanelOpen: boolean,
): { mx: number; my: number; mw: number; mh: number } {
  const rightOffset = detailPanelOpen ? 340 : 0;
  const mx = canvasW - MINIMAP_W - MINIMAP_MARGIN - rightOffset;
  const my = MINIMAP_MARGIN;
  return { mx, my, mw: MINIMAP_W, mh: MINIMAP_H };
}

function drawMinimap(
  ctx: CanvasRenderingContext2D,
  nodes: GraphNode[],
  edges: SimEdge[],
  camera: { x: number; y: number; zoom: number },
  canvasW: number,
  canvasH: number,
  detailPanelOpen: boolean,
) {
  if (nodes.length === 0) return;

  const { mx, my, mw, mh } = minimapRect(canvasW, detailPanelOpen);
  const innerW = mw - MINIMAP_PAD * 2;
  const innerH = mh - MINIMAP_PAD * 2;

  // Compute world bounding box of all nodes
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x - n.radius < minX) minX = n.x - n.radius;
    if (n.y - n.radius < minY) minY = n.y - n.radius;
    if (n.x + n.radius > maxX) maxX = n.x + n.radius;
    if (n.y + n.radius > maxY) maxY = n.y + n.radius;
  }

  // Add some padding to the world bounds
  const worldPad = 60;
  minX -= worldPad;
  minY -= worldPad;
  maxX += worldPad;
  maxY += worldPad;

  const worldW = maxX - minX || 1;
  const worldH = maxY - minY || 1;
  const scale = Math.min(innerW / worldW, innerH / worldH);

  // Center the graph inside the minimap inner area
  const scaledW = worldW * scale;
  const scaledH = worldH * scale;
  const offsetX = mx + MINIMAP_PAD + (innerW - scaledW) / 2;
  const offsetY = my + MINIMAP_PAD + (innerH - scaledH) / 2;

  // World coord to minimap pixel
  const toMiniX = (wx: number) => offsetX + (wx - minX) * scale;
  const toMiniY = (wy: number) => offsetY + (wy - minY) * scale;

  // --- Background with glass effect ---
  ctx.save();
  roundedRect(ctx, mx, my, mw, mh, MINIMAP_RADIUS);
  ctx.fillStyle = "rgba(12, 12, 20, 0.65)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Clip to rounded rect
  roundedRect(ctx, mx, my, mw, mh, MINIMAP_RADIUS);
  ctx.clip();

  // --- Draw edges ---
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = "rgba(100, 116, 139, 0.2)";
  ctx.beginPath();
  for (const e of edges) {
    const a = nodeMap.get(e.source);
    const b = nodeMap.get(e.target);
    if (!a || !b) continue;
    ctx.moveTo(toMiniX(a.x), toMiniY(a.y));
    ctx.lineTo(toMiniX(b.x), toMiniY(b.y));
  }
  ctx.stroke();

  // --- Draw nodes ---
  for (const n of nodes) {
    const color = getNodeColor(n.subtype);
    const px = toMiniX(n.x);
    const py = toMiniY(n.y);
    const dotR = n.kind === "entity" ? 2.5 : 1.5;

    ctx.beginPath();
    ctx.arc(px, py, dotR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // --- Viewport rectangle ---
  // The main camera maps world coords to screen via:
  //   screenX = canvasW/2 + (worldX + cam.x) * cam.zoom
  // So the visible world rect is:
  const halfW = canvasW / 2;
  const halfH = canvasH / 2;
  const vpWorldLeft = -halfW / camera.zoom - camera.x;
  const vpWorldTop = -halfH / camera.zoom - camera.y;
  const vpWorldRight = halfW / camera.zoom - camera.x;
  const vpWorldBottom = halfH / camera.zoom - camera.y;

  const vpLeft = toMiniX(vpWorldLeft);
  const vpTop = toMiniY(vpWorldTop);
  const vpRight = toMiniX(vpWorldRight);
  const vpBottom = toMiniY(vpWorldBottom);

  // Clamp to minimap bounds
  const clampL = Math.max(mx + 1, vpLeft);
  const clampT = Math.max(my + 1, vpTop);
  const clampR = Math.min(mx + mw - 1, vpRight);
  const clampB = Math.min(my + mh - 1, vpBottom);

  if (clampR > clampL && clampB > clampT) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
    ctx.fillRect(clampL, clampT, clampR - clampL, clampB - clampT);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(clampL, clampT, clampR - clampL, clampB - clampT);
  }

  ctx.restore();
}

/**
 * Test whether a screen-space click lands inside the minimap and, if so,
 * return the world coordinates the click maps to, using the same world-bounds
 * logic as `drawMinimap`.
 */
function minimapHitToWorld(
  sx: number,
  sy: number,
  nodes: GraphNode[],
  canvasW: number,
  detailPanelOpen: boolean,
): { wx: number; wy: number } | null {
  if (nodes.length === 0) return null;
  const { mx, my, mw, mh } = minimapRect(canvasW, detailPanelOpen);
  if (sx < mx || sx > mx + mw || sy < my || sy > my + mh) return null;

  const innerW = mw - MINIMAP_PAD * 2;
  const innerH = mh - MINIMAP_PAD * 2;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x - n.radius < minX) minX = n.x - n.radius;
    if (n.y - n.radius < minY) minY = n.y - n.radius;
    if (n.x + n.radius > maxX) maxX = n.x + n.radius;
    if (n.y + n.radius > maxY) maxY = n.y + n.radius;
  }
  const worldPad = 60;
  minX -= worldPad;
  minY -= worldPad;
  maxX += worldPad;
  maxY += worldPad;

  const worldW = maxX - minX || 1;
  const worldH = maxY - minY || 1;
  const scale = Math.min(innerW / worldW, innerH / worldH);

  const scaledW = worldW * scale;
  const scaledH = worldH * scale;
  const offsetX = mx + MINIMAP_PAD + (innerW - scaledW) / 2;
  const offsetY = my + MINIMAP_PAD + (innerH - scaledH) / 2;

  const wx = (sx - offsetX) / scale + minX;
  const wy = (sy - offsetY) / scale + minY;
  return { wx, wy };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hex(alpha: number): string {
  return Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
