/**
 * ProposalTreeGraph.tsx — v12.2.0 — SOTA Intelligence Command Center
 *
 * Completely redesigned from scratch. New layout:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  HEADER: Brand + Live indicator + GitHub Fixer + Close      │
 *   ├──────────┬──────────┬──────────┬──────────┬────────────────┤
 *   │  CYCLES  │  SCORE   │  PHASE   │  COST    │  TOGGLE+TRIGGER│
 *   │  (hero)  │  (hero)  │  (hero)  │  (hero)  │  (controls)    │
 *   ├──────────────────────────────────┬────────────────────────┤
 *   │                                  │  LIVE ACTIVITY FEED    │
 *   │   PROPOSAL GRAPH (React Flow)    │  (timeline cards)      │
 *   │   Radial/orbital layout          │                        │
 *   │   Glassmorphism node cards       │                        │
 *   │   Animated gradient edges        │                        │
 *   │                                  │                        │
 *   └──────────────────────────────────┴────────────────────────┘
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
import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Zap,
  GitBranch,
  Radio,
  Play,
  Pause,
  SkipForward,
  TrendingUp,
  TrendingDown,
  Minus,
  Wrench,
  Cpu,
  FlaskConical,
  BarChart3,
} from "lucide-react";

const ExternalRepoFixer = lazy(() =>
  import("./ExternalRepoFixer").then((m) => ({ default: m.ExternalRepoFixer }))
);

// ─── Types ────────────────────────────────────────────────────────────────────

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
  isRoot?: boolean;
}

interface RsiStatus {
  enabled: boolean;
  phase: string;
  cycleCount: number;
  lastScore?: number;
  avgScore?: number;
  prevAvgScore?: number;
  schedulerPaused?: boolean;
  costStats?: { totalCost: number; dailyCap: number };
}

interface LiveEvent {
  id: string;
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

// ─── Design Tokens ────────────────────────────────────────────────────────────

const STATUS_CFG = {
  pending:  { border: "#fbbf2440", bg: "#fbbf2408", glow: "0 0 16px #fbbf2418", dot: "#fbbf24", ring: "#fbbf2460", label: "PENDING",  edge: "#fbbf2450" },
  running:  { border: "#818cf880", bg: "#6366f112", glow: "0 0 24px #6366f135", dot: "#818cf8", ring: "#6366f170", label: "RUNNING",  edge: "#818cf8" },
  passed:   { border: "#34d39940", bg: "#10b98108", glow: "0 0 16px #10b98118", dot: "#34d399", ring: "#34d39960", label: "PASSED",   edge: "#34d39960" },
  failed:   { border: "#fb718540", bg: "#f43f5e08", glow: "0 0 16px #f43f5e18", dot: "#fb7185", ring: "#fb718560", label: "FAILED",   edge: "#fb718550" },
  adopted:  { border: "#a78bfa70", bg: "#7c3aed12", glow: "0 0 28px #7c3aed45", dot: "#a78bfa", ring: "#a78bfa80", label: "ADOPTED",  edge: "#a78bfa" },
} as const;

const EVENT_CFG: Record<string, { icon: string; color: string; label: string; bg: string }> = {
  "proposal:new":      { icon: "✦", color: "#818cf8", label: "New proposal",    bg: "#818cf810" },
  "proposal:applied":  { icon: "✓", color: "#34d399", label: "Applied",         bg: "#34d39910" },
  "proposal:rejected": { icon: "✗", color: "#fb7185", label: "Rejected",        bg: "#fb718510" },
  "cycle:start":       { icon: "◉", color: "#a78bfa", label: "Cycle started",   bg: "#a78bfa10" },
  "cycle:complete":    { icon: "★", color: "#fbbf24", label: "Cycle complete",  bg: "#fbbf2410" },
  "parallel:start":    { icon: "⊞", color: "#60a5fa", label: "Parallel start",  bg: "#60a5fa10" },
  "parallel:complete": { icon: "⊡", color: "#34d399", label: "Parallel done",   bg: "#34d39910" },
};

// ─── Score Ring SVG ───────────────────────────────────────────────────────────

function ScoreRing({ score, color, size = 44 }: { score: number; color: string; size?: number }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(Math.max(score, 0), 100);
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1f1f23" strokeWidth={3} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ filter: `drop-shadow(0 0 4px ${color}80)` }}
      />
      <text x={size / 2} y={size / 2 + 4} textAnchor="middle" fill={color} fontSize={size < 40 ? 9 : 11} fontWeight="700" fontFamily="Inter, system-ui, sans-serif">
        {Math.round(pct)}
      </text>
    </svg>
  );
}

// ─── Proposal Node Card ───────────────────────────────────────────────────────

function ProposalNodeCard({ data }: { data: Record<string, unknown> }) {
  const p = data as unknown as ProposalNode;
  const cfg = STATUS_CFG[p.status] ?? STATUS_CFG.pending;
  const score = p.score != null ? Math.round(p.score * 100) : null;
  const isRunning = p.status === "running";
  const isAdopted = p.status === "adopted";

  return (
    <div style={{
      background: `linear-gradient(145deg, #0f0f12 0%, ${cfg.bg} 100%)`,
      border: `1px solid ${cfg.border}`,
      boxShadow: `${cfg.glow}, inset 0 1px 0 rgba(255,255,255,0.04)`,
      borderRadius: 16,
      width: 280,
      padding: "14px 16px 14px",
      position: "relative",
      overflow: "hidden",
      fontFamily: "Inter, system-ui, sans-serif",
      transition: "box-shadow 0.3s ease",
    }}>
      {/* Shimmer top accent for adopted/running */}
      {(isAdopted || isRunning) && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 1,
          background: isAdopted
            ? "linear-gradient(90deg, transparent 0%, #7c3aed 30%, #a78bfa 50%, #7c3aed 70%, transparent 100%)"
            : "linear-gradient(90deg, transparent 0%, #6366f1 50%, transparent 100%)",
          opacity: 0.9,
        }} />
      )}

      <Handle type="target" position={Position.Top} style={{ background: cfg.dot, border: "2px solid #09090b", width: 8, height: 8, top: -4 }} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: score != null ? 10 : 8 }}>
        {/* Score ring or status dot */}
        {score != null ? (
          <ScoreRing score={score} color={cfg.dot} size={40} />
        ) : (
          <div style={{ width: 40, height: 40, borderRadius: "50%", border: `1px solid ${cfg.border}`, background: cfg.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {isRunning ? (
              <svg viewBox="0 0 20 20" style={{ width: 14, height: 14, animation: "spin 1.2s linear infinite" }}>
                <circle cx="10" cy="10" r="7" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeDasharray="26 18" />
              </svg>
            ) : (
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: cfg.dot, boxShadow: `0 0 6px ${cfg.dot}` }} />
            )}
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: "#f4f4f5",
            lineHeight: 1.35, letterSpacing: "-0.02em",
            wordBreak: "break-word", marginBottom: 4,
          }}>
            {p.isRoot ? "⬡ RSI Root" : p.title}
          </div>
          {/* Status badge */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            padding: "2px 8px", borderRadius: 20,
            background: `${cfg.dot}18`,
            border: `1px solid ${cfg.dot}35`,
            fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: cfg.dot,
          }}>
            {isRunning && <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: cfg.dot, animation: "pulse 1.5s ease-in-out infinite" }} />}
            {cfg.label}
          </div>
        </div>
      </div>

      {/* Test badges */}
      {(p.testsPassed != null || p.testsFailed != null) && (
        <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
          {p.testsPassed != null && (
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(16,185,129,0.1)", color: "#34d399", border: "1px solid rgba(16,185,129,0.2)", fontWeight: 600 }}>
              ✓ {p.testsPassed} passed
            </span>
          )}
          {(p.testsFailed ?? 0) > 0 && (
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(244,63,94,0.1)", color: "#fb7185", border: "1px solid rgba(244,63,94,0.2)", fontWeight: 600 }}>
              ✗ {p.testsFailed} failed
            </span>
          )}
        </div>
      )}

      {/* Files */}
      {p.files && p.files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {p.files.slice(0, 2).map((f, i) => (
            <div key={i} style={{ fontSize: 10, color: "#52525b", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.5, padding: "1px 6px", background: "#111113", borderRadius: 4 }}>
              {f.split("/").slice(-2).join("/")}
            </div>
          ))}
          {p.files.length > 2 && <div style={{ fontSize: 10, color: "#3f3f46", paddingLeft: 6 }}>+{p.files.length - 2} more</div>}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ background: cfg.dot, border: "2px solid #09090b", width: 8, height: 8, bottom: -4 }} />
    </div>
  );
}

