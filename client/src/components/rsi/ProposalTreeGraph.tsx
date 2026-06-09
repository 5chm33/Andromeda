/**
 * ProposalTreeGraph.tsx
 *
 * Live RSI Proposal Tree Visualization using @xyflow/react.
 * Shows the evolutionary branching of proposals with real-time
 * test result coloring (green = passed, red = failed, yellow = pending).
 */
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  BackgroundVariant,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ProposalNode {
  id: string;
  parentId?: string;
  title: string;
  status: "pending" | "running" | "passed" | "failed" | "adopted";
  score?: number;
  testsPassed?: number;
  testsFailed?: number;
  createdAt: number;
  files?: string[];
}

// ── Custom Node Components ────────────────────────────────────────────────────
function RsiProposalNode({ data }: { data: ProposalNode & { isRoot?: boolean } }) {
  const statusColors: Record<string, string> = {
    pending: "border-yellow-500/60 bg-yellow-950/40 shadow-yellow-900/30",
    running: "border-blue-400/80 bg-blue-950/50 shadow-blue-900/40 animate-pulse",
    passed: "border-emerald-500/80 bg-emerald-950/40 shadow-emerald-900/40",
    failed: "border-red-500/80 bg-red-950/40 shadow-red-900/40",
    adopted: "border-violet-500/80 bg-violet-950/40 shadow-violet-900/40",
  };
  const statusGlow: Record<string, string> = {
    pending: "",
    running: "shadow-[0_0_12px_rgba(59,130,246,0.4)]",
    passed: "shadow-[0_0_12px_rgba(16,185,129,0.4)]",
    failed: "shadow-[0_0_12px_rgba(239,68,68,0.4)]",
    adopted: "shadow-[0_0_16px_rgba(139,92,246,0.6)]",
  };
  const statusDot: Record<string, string> = {
    pending: "bg-yellow-400",
    running: "bg-blue-400 animate-ping",
    passed: "bg-emerald-400",
    failed: "bg-red-400",
    adopted: "bg-violet-400",
  };

  return (
    <div
      className={`
        relative px-3 py-2 rounded-lg border text-xs font-mono min-w-[160px] max-w-[220px]
        ${statusColors[data.status] ?? statusColors.pending}
        ${statusGlow[data.status] ?? ""}
        transition-all duration-300
      `}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-600 !border-slate-500 !w-2 !h-2" />
      
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot[data.status]}`} />
        <span className="text-slate-200 font-semibold truncate text-[11px]">
          {data.isRoot ? "🧬 RSI Root" : data.title}
        </span>
      </div>

      {/* Score */}
      {data.score !== undefined && (
        <div className="text-[10px] text-slate-400 mb-1">
          Score: <span className="text-slate-200 font-bold">{(data.score * 100).toFixed(1)}%</span>
        </div>
      )}

      {/* Test Results */}
      {(data.testsPassed !== undefined || data.testsFailed !== undefined) && (
        <div className="flex gap-1.5 mt-1">
          {data.testsPassed !== undefined && (
            <span className="text-[9px] bg-emerald-900/60 text-emerald-300 px-1 py-0.5 rounded">
              ✓ {data.testsPassed}
            </span>
          )}
          {data.testsFailed !== undefined && data.testsFailed > 0 && (
            <span className="text-[9px] bg-red-900/60 text-red-300 px-1 py-0.5 rounded">
              ✗ {data.testsFailed}
            </span>
          )}
        </div>
      )}

      {/* Files */}
      {data.files && data.files.length > 0 && (
        <div className="mt-1 text-[9px] text-slate-500 truncate">
          {data.files.slice(0, 2).join(", ")}
          {data.files.length > 2 && ` +${data.files.length - 2}`}
        </div>
      )}

      {/* Status badge */}
      <div className="mt-1.5">
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-bold
          ${data.status === "adopted" ? "bg-violet-800/60 text-violet-200" :
            data.status === "passed" ? "bg-emerald-800/60 text-emerald-200" :
            data.status === "failed" ? "bg-red-800/60 text-red-200" :
            data.status === "running" ? "bg-blue-800/60 text-blue-200" :
            "bg-yellow-800/60 text-yellow-200"}`}>
          {data.status}
        </span>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-slate-600 !border-slate-500 !w-2 !h-2" />
    </div>
  );
}

