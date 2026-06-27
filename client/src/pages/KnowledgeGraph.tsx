/**
 * KnowledgeGraph.tsx — v101.0.0
 * Interactive D3 force-directed knowledge graph visualization.
 * Fetches entity/relationship data from /api/knowledge-graph and renders
 * a live, zoomable, pannable force graph with node type coloring.
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Network, RefreshCw, ZoomIn, ZoomOut, Maximize2, Filter,
  Search, Info, X, GitBranch, Brain, Database, Cpu, Layers
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface KGNode {
  id: string;
  label: string;
  type: "concept" | "entity" | "module" | "capability" | "relationship";
  weight?: number;
  description?: string;
  connections?: number;
}

interface KGEdge {
  source: string;
  target: string;
  label?: string;
  weight?: number;
}

interface KGData {
  nodes: KGNode[];
  edges: KGEdge[];
  totalNodes?: number;
  totalEdges?: number;
}

// ── Mock data generator (used when API is offline) ────────────────────────────
function generateMockGraph(): KGData {
  const nodeTypes: KGNode["type"][] = ["concept", "entity", "module", "capability", "relationship"];
  const moduleNames = [
    "RSI Engine", "Memory System", "Ethics Engine", "Planner", "Reasoner",
    "Knowledge Base", "Causal Graph", "Swarm Coordinator", "Safety Monitor",
    "Language Grounder", "Embodied Agent", "Meta Learner", "Attention Mechanism",
    "Working Memory", "Semantic Memory", "Inference Engine", "Ontology Manager",
    "Constraint Solver", "Reward Calculator", "Policy Optimizer",
  ];

  const nodes: KGNode[] = moduleNames.map((name, i) => ({
    id: `node-${i}`,
    label: name,
    type: nodeTypes[i % nodeTypes.length],
    weight: Math.random() * 10 + 1,
    connections: Math.floor(Math.random() * 8) + 1,
    description: `Core ${name} module — handles ${name.toLowerCase()} operations`,
  }));

  const edges: KGEdge[] = [];
  for (let i = 0; i < 35; i++) {
    const src = Math.floor(Math.random() * nodes.length);
    const tgt = Math.floor(Math.random() * nodes.length);
    if (src !== tgt) {
      edges.push({
        source: nodes[src].id,
        target: nodes[tgt].id,
        label: ["uses", "feeds", "monitors", "controls", "extends"][Math.floor(Math.random() * 5)],
        weight: Math.random(),
      });
    }
  }

  return { nodes, edges, totalNodes: nodes.length, totalEdges: edges.length };
}

// ── Node type config ──────────────────────────────────────────────────────────
const NODE_TYPE_CONFIG: Record<KGNode["type"], { color: string; icon: React.FC<{size?: number}> }> = {
  concept:      { color: "#8b5cf6", icon: Brain },
  entity:       { color: "#06b6d4", icon: Database },
  module:       { color: "#10b981", icon: Cpu },
  capability:   { color: "#f59e0b", icon: Layers },
  relationship: { color: "#ef4444", icon: GitBranch },
};

// ── Canvas-based force graph ──────────────────────────────────────────────────
interface ForceNode extends KGNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface ForceEdge {
  source: ForceNode;
  target: ForceNode;
  label?: string;
  weight?: number;
}

function useForceGraph(data: KGData | null, canvasRef: React.RefObject<HTMLCanvasElement>) {
  const nodesRef = useRef<ForceNode[]>([]);
  const edgesRef = useRef<ForceEdge[]>([]);
  const animFrameRef = useRef<number>(0);
  const [selectedNode, setSelectedNode] = useState<ForceNode | null>(null);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const isDraggingRef = useRef(false);
  const dragNodeRef = useRef<ForceNode | null>(null);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  const initGraph = useCallback(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const W = canvas.width;
    const H = canvas.height;

    nodesRef.current = data.nodes.map(n => ({
      ...n,
      x: W / 2 + (Math.random() - 0.5) * W * 0.6,
      y: H / 2 + (Math.random() - 0.5) * H * 0.6,
      vx: 0,
      vy: 0,
    }));

    const nodeMap = new Map(nodesRef.current.map(n => [n.id, n]));
    edgesRef.current = data.edges
      .map(e => ({
        source: nodeMap.get(e.source)!,
        target: nodeMap.get(e.target)!,
        label: e.label,
        weight: e.weight,
      }))
      .filter(e => e.source && e.target);
  }, [data, canvasRef]);

  const simulate = useCallback(() => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    if (!nodes.length) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;

    // Force simulation tick
    for (const node of nodes) {
      // Center gravity
      node.vx += (cx - node.x) * 0.001;
      node.vy += (cy - node.y) * 0.001;

      // Repulsion
      for (const other of nodes) {
        if (other === node) continue;
        const dx = node.x - other.x;
        const dy = node.y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = 1200 / (dist * dist);
        node.vx += (dx / dist) * force;
        node.vy += (dy / dist) * force;
      }
    }

    // Spring attraction along edges
    for (const edge of edges) {
      const dx = edge.target.x - edge.source.x;
      const dy = edge.target.y - edge.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const targetDist = 120;
      const force = (dist - targetDist) * 0.03;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      edge.source.vx += fx;
      edge.source.vy += fy;
      edge.target.vx -= fx;
      edge.target.vy -= fy;
    }

    // Integrate
    for (const node of nodes) {
      if (dragNodeRef.current === node) continue;
      node.vx *= 0.85;
      node.vy *= 0.85;
      node.x += node.vx;
      node.y += node.vy;
      node.x = Math.max(20, Math.min(W - 20, node.x));
      node.y = Math.max(20, Math.min(H - 20, node.y));
    }
  }, [canvasRef]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { x: tx, y: ty, scale } = transformRef.current;
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);

    // Draw edges
    for (const edge of edgesRef.current) {
      const alpha = 0.3 + (edge.weight ?? 0.5) * 0.4;
      ctx.beginPath();
      ctx.moveTo(edge.source.x, edge.source.y);
      ctx.lineTo(edge.target.x, edge.target.y);
      ctx.strokeStyle = `rgba(100, 116, 139, ${alpha})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw nodes
    for (const node of nodesRef.current) {
      const config = NODE_TYPE_CONFIG[node.type];
      const r = 8 + (node.weight ?? 1) * 1.5;
      const isSelected = selectedNode?.id === node.id;

      // Glow for selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2);
        ctx.fillStyle = config.color + "33";
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = config.color;
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label
      ctx.fillStyle = "#e2e8f0";
      ctx.font = `${isSelected ? "bold " : ""}10px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(node.label, node.x, node.y + r + 12);
    }

    ctx.restore();
  }, [canvasRef, selectedNode]);

  const tick = useCallback(() => {
    simulate();
    draw();
    animFrameRef.current = requestAnimationFrame(tick);
  }, [simulate, draw]);

  useEffect(() => {
    initGraph();
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [initGraph, tick]);

  // Mouse interaction
  const getNodeAt = useCallback((clientX: number, clientY: number): ForceNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { x: tx, y: ty, scale } = transformRef.current;
    const mx = (clientX - rect.left - tx) / scale;
    const my = (clientY - rect.top - ty) / scale;

    for (const node of nodesRef.current) {
      const r = 8 + (node.weight ?? 1) * 1.5;
      const dx = mx - node.x;
      const dy = my - node.y;
      if (dx * dx + dy * dy <= (r + 4) * (r + 4)) return node;
    }
    return null;
  }, [canvasRef]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const node = getNodeAt(e.clientX, e.clientY);
    if (node) {
      dragNodeRef.current = node;
      setSelectedNode(node);
    } else {
      isDraggingRef.current = true;
    }
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }, [getNodeAt]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };

    if (dragNodeRef.current) {
      dragNodeRef.current.x += dx / transformRef.current.scale;
      dragNodeRef.current.y += dy / transformRef.current.scale;
    } else if (isDraggingRef.current) {
      transformRef.current.x += dx;
      transformRef.current.y += dy;
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    dragNodeRef.current = null;
    isDraggingRef.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    transformRef.current.scale = Math.max(0.2, Math.min(4, transformRef.current.scale * delta));
  }, []);

  const resetView = useCallback(() => {
    transformRef.current = { x: 0, y: 0, scale: 1 };
  }, []);

  return { selectedNode, setSelectedNode, handleMouseDown, handleMouseMove, handleMouseUp, handleWheel, resetView };
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function KnowledgeGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<KGData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<KGNode["type"] | "all">("all");
  const [search, setSearch] = useState("");
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/knowledge-graph", { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const raw = await res.json() as KGData;
        setData(raw);
        setStats({ nodes: raw.nodes.length, edges: raw.edges.length });
      } else {
        throw new Error("API unavailable");
      }
    } catch {
      const mock = generateMockGraph();
      setData(mock);
      setStats({ nodes: mock.nodes.length, edges: mock.edges.length });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredData: KGData | null = data ? {
    ...data,
    nodes: data.nodes.filter(n => {
      const matchesFilter = filter === "all" || n.type === filter;
      const matchesSearch = !search || n.label.toLowerCase().includes(search.toLowerCase());
      return matchesFilter && matchesSearch;
    }),
    edges: data.edges,
  } : null;

  const { selectedNode, setSelectedNode, handleMouseDown, handleMouseMove, handleMouseUp, handleWheel, resetView } =
    useForceGraph(filteredData, canvasRef as React.RefObject<HTMLCanvasElement>);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Network className="text-purple-400" size={22} />
          <h1 className="text-lg font-bold text-white">Knowledge Graph</h1>
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
            {stats.nodes} nodes · {stats.edges} edges
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-gray-500" />
            <input
              type="text"
              placeholder="Search nodes…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500 w-48"
            />
          </div>
          <button
            onClick={resetView}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
            title="Reset view"
          >
            <Maximize2 size={14} />
          </button>
          <button
            onClick={fetchData}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-48 border-r border-gray-800 p-4 flex flex-col gap-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Filter by Type</p>
          {(["all", "concept", "entity", "module", "capability", "relationship"] as const).map(type => (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                filter === type
                  ? "bg-purple-600 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`}
            >
              {type !== "all" && (
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: NODE_TYPE_CONFIG[type].color }}
                />
              )}
              <span className="capitalize">{type}</span>
            </button>
          ))}

          {/* Legend */}
          <div className="mt-4 pt-4 border-t border-gray-800">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Legend</p>
            <p className="text-xs text-gray-500">Drag nodes to reposition. Scroll to zoom. Click to inspect.</p>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 z-10">
              <div className="flex items-center gap-3 text-gray-400">
                <RefreshCw size={18} className="animate-spin" />
                <span>Loading graph…</span>
              </div>
            </div>
          )}
          <canvas
            ref={canvasRef}
            width={800}
            height={600}
            className="w-full h-full cursor-grab active:cursor-grabbing"
            style={{ background: "transparent" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          />
        </div>

        {/* Node Inspector */}
        {selectedNode && (
          <motion.div
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="w-64 border-l border-gray-800 p-4 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white text-sm">Node Inspector</h3>
              <button onClick={() => setSelectedNode(null)} className="text-gray-500 hover:text-white">
                <X size={14} />
              </button>
            </div>
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ backgroundColor: NODE_TYPE_CONFIG[selectedNode.type].color }}
            >
              {React.createElement(NODE_TYPE_CONFIG[selectedNode.type].icon, { size: 16 })}
            </div>
            <div>
              <p className="text-white font-medium">{selectedNode.label}</p>
              <p className="text-xs text-gray-500 capitalize mt-0.5">{selectedNode.type}</p>
            </div>
            {selectedNode.description && (
              <p className="text-xs text-gray-400 leading-relaxed">{selectedNode.description}</p>
            )}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-800">
              <div className="bg-gray-800 rounded-lg p-2">
                <p className="text-xs text-gray-500">Weight</p>
                <p className="text-sm font-medium text-white">{(selectedNode.weight ?? 1).toFixed(1)}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-2">
                <p className="text-xs text-gray-500">Connections</p>
                <p className="text-sm font-medium text-white">{selectedNode.connections ?? 0}</p>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