const nodeTypes = { proposal: ProposalNodeCard };

// ─── Layout: Radial/Orbital ───────────────────────────────────────────────────

function proposalsToFlow(proposals: ProposalNode[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [{
    id: "root",
    type: "proposal",
    position: { x: 0, y: 0 },
    data: { id: "root", title: "RSI Root", status: "adopted", score: 1, createdAt: Date.now(), isRoot: true } as unknown as Record<string, unknown>,
  }];
  const edges: Edge[] = [];

  // Build tree structure
  const children: Record<string, string[]> = { root: [] };
  for (const p of proposals) {
    const pid = p.parentId ?? "root";
    if (!children[pid]) children[pid] = [];
    children[pid].push(p.id);
    if (!children[p.id]) children[p.id] = [];
  }

  // BFS layout: each level is a row, nodes spread horizontally
  const levelNodes: string[][] = [["root"]];
  const visited = new Set(["root"]);
  while (true) {
    const last = levelNodes[levelNodes.length - 1];
    const next: string[] = [];
    for (const id of last) {
      for (const child of (children[id] ?? [])) {
        if (!visited.has(child)) { visited.add(child); next.push(child); }
      }
    }
    if (next.length === 0) break;
    levelNodes.push(next);
  }

  const NODE_W = 300;
  const NODE_H = 220;
  const H_GAP = 40;
  const V_GAP = 80;

  for (let level = 0; level < levelNodes.length; level++) {
    const row = levelNodes[level];
    const totalW = row.length * NODE_W + (row.length - 1) * H_GAP;
    for (let i = 0; i < row.length; i++) {
      const id = row[i];
      if (id === "root") {
        nodes[0].position = { x: -NODE_W / 2, y: 0 };
        continue;
      }
      const p = proposals.find(p => p.id === id);
      if (!p) continue;
      const x = -totalW / 2 + i * (NODE_W + H_GAP);
      const y = level * (NODE_H + V_GAP);
      nodes.push({
        id: p.id, type: "proposal",
        position: { x, y },
        data: p as unknown as Record<string, unknown>,
      });
      const pid = p.parentId ?? "root";
      const cfg = STATUS_CFG[p.status] ?? STATUS_CFG.pending;
      edges.push({
        id: `e-${pid}-${p.id}`,
        source: pid,
        target: p.id,
        animated: p.status === "running",
        style: {
          stroke: cfg.edge,
          strokeWidth: p.status === "adopted" ? 2.5 : 1.5,
          opacity: p.status === "failed" ? 0.35 : 0.75,
          filter: p.status === "adopted" ? `drop-shadow(0 0 3px ${cfg.edge}80)` : undefined,
        },
      });
    }
  }

  return { nodes, edges };
}

// ─── Hero Stat Card ───────────────────────────────────────────────────────────

function HeroStat({
  label, value, sub, icon: Icon, color, glow,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
  color: string;
  glow?: string;
}) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      padding: "14px 18px",
      background: "#0d0d10",
      borderRight: "1px solid #1a1a1e",
      display: "flex", flexDirection: "column", gap: 6,
      position: "relative", overflow: "hidden",
    }}>
      {/* Subtle background glow */}
      <div style={{ position: "absolute", top: -20, right: -10, width: 80, height: 80, borderRadius: "50%", background: glow ?? `${color}08`, filter: "blur(20px)", pointerEvents: "none" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon style={{ width: 13, height: 13, color, opacity: 0.8 }} />
        <span style={{ fontSize: 10, color: "#52525b", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#f4f4f5", letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "#52525b", fontVariantNumeric: "tabular-nums" }}>{sub}</div>
      )}
    </div>
  );
}