const nodeTypes = { proposal: RsiProposalNode };

// ── Helpers ───────────────────────────────────────────────────────────────────
function proposalsToFlow(proposals: ProposalNode[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    {
      id: "root",
      type: "proposal",
      position: { x: 0, y: 0 },
      data: {
        id: "root",
        title: "RSI Root",
        status: "adopted",
        score: 1,
        createdAt: Date.now(),
        isRoot: true,
      } as ProposalNode & { isRoot: boolean },
    },
  ];

  const edges: Edge[] = [];
  const levelMap: Record<string, number> = { root: 0 };
  const childrenCount: Record<string, number> = {};

  // First pass: count children per parent
  for (const p of proposals) {
    const parentId = p.parentId ?? "root";
    childrenCount[parentId] = (childrenCount[parentId] ?? 0) + 1;
  }

  // Second pass: position nodes
  const positionTracker: Record<string, number> = {};

  for (const p of proposals) {
    const parentId = p.parentId ?? "root";
    const level = (levelMap[parentId] ?? 0) + 1;
    levelMap[p.id] = level;

    positionTracker[parentId] = (positionTracker[parentId] ?? -1) + 1;
    const siblingIdx = positionTracker[parentId];
    const totalSiblings = childrenCount[parentId] ?? 1;
    const xSpread = Math.max(totalSiblings * 220, 220);
    const xBase = siblingIdx * 240 - (totalSiblings - 1) * 120;

    nodes.push({
      id: p.id,
      type: "proposal",
      position: { x: xBase, y: level * 160 },
      data: p,
    });

    edges.push({
      id: `e-${parentId}-${p.id}`,
      source: parentId,
      target: p.id,
      animated: p.status === "running",
      style: {
        stroke:
          p.status === "passed" || p.status === "adopted"
            ? "#10b981"
            : p.status === "failed"
            ? "#ef4444"
            : p.status === "running"
            ? "#3b82f6"
            : "#64748b",
        strokeWidth: p.status === "adopted" ? 2.5 : 1.5,
      },
    });
  }

  return { nodes, edges };
}

