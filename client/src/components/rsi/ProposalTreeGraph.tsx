/**
 * ProposalTreeGraph.tsx — v12.2.0 — SOTA Command Center
 *
 * The RSI control center. Everything in one panel:
 *   • RSI on/off toggle + trigger button
 *   • Live status hero (phase, score, cost, cycle count)
 *   • Real-time SSE activity feed (right rail)
 *   • Redesigned proposal tree graph (main canvas)
 *   • Beautiful node cards with score bars, test badges, file pills
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
  DollarSign,
  TrendingUp,
  Layers,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";

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
  schedulerPaused?: boolean;
  costStats?: { totalCost: number; dailyCap: number };
}

interface LiveEvent {
  id: string;
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

// ─── Status Config ────────────────────────────────────────────────────────────

const STATUS_CFG = {
  pending:  { border: "#fbbf2440", bg: "#fbbf2410", glow: "0 0 20px #fbbf2420", dot: "#fbbf24", badge: { bg: "#fbbf2420", text: "#fbbf24", border: "#fbbf2440" }, label: "PENDING",  edge: "#fbbf24" },
  running:  { border: "#818cf880", bg: "#6366f115", glow: "0 0 28px #6366f140", dot: "#818cf8", badge: { bg: "#6366f120", text: "#818cf8", border: "#6366f150" }, label: "RUNNING",  edge: "#818cf8" },
  passed:   { border: "#34d39940", bg: "#10b98110", glow: "0 0 20px #10b98120", dot: "#34d399", badge: { bg: "#10b98120", text: "#34d399", border: "#10b98140" }, label: "PASSED",   edge: "#34d399" },
  failed:   { border: "#fb718540", bg: "#f43f5e10", glow: "0 0 20px #f43f5e20", dot: "#fb7185", badge: { bg: "#f43f5e20", text: "#fb7185", border: "#f43f5e30" }, label: "FAILED",   edge: "#fb7185" },
  adopted:  { border: "#a78bfa80", bg: "#7c3aed15", glow: "0 0 32px #7c3aed50", dot: "#a78bfa", badge: { bg: "#7c3aed25", text: "#c4b5fd", border: "#7c3aed60" }, label: "ADOPTED",  edge: "#a78bfa" },
} as const;

const EVENT_CFG: Record<string, { icon: string; color: string; label: string }> = {
  "proposal:new":      { icon: "✦", color: "#818cf8", label: "New proposal" },
  "proposal:applied":  { icon: "✓", color: "#34d399", label: "Applied" },
  "proposal:rejected": { icon: "✗", color: "#fb7185", label: "Rejected" },
  "cycle:start":       { icon: "◉", color: "#a78bfa", label: "Cycle started" },
  "cycle:complete":    { icon: "★", color: "#fbbf24", label: "Cycle complete" },
  "parallel:start":    { icon: "⊞", color: "#60a5fa", label: "Parallel start" },
  "parallel:complete": { icon: "⊡", color: "#34d399", label: "Parallel done" },
  "heartbeat":         { icon: "·", color: "#3f3f46", label: "Heartbeat" },
};

// ─── Proposal Node Card ───────────────────────────────────────────────────────

function ProposalNodeCard({ data }: { data: Record<string, unknown> }) {
  const p = data as unknown as ProposalNode;
  const cfg = STATUS_CFG[p.status] ?? STATUS_CFG.pending;
  const score = p.score != null ? Math.round(p.score * 100) : null;
  const isRunning = p.status === "running";

  return (
    <div style={{
      background: `linear-gradient(145deg, #111113 0%, ${cfg.bg} 100%)`,
      border: `1px solid ${cfg.border}`,
      boxShadow: cfg.glow,
      borderRadius: 14,
      width: 260,
      padding: "14px 16px 12px",
      position: "relative",
      overflow: "hidden",
      fontFamily: "Inter, system-ui, sans-serif",
    }}>
      {/* Top accent line */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent 0%, ${cfg.dot} 50%, transparent 100%)`, opacity: 0.7 }} />

      <Handle type="target" position={Position.Top} style={{ background: cfg.dot, border: "2px solid #09090b", width: 10, height: 10, top: -5 }} />

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: cfg.dot, flexShrink: 0, marginTop: 3, boxShadow: `0 0 8px ${cfg.dot}` }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "#f4f4f5", fontWeight: 600, fontSize: 13, lineHeight: 1.35, letterSpacing: "-0.02em", wordBreak: "break-word" }}>
            {p.isRoot ? "⬡ RSI Root" : p.title}
          </div>
        </div>
        {isRunning && (
          <div style={{ width: 16, height: 16, flexShrink: 0 }}>
            <svg viewBox="0 0 16 16" style={{ animation: "spin 1.2s linear infinite", width: 16, height: 16 }}>
              <circle cx="8" cy="8" r="6" fill="none" stroke="#6366f1" strokeWidth="2" strokeDasharray="20 18" />
            </svg>
          </div>
        )}
      </div>

      {/* Score bar */}
      {score != null && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: "#71717a", fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase" }}>Score</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: cfg.dot, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{score.toFixed(1)}%</span>
          </div>
          <div style={{ height: 4, background: "#1f1f23", borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${Math.min(score, 100)}%`,
              background: `linear-gradient(90deg, ${cfg.dot}80, ${cfg.dot})`,
              borderRadius: 4,
              transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
            }} />
          </div>
        </div>
      )}

      {/* Test badges */}
      {(p.testsPassed != null || p.testsFailed != null) && (
        <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
          {p.testsPassed != null && (
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)", fontWeight: 600, letterSpacing: "0.01em" }}>
              ✓ {p.testsPassed}
            </span>
          )}
          {(p.testsFailed ?? 0) > 0 && (
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(244,63,94,0.12)", color: "#fb7185", border: "1px solid rgba(244,63,94,0.25)", fontWeight: 600 }}>
              ✗ {p.testsFailed}
            </span>
          )}
        </div>
      )}

      {/* File pills */}
      {p.files && p.files.length > 0 && (
        <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 2 }}>
          {p.files.slice(0, 2).map((f, i) => (
            <div key={i} style={{ fontSize: 10, color: "#52525b", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.6, padding: "1px 0" }}>
              {f.split("/").slice(-2).join("/")}
            </div>
          ))}
          {p.files.length > 2 && <div style={{ fontSize: 10, color: "#3f3f46" }}>+{p.files.length - 2} more files</div>}
        </div>
      )}

      {/* Status badge */}
      <div style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 20, background: cfg.badge.bg, color: cfg.badge.text, border: `1px solid ${cfg.badge.border}`, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em" }}>
        {cfg.label}
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: cfg.dot, border: "2px solid #09090b", width: 10, height: 10, bottom: -5 }} />
    </div>
  );
}