// ─── Activity Event Row ───────────────────────────────────────────────────────

function EventRow({ ev }: { ev: LiveEvent }) {
  const cfg = EVENT_CFG[ev.type] ?? { icon: "·", color: "#52525b", label: ev.type, bg: "#52525b10" };
  const title = String(ev.data.title ?? ev.data.description ?? ev.data.phase ?? cfg.label).slice(0, 45);
  const time = new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <div style={{
      display: "flex", gap: 10, padding: "8px 14px",
      borderBottom: "1px solid #0f0f12",
      background: "transparent",
      transition: "background 0.15s",
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "#111113"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 8,
        background: cfg.bg,
        border: `1px solid ${cfg.color}25`,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: cfg.color, fontWeight: 700 }}>{cfg.icon}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "#d4d4d8", fontWeight: 500, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ fontSize: 10, color: "#3f3f46", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{time}</div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ProposalTreeGraph() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const onConnect = useCallback((params: Connection) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  const [proposals, setProposals] = useState<ProposalNode[]>([]);
  const [status, setStatus] = useState<RsiStatus | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [sseConnected, setSseConnected] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [activeTab, setActiveTab] = useState<"graph" | "timeline">("graph");

  const sseRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const adminKey = typeof localStorage !== "undefined" ? (localStorage.getItem("andromeda_admin_key") ?? "") : "";
  const authHeaders: Record<string, string> = adminKey
    ? { "Content-Type": "application/json", "X-Admin-Key": adminKey }
    : { "Content-Type": "application/json" };

  const loadProposals = useCallback(async () => {
    try {
      const r = await fetch("/api/rsi/proposals?limit=60");
      if (!r.ok) throw new Error("unavailable");
      const d = await r.json();
      const list: ProposalNode[] = (d.proposals ?? (Array.isArray(d) ? d : [])).map((p: Record<string, unknown>) => ({
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
      setProposals(list.length > 0 ? list : getDemoProposals());
    } catch {
      setProposals(getDemoProposals());
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/rsi/status");
      if (r.ok) setStatus(await r.json());
    } catch { /* ignore */ }
  }, []);

  const toggleRsi = useCallback(async () => {
    if (!status) return;
    setToggling(true);
    try {
      const endpoint = status.schedulerPaused ? "/api/rsi/scheduler/resume" : "/api/rsi/scheduler/pause";
      await fetch(endpoint, { method: "POST", headers: authHeaders });
      await loadStatus();
    } finally {
      setToggling(false);
    }
  }, [status, authHeaders, loadStatus]);

  const triggerNow = useCallback(async () => {
    setTriggering(true);
    try {
      await fetch("/api/rsi/scheduler/trigger", { method: "POST", headers: authHeaders });
      await loadProposals();
    } finally {
      setTimeout(() => setTriggering(false), 2000);
    }
  }, [authHeaders, loadProposals]);

  useEffect(() => {
    if (proposals.length === 0) return;
    const { nodes: n, edges: e } = proposalsToFlow(proposals);
    setNodes(n);
    setEdges(e);
  }, [proposals, setNodes, setEdges]);

  useEffect(() => {
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

    loadProposals();
    loadStatus();

    try {
      const sse = new EventSource("/api/rsi/events");
      sseRef.current = sse;
      sse.onopen = () => {
        setSseConnected(true);
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      };
      const addEvent = (type: string) => (e: MessageEvent) => {
        try {
          const parsed = JSON.parse(e.data) as { type: string; timestamp: number; data: Record<string, unknown> };
          if (parsed.type === "heartbeat") return;
          setEvents(prev => [{ id: `${Date.now()}-${Math.random()}`, type: parsed.type, timestamp: parsed.timestamp, data: parsed.data }, ...prev].slice(0, 120));
        } catch { /* ignore */ }
        if (type !== "heartbeat") { loadProposals(); loadStatus(); }
      };
      ["proposal:new", "proposal:applied", "proposal:rejected", "proposal:updated",
        "cycle:start", "cycle:complete", "parallel:start", "parallel:complete", "heartbeat"]
        .forEach(ev => sse.addEventListener(ev, addEvent(ev)));
      sse.onerror = () => {
        setSseConnected(false);
        if (!pollRef.current) pollRef.current = setInterval(() => { loadProposals(); loadStatus(); }, 5000);
      };
    } catch {
      pollRef.current = setInterval(() => { loadProposals(); loadStatus(); }, 5000);
    }

    const statusPoll = setInterval(loadStatus, 10000);
    return () => {
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      clearInterval(statusPoll);
    };
  }, [loadProposals, loadStatus]);

  const isRunning = status ? (!status.schedulerPaused && status.enabled !== false) : false;
  const phase = status?.phase ?? "idle";
  const cycleCount = status?.cycleCount ?? 0;
  const cost = status?.costStats?.totalCost ?? 0;
  const dailyCap = status?.costStats?.dailyCap ?? 10;
  const avgScore = status?.avgScore ?? status?.lastScore;
  const prevAvg = status?.prevAvgScore;
  const scoreDelta = avgScore != null && prevAvg != null ? avgScore - prevAvg : null;
  const costPct = Math.min((cost / dailyCap) * 100, 100);
  const statusCounts = proposals.reduce<Record<string, number>>((acc, p) => { acc[p.status] = (acc[p.status] ?? 0) + 1; return acc; }, {});

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#09090b", borderRadius: 12, overflow: "hidden", fontFamily: "Inter, system-ui, sans-serif" }}>

      {/* ── Top gradient line ── */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg, transparent 0%, #7c3aed 30%, #6366f1 60%, transparent 100%)", zIndex: 20, pointerEvents: "none" }} />

      {/* ══════════════════════════════════════════════════════════════
          HEADER BAR
      ══════════════════════════════════════════════════════════════ */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 16px",
        background: "#0a0a0d",
        borderBottom: "1px solid #1a1a1e",
        flexShrink: 0, zIndex: 10,
      }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #7c3aed, #6366f1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 0 12px rgba(124,58,237,0.4)" }}>
            <Cpu style={{ width: 14, height: 14, color: "#fff" }} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#f4f4f5", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>RSI Command Center</div>
            <div style={{ fontSize: 10, color: "#52525b", marginTop: 2 }}>Recursive Self-Improvement</div>
          </div>
        </div>

        {/* Live indicator */}
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "3px 10px", borderRadius: 20,
          background: sseConnected ? "rgba(16,185,129,0.08)" : "rgba(245,158,11,0.08)",
          border: `1px solid ${sseConnected ? "rgba(16,185,129,0.25)" : "rgba(245,158,11,0.25)"}`,
        }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: sseConnected ? "#34d399" : "#fbbf24", boxShadow: `0 0 6px ${sseConnected ? "#34d399" : "#fbbf24"}`, animation: sseConnected ? "pulse 2s ease-in-out infinite" : "none" }} />
          <span style={{ fontSize: 10, color: sseConnected ? "#34d399" : "#fbbf24", fontWeight: 700, letterSpacing: "0.06em" }}>{sseConnected ? "LIVE" : "POLLING"}</span>
        </div>

        {/* Status pills */}
        <div style={{ display: "flex", gap: 4 }}>
          {(["adopted", "passed", "running", "failed", "pending"] as const).map(s => {
            const count = statusCounts[s];
            if (!count) return null;
            const cfg = STATUS_CFG[s];
            return (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 20, background: `${cfg.dot}12`, border: `1px solid ${cfg.dot}30` }}>
                <div style={{ width: 4, height: 4, borderRadius: "50%", background: cfg.dot }} />
                <span style={{ fontSize: 10, color: cfg.dot, fontWeight: 600 }}>{count}</span>
              </div>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        {/* GitHub Repo Fixer — always visible here */}
        <Suspense fallback={null}>
          <ExternalRepoFixer />
        </Suspense>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          HERO STATS ROW
      ══════════════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", background: "#0a0a0d", borderBottom: "1px solid #1a1a1e", flexShrink: 0 }}>

        <HeroStat
          label="Cycles"
          value={`#${cycleCount.toLocaleString()}`}
          sub={isRunning ? "● Running" : "○ Paused"}
          icon={FlaskConical}
          color="#a78bfa"
          glow="rgba(124,58,237,0.12)"
        />

        <HeroStat
          label="Avg Score"
          value={avgScore != null ? `${(avgScore * 100).toFixed(1)}%` : "—"}
          sub={scoreDelta != null
            ? scoreDelta > 0 ? `▲ +${(scoreDelta * 100).toFixed(2)}% vs prev` : `▼ ${(scoreDelta * 100).toFixed(2)}% vs prev`
            : undefined}
          icon={scoreDelta != null && scoreDelta > 0 ? TrendingUp : scoreDelta != null && scoreDelta < 0 ? TrendingDown : Minus}
          color={scoreDelta != null && scoreDelta > 0 ? "#34d399" : scoreDelta != null && scoreDelta < 0 ? "#fb7185" : "#71717a"}
        />

        <HeroStat
          label="Phase"
          value={phase.charAt(0).toUpperCase() + phase.slice(1)}
          sub={`${proposals.length} proposals`}
          icon={Activity}
          color="#818cf8"
        />

        {/* Cost with mini bar */}
        <div style={{ flex: 1, minWidth: 0, padding: "14px 18px", background: "#0d0d10", borderRight: "1px solid #1a1a1e", display: "flex", flexDirection: "column", gap: 6, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -20, right: -10, width: 80, height: 80, borderRadius: "50%", background: costPct > 80 ? "rgba(244,63,94,0.08)" : "rgba(99,102,241,0.06)", filter: "blur(20px)", pointerEvents: "none" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <BarChart3 style={{ width: 13, height: 13, color: costPct > 80 ? "#fb7185" : "#6366f1", opacity: 0.8 }} />
            <span style={{ fontSize: 10, color: "#52525b", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Cost</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: costPct > 80 ? "#fb7185" : "#f4f4f5", letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
            ${cost.toFixed(3)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1, height: 3, background: "#1f1f23", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${costPct}%`, background: costPct > 80 ? "linear-gradient(90deg, #f43f5e, #fb7185)" : "linear-gradient(90deg, #6366f1, #818cf8)", borderRadius: 3, transition: "width 0.8s ease" }} />
            </div>
            <span style={{ fontSize: 10, color: "#52525b", whiteSpace: "nowrap" }}>${dailyCap} cap</span>
          </div>
        </div>

        {/* Controls */}
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 7, justifyContent: "center", flexShrink: 0 }}>
          <button
            onClick={toggleRsi}
            disabled={toggling}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "8px 16px", borderRadius: 10,
              background: isRunning
                ? "linear-gradient(135deg, rgba(244,63,94,0.12), rgba(251,113,133,0.08))"
                : "linear-gradient(135deg, rgba(16,185,129,0.12), rgba(52,211,153,0.08))",
              border: `1px solid ${isRunning ? "rgba(244,63,94,0.3)" : "rgba(16,185,129,0.3)"}`,
              color: isRunning ? "#fb7185" : "#34d399",
              fontSize: 12, fontWeight: 700, cursor: toggling ? "not-allowed" : "pointer",
              opacity: toggling ? 0.6 : 1, transition: "all 0.2s ease",
              letterSpacing: "0.01em",
            }}
          >
            {toggling ? <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} /> : isRunning ? <Pause style={{ width: 13, height: 13 }} /> : <Play style={{ width: 13, height: 13 }} />}
            {isRunning ? "Pause RSI" : "Resume RSI"}
          </button>

          <button
            onClick={triggerNow}
            disabled={triggering}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "8px 16px", borderRadius: 10,
              background: "linear-gradient(135deg, rgba(124,58,237,0.18), rgba(99,102,241,0.12))",
              border: "1px solid rgba(124,58,237,0.4)",
              color: "#c4b5fd",
              fontSize: 12, fontWeight: 700, cursor: triggering ? "not-allowed" : "pointer",
              opacity: triggering ? 0.6 : 1, transition: "all 0.2s ease",
              letterSpacing: "0.01em",
            }}
          >
            {triggering ? <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} /> : <Zap style={{ width: 13, height: 13 }} />}
            Trigger Cycle
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          TAB BAR
      ══════════════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", background: "#0a0a0d", borderBottom: "1px solid #1a1a1e", flexShrink: 0 }}>
        {(["graph", "timeline"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 18px",
              fontSize: 12, fontWeight: 600,
              color: activeTab === tab ? "#c4b5fd" : "#52525b",
              background: "transparent",
              border: "none",
              borderBottom: `2px solid ${activeTab === tab ? "#7c3aed" : "transparent"}`,
              cursor: "pointer",
              transition: "all 0.2s ease",
              letterSpacing: "0.01em",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {tab === "graph" ? <GitBranch style={{ width: 12, height: 12 }} /> : <Radio style={{ width: 12, height: 12 }} />}
            {tab === "graph" ? "Proposal Graph" : "Live Activity"}
            {tab === "timeline" && events.length > 0 && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 10, background: "rgba(124,58,237,0.2)", color: "#a78bfa" }}>{events.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          MAIN CONTENT
      ══════════════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex" }}>

        {/* Graph tab */}
        {activeTab === "graph" && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.25 }}
              minZoom={0.08}
              maxZoom={2.5}
              proOptions={{ hideAttribution: true }}
              colorMode="dark"
            >
              <Background variant={BackgroundVariant.Dots} gap={32} size={1} color="rgba(124,58,237,0.06)" />
              <Controls style={{ background: "#111113", border: "1px solid #27272a", borderRadius: 10, boxShadow: "0 4px 24px rgba(0,0,0,0.5)" }} />
              <MiniMap
                style={{ background: "#0d0d10", border: "1px solid #27272a", borderRadius: 10 }}
                nodeColor={(n) => STATUS_CFG[(n.data as unknown as ProposalNode).status as keyof typeof STATUS_CFG]?.dot ?? "#52525b"}
                maskColor="rgba(9,9,11,0.85)"
              />
            </ReactFlow>
          </div>
        )}

        {/* Timeline tab */}
        {activeTab === "timeline" && (
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Timeline header */}
            <div style={{ padding: "10px 16px", borderBottom: "1px solid #1a1a1e", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#a78bfa", boxShadow: "0 0 6px #a78bfa", animation: "pulse 2s ease-in-out infinite" }} />
              <span style={{ fontSize: 12, color: "#a1a1aa", fontWeight: 600 }}>Real-time event stream</span>
              <span style={{ fontSize: 11, color: "#3f3f46", marginLeft: "auto" }}>{events.length} events</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {events.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
                  <Radio style={{ width: 28, height: 28, color: "#27272a" }} />
                  <div style={{ fontSize: 13, color: "#3f3f46" }}>Waiting for RSI events…</div>
                  <div style={{ fontSize: 11, color: "#27272a" }}>Events will appear here when RSI cycles run</div>
                </div>
              ) : (
                events.map(ev => <EventRow key={ev.id} ev={ev} />)
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── CSS keyframes injected ── */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes ping { 0% { transform: scale(1); opacity: 0.8; } 100% { transform: scale(2); opacity: 0; } }
      `}</style>
    </div>
  );
}

// ─── Demo Data ────────────────────────────────────────────────────────────────

function getDemoProposals(): ProposalNode[] {
  return [
    { id: "p1", title: "Optimize LLM cache layer", status: "adopted", score: 0.94, testsPassed: 47, testsFailed: 0, createdAt: Date.now() - 3600000, files: ["server/llmProvider.ts", "server/cache.ts"] },
    { id: "p2", parentId: "p1", title: "Add streaming retry logic", status: "passed", score: 0.88, testsPassed: 12, testsFailed: 0, createdAt: Date.now() - 2400000, files: ["server/aiStreaming.ts"] },
    { id: "p3", parentId: "p1", title: "Parallel eval batching", status: "failed", score: 0.42, testsPassed: 8, testsFailed: 3, createdAt: Date.now() - 1800000, files: ["server/parallelRsi.ts"] },
    { id: "p4", parentId: "p2", title: "Adaptive token budget", status: "running", testsPassed: 5, testsFailed: 0, createdAt: Date.now() - 600000, files: ["server/tokenBudgetManager.ts"] },
    { id: "p5", parentId: "p2", title: "LoRA weight merge", status: "pending", createdAt: Date.now() - 300000, files: ["server/loraWeights.ts"] },
    { id: "p6", parentId: "p3", title: "Fallback eval strategy", status: "pending", createdAt: Date.now() - 120000, files: ["server/evalStrategy.ts"] },
    { id: "p7", parentId: "p4", title: "Context window optimizer", status: "pending", createdAt: Date.now() - 60000, files: ["server/contextWindow.ts"] },
  ];
}