// ── Main Component ────────────────────────────────────────────────────────────
export function ProposalTreeGraph() {
  const [proposals, setProposals] = useState<ProposalNode[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isLive, setIsLive] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const fetchProposals = useCallback(async () => {
    try {
      const res = await fetch("/api/rsi/proposals?limit=50");
      if (!res.ok) return;
      const data = await res.json();
      const list: ProposalNode[] = (data.proposals ?? []).map((p: Record<string, unknown>) => ({
        id: String(p.id ?? p.proposalId ?? Math.random()),
        parentId: p.parentId as string | undefined,
        title: String(p.title ?? p.description ?? "Proposal"),
        status: (p.status ?? "pending") as ProposalNode["status"],
        score: typeof p.score === "number" ? p.score : undefined,
        testsPassed: typeof p.testsPassed === "number" ? p.testsPassed : undefined,
        testsFailed: typeof p.testsFailed === "number" ? p.testsFailed : undefined,
        createdAt: typeof p.createdAt === "number" ? p.createdAt : Date.now(),
        files: Array.isArray(p.files) ? (p.files as string[]) : undefined,
      }));
      setProposals(list);
      setLastUpdated(new Date());
    } catch {
      // API not yet available — show demo data
      setProposals(getDemoProposals());
      setLastUpdated(new Date());
    }
  }, []);

  useEffect(() => {
    fetchProposals();
    if (isLive) {
      pollRef.current = setInterval(fetchProposals, 5000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchProposals, isLive]);

  useEffect(() => {
    const { nodes: n, edges: e } = proposalsToFlow(proposals);
    setNodes(n);
    setEdges(e);
  }, [proposals, setNodes, setEdges]);

  const statusCounts = proposals.reduce(
    (acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-700/50 bg-slate-900/50">
        <span className="text-xs text-slate-400 font-mono">RSI Proposal Tree</span>
        <div className="flex gap-1.5 ml-auto">
          {Object.entries(statusCounts).map(([status, count]) => (
            <Badge
              key={status}
              variant="outline"
              className={`text-[9px] px-1.5 py-0 border-slate-600 ${
                status === "passed" || status === "adopted"
                  ? "text-emerald-400 border-emerald-800"
                  : status === "failed"
                  ? "text-red-400 border-red-800"
                  : status === "running"
                  ? "text-blue-400 border-blue-800"
                  : "text-yellow-400 border-yellow-800"
              }`}
            >
              {count} {status}
            </Badge>
          ))}
        </div>
        <button
          onClick={() => setIsLive((v) => !v)}
          className={`text-[10px] px-2 py-0.5 rounded border font-mono transition-colors ${
            isLive
              ? "border-emerald-700 text-emerald-400 bg-emerald-950/40"
              : "border-slate-600 text-slate-400"
          }`}
        >
          {isLive ? "● LIVE" : "○ PAUSED"}
        </button>
        {lastUpdated && (
          <span className="text-[9px] text-slate-600 font-mono">
            {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Flow Canvas */}
      <div className="flex-1 min-h-[400px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="rgba(148,163,184,0.08)"
          />
          <Controls
            className="!bg-slate-900 !border-slate-700 [&_button]:!bg-slate-800 [&_button]:!border-slate-600 [&_button]:!text-slate-300"
          />
          <MiniMap
            className="!bg-slate-900 !border-slate-700"
            nodeColor={(n) => {
              const s = (n.data as ProposalNode).status;
              return s === "passed" || s === "adopted"
                ? "#10b981"
                : s === "failed"
                ? "#ef4444"
                : s === "running"
                ? "#3b82f6"
                : "#64748b";
            }}
            maskColor="rgba(2,6,23,0.7)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

// ── Demo data (shown when API is unavailable) ─────────────────────────────────
function getDemoProposals(): ProposalNode[] {
  return [
    {
      id: "p1",
      title: "Optimize LLM cache",
      status: "adopted",
      score: 0.94,
      testsPassed: 47,
      testsFailed: 0,
      createdAt: Date.now() - 3600000,
      files: ["server/llmProvider.ts"],
    },
    {
      id: "p2",
      parentId: "p1",
      title: "Add streaming retry",
      status: "passed",
      score: 0.88,
      testsPassed: 12,
      testsFailed: 0,
      createdAt: Date.now() - 2400000,
      files: ["server/aiStreaming.ts"],
    },
    {
      id: "p3",
      parentId: "p1",
      title: "Parallel eval batching",
      status: "failed",
      score: 0.42,
      testsPassed: 8,
      testsFailed: 3,
      createdAt: Date.now() - 1800000,
      files: ["server/parallelRsi.ts"],
    },
    {
      id: "p4",
      parentId: "p2",
      title: "Adaptive token budget",
      status: "running",
      score: undefined,
      testsPassed: 5,
      testsFailed: 0,
      createdAt: Date.now() - 600000,
      files: ["server/tokenBudgetManager.ts"],
    },
    {
      id: "p5",
      parentId: "p2",
      title: "LoRA weight merge",
      status: "pending",
      createdAt: Date.now() - 300000,
      files: ["server/localLora.ts", "server/selfDistillation.ts"],
    },
    {
      id: "p6",
      parentId: "p3",
      title: "Retry with backoff",
      status: "passed",
      score: 0.79,
      testsPassed: 9,
      testsFailed: 0,
      createdAt: Date.now() - 900000,
      files: ["server/parallelRsi.ts"],
    },
  ];
}