const nodeTypes = { proposal: ProposalNodeCard };

// ─── Layout Helper ────────────────────────────────────────────────────────────

function proposalsToFlow(proposals: ProposalNode[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [{
    id: "root",
    type: "proposal",
    position: { x: 0, y: 0 },
    data: { id: "root", title: "RSI Root", status: "adopted", score: 1, createdAt: Date.now(), isRoot: true } as unknown as Record<string, unknown>,
  }];
  const edges: Edge[] = [];

  const levelMap: Record<string, number> = { root: 0 };
  const childCount: Record<string, number> = {};
  for (const p of proposals) {
    const pid = p.parentId ?? "root";
    childCount[pid] = (childCount[pid] ?? 0) + 1;
  }
  const posIdx: Record<string, number> = {};
  for (const p of proposals) {
    const pid = p.parentId ?? "root";
    const level = (levelMap[pid] ?? 0) + 1;
    levelMap[p.id] = level;
    posIdx[pid] = (posIdx[pid] ?? -1) + 1;
    const sibIdx = posIdx[pid];
    const total = childCount[pid] ?? 1;
    const x = sibIdx * 320 - (total - 1) * 160;
    const y = level * 220;
    nodes.push({ id: p.id, type: "proposal", position: { x, y }, data: p as unknown as Record<string, unknown> });
    const cfg = STATUS_CFG[p.status] ?? STATUS_CFG.pending;
    edges.push({
      id: `e-${pid}-${p.id}`,
      source: pid,
      target: p.id,
      animated: p.status === "running",
      style: {
        stroke: cfg.edge,
        strokeWidth: p.status === "adopted" ? 2.5 : 1.5,
        opacity: p.status === "failed" ? 0.45 : 0.8,
      },
    });
  }
  return { nodes, edges };
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
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [showActivityFeed, setShowActivityFeed] = useState(true);

  const sseRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventFeedRef = useRef<HTMLDivElement>(null);

  const adminKey = typeof localStorage !== "undefined" ? (localStorage.getItem("andromeda_admin_key") ?? "") : "";

  const authHeaders: Record<string, string> = adminKey
    ? { "Content-Type": "application/json", "X-Admin-Key": adminKey }
    : { "Content-Type": "application/json" };

  // Status counts
  const statusCounts = proposals.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  // Load proposals
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
      setLastUpdated(new Date());
    } catch {
      setProposals(getDemoProposals());
      setLastUpdated(new Date());
    }
  }, []);

  // Load RSI status
  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/rsi/status");
      if (r.ok) setStatus(await r.json());
    } catch { /* ignore */ }
  }, []);

  // Toggle RSI scheduler pause/resume
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

  // Trigger immediate RSI cycle
  const triggerNow = useCallback(async () => {
    setTriggering(true);
    try {
      await fetch("/api/rsi/scheduler/trigger", { method: "POST", headers: authHeaders });
      await loadProposals();
    } finally {
      setTimeout(() => setTriggering(false), 2000);
    }
  }, [authHeaders, loadProposals]);

  // Update flow graph when proposals change
  useEffect(() => {
    if (proposals.length === 0) return;
    const { nodes: n, edges: e } = proposalsToFlow(proposals);
    setNodes(n);
    setEdges(e);
  }, [proposals, setNodes, setEdges]);

  // SSE connection
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
          setEvents(prev => {
            const next = [{ id: `${Date.now()}-${Math.random()}`, type: parsed.type, timestamp: parsed.timestamp, data: parsed.data }, ...prev].slice(0, 100);
            return next;
          });
        } catch { /* ignore */ }
        if (type !== "heartbeat") { loadProposals(); loadStatus(); }
      };

      ["proposal:new", "proposal:applied", "proposal:rejected", "proposal:updated",
       "cycle:start", "cycle:complete", "parallel:start", "parallel:complete", "heartbeat"]
        .forEach(ev => sse.addEventListener(ev, addEvent(ev)));

      sse.onerror = () => {
        setSseConnected(false);
        if (!pollRef.current) {
          pollRef.current = setInterval(() => { loadProposals(); loadStatus(); }, 5000);
        }
      };
    } catch {
      pollRef.current = setInterval(() => { loadProposals(); loadStatus(); }, 5000);
    }

    // Status polling
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#09090b", borderRadius: 12, overflow: "hidden", fontFamily: "Inter, system-ui, sans-serif" }}>

      {/* ── Top gradient accent ── */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg, transparent, #7c3aed, #6366f1, transparent)", zIndex: 10 }} />

      {/* ── Command Bar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "#0d0d10", borderBottom: "1px solid #1f1f23", flexShrink: 0, zIndex: 5 }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: "linear-gradient(135deg, #7c3aed, #6366f1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <GitBranch style={{ width: 12, height: 12, color: "#fff" }} />
          </div>
          <span style={{ fontSize: 13, color: "#f4f4f5", fontWeight: 600, letterSpacing: "-0.02em" }}>RSI Proposal Tree</span>
        </div>

        {/* SSE indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 20, background: sseConnected ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)", border: `1px solid ${sseConnected ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)"}` }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: sseConnected ? "#34d399" : "#fbbf24", boxShadow: `0 0 5px ${sseConnected ? "#34d399" : "#fbbf24"}` }} />
          <span style={{ fontSize: 10, color: sseConnected ? "#34d399" : "#fbbf24", fontWeight: 600 }}>{sseConnected ? "LIVE" : "POLL"}</span>
        </div>

        {/* Status counts */}
        <div style={{ display: "flex", gap: 4 }}>
          {(["adopted", "passed", "running", "failed", "pending"] as const).map(s => {
            const count = statusCounts[s];
            if (!count) return null;
            const cfg = STATUS_CFG[s];
            return (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 20, background: cfg.badge.bg, border: `1px solid ${cfg.badge.border}` }}>
                <span style={{ fontSize: 11, color: cfg.badge.text, fontWeight: 700 }}>{count}</span>
                <span style={{ fontSize: 10, color: cfg.dot }}>{s}</span>
              </div>
            );
          })}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Last updated */}
        {lastUpdated && <span style={{ fontSize: 11, color: "#3f3f46", fontVariantNumeric: "tabular-nums" }}>{lastUpdated.toLocaleTimeString()}</span>}

        {/* Activity feed toggle */}
        <button onClick={() => setShowActivityFeed(v => !v)} style={{ padding: "4px 10px", borderRadius: 8, background: showActivityFeed ? "rgba(99,102,241,0.12)" : "rgba(39,39,42,0.6)", border: `1px solid ${showActivityFeed ? "rgba(99,102,241,0.3)" : "#27272a"}`, color: showActivityFeed ? "#818cf8" : "#71717a", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.2s ease" }}>
          <Activity style={{ width: 11, height: 11, display: "inline", marginRight: 4 }} />
          Feed
        </button>
      </div>

      {/* ── Status Hero ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, background: "#0a0a0d", borderBottom: "1px solid #1a1a1e", flexShrink: 0, overflow: "hidden" }}>
        {/* RSI Toggle */}
        <div style={{ padding: "12px 20px", borderRight: "1px solid #1a1a1e", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ position: "relative" }}>
            {isRunning && (
              <div style={{ position: "absolute", inset: -4, borderRadius: "50%", background: "rgba(124,58,237,0.2)", animation: "ping 2s cubic-bezier(0,0,0.2,1) infinite" }} />
            )}
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: isRunning ? "#a78bfa" : "#3f3f46", boxShadow: isRunning ? "0 0 10px #7c3aed" : "none", position: "relative" }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#71717a", fontWeight: 500, marginBottom: 1 }}>Status</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: isRunning ? "#a78bfa" : "#52525b", letterSpacing: "-0.02em" }}>{isRunning ? "RUNNING" : "PAUSED"}</div>
          </div>
        </div>

        {/* Phase */}
        <div style={{ padding: "12px 20px", borderRight: "1px solid #1a1a1e" }}>
          <div style={{ fontSize: 11, color: "#71717a", fontWeight: 500, marginBottom: 1 }}>Phase</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#e4e4e7", letterSpacing: "-0.01em", textTransform: "capitalize" }}>{phase}</div>
        </div>

        {/* Cycles */}
        <div style={{ padding: "12px 20px", borderRight: "1px solid #1a1a1e" }}>
          <div style={{ fontSize: 11, color: "#71717a", fontWeight: 500, marginBottom: 1 }}>Cycles</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f4f4f5", fontVariantNumeric: "tabular-nums" }}>#{cycleCount.toLocaleString()}</div>
        </div>

        {/* Score */}
        {avgScore != null && (
          <div style={{ padding: "12px 20px", borderRight: "1px solid #1a1a1e" }}>
            <div style={{ fontSize: 11, color: "#71717a", fontWeight: 500, marginBottom: 1 }}>Avg Score</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#34d399", fontVariantNumeric: "tabular-nums" }}>{(avgScore * 100).toFixed(2)}%</div>
          </div>
        )}

        {/* Cost */}
        <div style={{ padding: "12px 20px", borderRight: "1px solid #1a1a1e" }}>
          <div style={{ fontSize: 11, color: "#71717a", fontWeight: 500, marginBottom: 1 }}>Cost</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: cost > dailyCap * 0.8 ? "#fb7185" : "#a1a1aa", fontVariantNumeric: "tabular-nums" }}>
            ${cost.toFixed(4)} <span style={{ color: "#3f3f46", fontSize: 11 }}>/ ${dailyCap}</span>
          </div>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Controls */}
        <div style={{ padding: "10px 16px", display: "flex", gap: 8 }}>
          <button
            onClick={toggleRsi}
            disabled={toggling}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 14px", borderRadius: 8,
              background: isRunning ? "rgba(244,63,94,0.1)" : "rgba(16,185,129,0.1)",
              border: `1px solid ${isRunning ? "rgba(244,63,94,0.3)" : "rgba(16,185,129,0.3)"}`,
              color: isRunning ? "#fb7185" : "#34d399",
              fontSize: 12, fontWeight: 600, cursor: toggling ? "not-allowed" : "pointer",
              opacity: toggling ? 0.6 : 1, transition: "all 0.2s ease",
            }}
          >
            {toggling ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : isRunning ? <Pause style={{ width: 12, height: 12 }} /> : <Play style={{ width: 12, height: 12 }} />}
            {isRunning ? "Pause RSI" : "Resume RSI"}
          </button>

          <button
            onClick={triggerNow}
            disabled={triggering}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 14px", borderRadius: 8,
              background: "linear-gradient(135deg, rgba(124,58,237,0.15), rgba(99,102,241,0.15))",
              border: "1px solid rgba(124,58,237,0.35)",
              color: "#c4b5fd",
              fontSize: 12, fontWeight: 600, cursor: triggering ? "not-allowed" : "pointer",
              opacity: triggering ? 0.6 : 1, transition: "all 0.2s ease",
            }}
          >
            {triggering ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <SkipForward style={{ width: 12, height: 12 }} />}
            Trigger Now
          </button>
        </div>
      </div>

      {/* ── Main Content (Graph + Feed) ── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>

        {/* Graph Canvas */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            minZoom={0.1}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="rgba(124,58,237,0.07)" />
            <Controls style={{ background: "#111113", border: "1px solid #27272a", borderRadius: 10, boxShadow: "0 4px 24px rgba(0,0,0,0.5)" }} />
            <MiniMap
              style={{ background: "#0d0d10", border: "1px solid #27272a", borderRadius: 10 }}
              nodeColor={(n) => STATUS_CFG[(n.data as unknown as ProposalNode).status as keyof typeof STATUS_CFG]?.dot ?? "#52525b"}
              maskColor="rgba(9,9,11,0.8)"
            />
          </ReactFlow>
        </div>

        {/* Activity Feed */}
        {showActivityFeed && (
          <div style={{ width: 260, borderLeft: "1px solid #1a1a1e", background: "#0a0a0d", display: "flex", flexDirection: "column", flexShrink: 0 }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #1a1a1e", display: "flex", alignItems: "center", gap: 6 }}>
              <Radio style={{ width: 11, height: 11, color: "#a78bfa" }} />
              <span style={{ fontSize: 11, color: "#a1a1aa", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>Live Activity</span>
              {events.length > 0 && (
                <div style={{ marginLeft: "auto", fontSize: 10, color: "#3f3f46", fontVariantNumeric: "tabular-nums" }}>{events.length}</div>
              )}
            </div>
            <div ref={eventFeedRef} style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
              {events.length === 0 ? (
                <div style={{ padding: "20px 14px", textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#3f3f46" }}>Waiting for events…</div>
                </div>
              ) : (
                events.map(ev => {
                  const cfg = EVENT_CFG[ev.type] ?? { icon: "·", color: "#52525b", label: ev.type };
                  const title = (ev.data.title ?? ev.data.description ?? ev.data.phase ?? cfg.label) as string;
                  const time = new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                  return (
                    <div key={ev.id} style={{ display: "flex", gap: 8, padding: "6px 14px", borderBottom: "1px solid #111113", transition: "background 0.15s ease" }}>
                      <div style={{ width: 18, height: 18, borderRadius: "50%", background: `${cfg.color}15`, border: `1px solid ${cfg.color}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                        <span style={{ fontSize: 9, color: cfg.color, fontWeight: 700 }}>{cfg.icon}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: "#d4d4d8", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.4 }}>{String(title).slice(0, 40)}</div>
                        <div style={{ fontSize: 10, color: "#3f3f46", fontVariantNumeric: "tabular-nums", marginTop: 1 }}>{time}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Demo Data ────────────────────────────────────────────────────────────────

function getDemoProposals(): ProposalNode[] {
  return [
    { id: "p1", title: "Optimize LLM cache", status: "adopted", score: 0.94, testsPassed: 47, testsFailed: 0, createdAt: Date.now() - 3600000, files: ["server/llmProvider.ts"] },
    { id: "p2", parentId: "p1", title: "Add streaming retry", status: "passed", score: 0.88, testsPassed: 12, testsFailed: 0, createdAt: Date.now() - 2400000, files: ["server/aiStreaming.ts"] },
    { id: "p3", parentId: "p1", title: "Parallel eval batching", status: "failed", score: 0.42, testsPassed: 8, testsFailed: 3, createdAt: Date.now() - 1800000, files: ["server/parallelRsi.ts"] },
    { id: "p4", parentId: "p2", title: "Adaptive token budget", status: "running", testsPassed: 5, testsFailed: 0, createdAt: Date.now() - 600000, files: ["server/tokenBudgetManager.ts"] },
    { id: "p5", parentId: "p2", title: "LoRA weight merge", status: "pending", createdAt: Date.now() - 300000, files: ["server/localLora.ts", "server/selfDistillation.ts"] },
    { id: "p6", parentId: "p3", title: "Retry with backoff", status: "passed", score: 0.79, testsPassed: 9, testsFailed: 0, createdAt: Date.now() - 900000, files: ["server/parallelRsi.ts"] },
  ];
}
