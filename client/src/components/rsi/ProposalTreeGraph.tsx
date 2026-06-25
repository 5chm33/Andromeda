/**
 * ProposalTreeGraph.tsx — v12.4.1 — Clean Command Center (replaces flow graph)
 *
 * The old ReactFlow graph has been completely removed.
 * This component now renders a clean vertical table of proposals
 * with status badges, RLHF thumbs, expandable diffs, and a live activity feed.
 *
 * Export name kept as `ProposalTreeGraph` so all lazy imports in
 * Workspace.tsx and ArtifactPanel.tsx continue to work without changes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Zap,
  GitBranch,
  FileCode2,
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  ChevronUp,
  Search,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";

type ProposalStatus = "pending" | "running" | "committed" | "rejected" | "expired";

interface Proposal {
  id: string;
  targetFile: string;
  title: string;
  rationale?: string;
  status: ProposalStatus;
  createdAt: string;
  appliedAt?: string;
  diff?: string;
  score?: number;
  rlhf?: "accept" | "reject" | null;
}

interface RsiStatus {
  cycleCount: number;
  phase: string;
  isRunning: boolean;
  totalCost: number;
  proposalCount: number;
  avgScore?: number;
}

interface ActivityEvent {
  id: string;
  type: string;
  message: string;
  timestamp: number;
  proposalId?: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function shortFile(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts.slice(-2).join("/");
}

const STATUS_COLOR: Record<ProposalStatus, { bg: string; text: string; label: string }> = {
  pending:   { bg: "rgba(124,58,237,0.15)", text: "#c4b5fd", label: "Pending" },
  running:   { bg: "rgba(234,179,8,0.15)",  text: "#fde047", label: "Running" },
  committed: { bg: "rgba(34,197,94,0.15)",  text: "#86efac", label: "Committed" },
  rejected:  { bg: "rgba(239,68,68,0.15)",  text: "#fca5a5", label: "Rejected" },
  expired:   { bg: "rgba(113,113,122,0.15)",text: "#a1a1aa", label: "Expired" },
};

function StatusBadge({ status }: { status: ProposalStatus }) {
  const c = STATUS_COLOR[status];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 9999, fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.text,
    }}>
      {status === "running" && <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} />}
      {status === "committed" && <CheckCircle2 style={{ width: 10, height: 10 }} />}
      {status === "rejected" && <XCircle style={{ width: 10, height: 10 }} />}
      {status === "pending" && <Clock style={{ width: 10, height: 10 }} />}
      {c.label}
    </span>
  );
}

function DiffBlock({ diff }: { diff: string }) {
  return (
    <div style={{
      maxHeight: 220, overflowY: "auto", borderRadius: 8,
      background: "#0d0d10", border: "1px solid #27272a",
      padding: "8px 12px", fontFamily: "monospace", fontSize: 11, lineHeight: 1.6,
    }}>
      {diff.split("\n").map((line, i) => {
        const color = line.startsWith("+") ? "#86efac" : line.startsWith("-") ? "#fca5a5" : "#52525b";
        return <div key={i} style={{ color, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{line || "\u00a0"}</div>;
      })}
    </div>
  );
}

function ProposalRow({ proposal, onRlhf }: { proposal: Proposal; onRlhf: (id: string, vote: "accept" | "reject") => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid #18181b" }}>
      <div
        onClick={() => proposal.diff && setExpanded(e => !e)}
        style={{ display: "grid", gridTemplateColumns: "1fr 2fr 110px 70px 72px", gap: 8, alignItems: "center", padding: "10px 16px", cursor: proposal.diff ? "pointer" : "default", transition: "background 0.1s" }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.02)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <FileCode2 style={{ width: 13, height: 13, color: "#52525b", flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: "#a1a1aa", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortFile(proposal.targetFile)}</span>
        </div>
        <div style={{ fontSize: 12, color: "#d4d4d8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proposal.title}</div>
        <div><StatusBadge status={proposal.status} /></div>
        <div style={{ fontSize: 11, color: "#52525b", textAlign: "right" }}>{timeAgo(proposal.appliedAt || proposal.createdAt)}</div>
        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
          {proposal.status === "committed" ? (
            <>
              <button onClick={e => { e.stopPropagation(); onRlhf(proposal.id, "accept"); }} title="Good improvement" style={{ background: proposal.rlhf === "accept" ? "rgba(34,197,94,0.2)" : "transparent", border: `1px solid ${proposal.rlhf === "accept" ? "#86efac" : "#27272a"}`, color: proposal.rlhf === "accept" ? "#86efac" : "#52525b", borderRadius: 6, padding: "3px 6px", cursor: "pointer", transition: "all 0.15s" }}>
                <ThumbsUp style={{ width: 11, height: 11 }} />
              </button>
              <button onClick={e => { e.stopPropagation(); onRlhf(proposal.id, "reject"); }} title="Bad improvement" style={{ background: proposal.rlhf === "reject" ? "rgba(239,68,68,0.2)" : "transparent", border: `1px solid ${proposal.rlhf === "reject" ? "#fca5a5" : "#27272a"}`, color: proposal.rlhf === "reject" ? "#fca5a5" : "#52525b", borderRadius: 6, padding: "3px 6px", cursor: "pointer", transition: "all 0.15s" }}>
                <ThumbsDown style={{ width: 11, height: 11 }} />
              </button>
            </>
          ) : <span style={{ width: 52 }} />}
          {proposal.diff && <span style={{ color: "#3f3f46", marginLeft: 2 }}>{expanded ? <ChevronUp style={{ width: 12, height: 12 }} /> : <ChevronDown style={{ width: 12, height: 12 }} />}</span>}
        </div>
      </div>
      {expanded && proposal.diff && (
        <div style={{ padding: "0 16px 12px" }}>
          {proposal.rationale && <p style={{ fontSize: 11, color: "#71717a", marginBottom: 8, fontStyle: "italic" }}>{proposal.rationale}</p>}
          <DiffBlock diff={proposal.diff} />
        </div>
      )}
    </div>
  );
}

function GitHubFixerModal({ onClose }: { onClose: () => void }) {
  const [repoUrl, setRepoUrl] = useState("");
  const [pat, setPat] = useState("");
  const [cycles, setCycles] = useState(3);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [log, setLog] = useState<string[]>([]);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  const handleSubmit = async () => {
    if (!repoUrl.trim()) return;
    setStatus("running"); setLog(["Starting job..."]); setPrUrl(null);
    try {
      let adminKey = "";
      try { const kr = await fetch("/api/admin/local-key", { signal: AbortSignal.timeout(5000) }); if (kr.ok) { const kd = await kr.json(); adminKey = kd.key || ""; } } catch { /* ignore */ }
      const res = await fetch("/api/rsi/external-repo/fix", { method: "POST", headers: { "Content-Type": "application/json", ...(adminKey ? { "X-Admin-Key": adminKey } : {}) }, body: JSON.stringify({ repoUrl: repoUrl.trim(), githubPat: pat.trim() || undefined, cycles }) });
      if (!res.ok) { const err = await res.text(); setLog(l => [...l, `Error: ${err}`]); setStatus("failed"); return; }
      const { jobId } = await res.json();
      setLog(l => [...l, `Job started: ${jobId}`]);
      const sse = new EventSource(`/api/rsi/external-repo/events/${jobId}${adminKey ? `?key=${encodeURIComponent(adminKey)}` : ""}`);
      sse.onmessage = (e) => { try { const ev = JSON.parse(e.data); setLog(l => [...l, ev.message || JSON.stringify(ev)]); if (ev.prUrl) setPrUrl(ev.prUrl); if (ev.status === "done" || ev.status === "failed") { setStatus(ev.status === "done" ? "done" : "failed"); sse.close(); } } catch { /* ignore */ } };
      sse.onerror = () => { setStatus("failed"); setLog(l => [...l, "Connection lost."]); sse.close(); };
    } catch (err: any) { setLog(l => [...l, `Error: ${err?.message || err}`]); setStatus("failed"); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "100%", maxWidth: 520, background: "#111113", border: "1px solid #27272a", borderRadius: 16, padding: 24, boxShadow: "0 24px 80px rgba(0,0,0,0.8)", color: "#e4e4e7" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 20 }}>🤖</span><span style={{ fontSize: 16, fontWeight: 700, color: "#fafafa" }}>Fix Any GitHub Repo</span></div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#71717a", cursor: "pointer", fontSize: 18 }}>×</button>
        </div>
        <p style={{ fontSize: 12, color: "#71717a", marginBottom: 20 }}>Andromeda will clone the repo, apply RSI improvements, commit to a new branch, and open a Pull Request.</p>
        {(status === "idle" || status === "failed") ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: "#a1a1aa", display: "block", marginBottom: 4 }}>GitHub Repository URL *</label>
              <input value={repoUrl} onChange={e => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repo" style={{ width: "100%", background: "#0d0d10", border: "1px solid #27272a", borderRadius: 8, padding: "8px 12px", color: "#e4e4e7", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: "#a1a1aa", display: "block", marginBottom: 4 }}>GitHub PAT (optional)</label>
              <input type="password" value={pat} onChange={e => setPat(e.target.value)} placeholder="ghp_..." style={{ width: "100%", background: "#0d0d10", border: "1px solid #27272a", borderRadius: 8, padding: "8px 12px", color: "#e4e4e7", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, color: "#a1a1aa", display: "block", marginBottom: 6 }}>RSI Cycles: {cycles}</label>
              <div style={{ display: "flex", gap: 6 }}>
                {[1, 2, 3, 5, 10].map(n => <button key={n} onClick={() => setCycles(n)} style={{ padding: "4px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", background: cycles === n ? "rgba(124,58,237,0.2)" : "transparent", border: `1px solid ${cycles === n ? "#7c3aed" : "#27272a"}`, color: cycles === n ? "#c4b5fd" : "#71717a" }}>{n}</button>)}
              </div>
            </div>
            {status === "failed" && log.length > 0 && <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(239,68,68,0.1)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.2)", fontSize: 11, color: "#fca5a5" }}>{log[log.length - 1]}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, background: "transparent", border: "1px solid #27272a", color: "#71717a", cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button onClick={handleSubmit} disabled={!repoUrl.trim()} style={{ padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: repoUrl.trim() ? "pointer" : "not-allowed", background: repoUrl.trim() ? "rgba(124,58,237,0.9)" : "rgba(124,58,237,0.3)", border: "none", color: "#fff" }}>🚀 Start Fix</button>
            </div>
          </>
        ) : (
          <>
            <div ref={logRef} style={{ height: 200, overflowY: "auto", background: "#0d0d10", border: "1px solid #27272a", borderRadius: 8, padding: "8px 12px", fontFamily: "monospace", fontSize: 11, color: "#a1a1aa", marginBottom: 16 }}>
              {log.map((l, i) => <div key={i} style={{ marginBottom: 2 }}>{l}</div>)}
              {status === "running" && <div style={{ color: "#c4b5fd", display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}><Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> Working...</div>}
            </div>
            {prUrl && <div style={{ marginBottom: 16, padding: "8px 12px", background: "rgba(34,197,94,0.1)", borderRadius: 8, border: "1px solid rgba(34,197,94,0.2)" }}><span style={{ fontSize: 12, color: "#86efac" }}>PR opened: </span><a href={prUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#60a5fa" }}>{prUrl}</a></div>}
            {(status === "done" || status === "failed") && (
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, background: "transparent", border: "1px solid #27272a", color: "#71717a", cursor: "pointer", fontSize: 13 }}>Close</button>
                <button onClick={() => { setStatus("idle"); setLog([]); setPrUrl(null); }} style={{ padding: "8px 16px", borderRadius: 8, background: "rgba(124,58,237,0.2)", border: "1px solid #7c3aed", color: "#c4b5fd", cursor: "pointer", fontSize: 13 }}>Fix Another</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function ProposalTreeGraph() {
  const [status, setStatus] = useState<RsiStatus>({ cycleCount: 0, phase: "Idle", isRunning: false, totalCost: 0, proposalCount: 0 });
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "committed" | "rejected">("all");
  const [search, setSearch] = useState("");
  const [rlhfMap, setRlhfMap] = useState<Record<string, "accept" | "reject">>({});
  const [showGitHub, setShowGitHub] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const loadProposals = useCallback(() => {
    fetch("/api/rsi/history").then(r => r.ok ? r.json() : null).then(d => {
      if (!d) return;
      const list: Proposal[] = (d.proposals || d || []).map((p: any) => ({
        id: p.id, targetFile: p.targetFile || p.filename || "unknown",
        title: p.title || p.rationale?.slice(0, 60) || "Improvement",
        rationale: p.rationale, status: p.status || "pending",
        createdAt: p.createdAt || new Date().toISOString(), appliedAt: p.appliedAt,
        diff: p.diff, score: p.score, rlhf: rlhfMap[p.id] || null,
      }));
      setProposals(list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    }).catch(() => {});
  }, [rlhfMap]);

  const loadStatus = useCallback(() => {
    fetch("/api/rsi/status").then(r => r.ok ? r.json() : null).then(d => {
      if (!d) return;
      setStatus({ cycleCount: d.cycleCount ?? d.cycles ?? 0, phase: d.phase ?? "Idle", isRunning: d.isRunning ?? d.running ?? false, totalCost: d.totalCost ?? d.cost ?? 0, proposalCount: d.proposalCount ?? d.proposals ?? 0, avgScore: d.avgScore });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadStatus(); loadProposals();
    const si = setInterval(loadStatus, 8000);
    const pi = setInterval(loadProposals, 15000);
    const sse = new EventSource("/api/rsi/events");
    sse.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        setEvents(prev => [{ id: ev.id || `ev_${Date.now()}`, type: ev.type || "event", message: ev.message || ev.type, timestamp: ev.timestamp || Date.now(), proposalId: ev.proposalId }, ...prev.slice(0, 49)]);
        if (ev.type?.includes("cycle") || ev.type?.includes("proposal")) { loadStatus(); loadProposals(); }
      } catch { /* ignore */ }
    };
    return () => { clearInterval(si); clearInterval(pi); sse.close(); };
  }, [loadStatus, loadProposals]);

  const handleRlhf = useCallback((proposalId: string, vote: "accept" | "reject") => {
    setRlhfMap(m => ({ ...m, [proposalId]: vote }));
    fetch("/api/v71/rlhf/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposalId, feedback: vote, source: "widget" }) }).catch(() => {});
  }, []);

  const toggleRsi = async () => {
    setToggling(true);
    try { await fetch(status.isRunning ? "/api/rsi/pause" : "/api/rsi/resume", { method: "POST" }); setTimeout(loadStatus, 800); } catch { /* ignore */ }
    setToggling(false);
  };

  const triggerCycle = async () => {
    setTriggering(true);
    try {
      let adminKey = "";
      try { const kr = await fetch("/api/admin/local-key", { signal: AbortSignal.timeout(3000) }); if (kr.ok) { const kd = await kr.json(); adminKey = kd.key || ""; } } catch { /* ignore */ }
      await fetch("/api/rsi/trigger", { method: "POST", headers: { "X-Admin-Key": adminKey } });
      setTimeout(loadStatus, 1000);
    } catch { /* ignore */ }
    setTriggering(false);
  };

  const filtered = proposals.filter(p => {
    if (filter !== "all" && p.status !== filter) return false;
    if (search) { const q = search.toLowerCase(); return p.targetFile.toLowerCase().includes(q) || p.title.toLowerCase().includes(q); }
    return true;
  }).map(p => ({ ...p, rlhf: rlhfMap[p.id] || p.rlhf || null }));

  const counts = { all: proposals.length, pending: proposals.filter(p => p.status === "pending").length, committed: proposals.filter(p => p.status === "committed").length, rejected: proposals.filter(p => p.status === "rejected").length };
  const successRate = counts.committed + counts.rejected > 0 ? Math.round((counts.committed / (counts.committed + counts.rejected)) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#09090b", color: "#e4e4e7", fontFamily: "system-ui, -apple-system, sans-serif", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid #18181b", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(124,58,237,0.2)", border: "1px solid rgba(124,58,237,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Activity style={{ width: 14, height: 14, color: "#c4b5fd" }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fafafa", letterSpacing: "-0.02em" }}>RSI Command Center</div>
            <div style={{ fontSize: 10, color: "#52525b" }}>v12.4.1 · Recursive Self-Improvement</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 9999, background: status.isRunning ? "rgba(34,197,94,0.1)" : "rgba(113,113,122,0.1)", border: `1px solid ${status.isRunning ? "rgba(34,197,94,0.25)" : "rgba(113,113,122,0.25)"}` }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: status.isRunning ? "#22c55e" : "#71717a", animation: status.isRunning ? "pulse 2s infinite" : "none" }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: status.isRunning ? "#86efac" : "#71717a" }}>{status.isRunning ? "LIVE" : "PAUSED"}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setShowGitHub(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)", color: "#c4b5fd", cursor: "pointer" }}>
            <GitBranch style={{ width: 12, height: 12 }} /> Fix Any GitHub Repo
          </button>
          <button onClick={toggleRsi} disabled={toggling} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: status.isRunning ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)", border: `1px solid ${status.isRunning ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`, color: status.isRunning ? "#fca5a5" : "#86efac", cursor: toggling ? "not-allowed" : "pointer" }}>
            {toggling ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : status.isRunning ? <Pause style={{ width: 11, height: 11 }} /> : <Play style={{ width: 11, height: 11 }} />}
            {status.isRunning ? "Pause RSI" : "Resume RSI"}
          </button>
          <button onClick={triggerCycle} disabled={triggering} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)", color: "#c4b5fd", cursor: triggering ? "not-allowed" : "pointer" }}>
            {triggering ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <Zap style={{ width: 11, height: 11 }} />} Trigger Cycle
          </button>
        </div>
      </div>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderBottom: "1px solid #18181b", flexShrink: 0 }}>
        {[{ label: "Cycles", value: `#${status.cycleCount.toLocaleString()}`, sub: status.phase }, { label: "Committed", value: counts.committed.toString(), sub: `${counts.all} total` }, { label: "Success Rate", value: `${successRate}%`, sub: `${counts.rejected} rejected` }, { label: "Cost", value: `$${status.totalCost.toFixed(3)}`, sub: "$10 cap" }].map(s => (
          <div key={s.label} style={{ padding: "12px 16px", borderRight: "1px solid #18181b" }}>
            <div style={{ fontSize: 10, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fafafa", letterSpacing: "-0.04em", lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 10, color: "#3f3f46", marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>
      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Proposal table */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid #18181b" }}>
          {/* Filter bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderBottom: "1px solid #18181b", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 4 }}>
              {(["all", "pending", "committed", "rejected"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", background: filter === f ? "rgba(124,58,237,0.2)" : "transparent", border: `1px solid ${filter === f ? "rgba(124,58,237,0.4)" : "#27272a"}`, color: filter === f ? "#c4b5fd" : "#71717a", transition: "all 0.1s" }}>
                  {f.charAt(0).toUpperCase() + f.slice(1)} <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>{counts[f]}</span>
                </button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ position: "relative" }}>
              <Search style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 11, height: 11, color: "#52525b" }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search files..." style={{ background: "#0d0d10", border: "1px solid #27272a", borderRadius: 6, padding: "4px 8px 4px 24px", color: "#e4e4e7", fontSize: 11, outline: "none", width: 160 }} />
            </div>
            <button onClick={loadProposals} title="Refresh" style={{ background: "none", border: "none", color: "#52525b", cursor: "pointer", padding: 4 }}><RefreshCw style={{ width: 12, height: 12 }} /></button>
          </div>
          {/* Column headers */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 110px 70px 72px", gap: 8, padding: "6px 16px", borderBottom: "1px solid #18181b", flexShrink: 0 }}>
            {["File", "Description", "Status", "Time", "RLHF"].map(h => <div key={h} style={{ fontSize: 10, color: "#52525b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</div>)}
          </div>
          {/* Rows */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#3f3f46", gap: 8 }}>
                <FileCode2 style={{ width: 32, height: 32 }} />
                <span style={{ fontSize: 13 }}>No proposals yet</span>
                <span style={{ fontSize: 11 }}>Trigger a cycle to generate improvements</span>
              </div>
            ) : filtered.map(p => <ProposalRow key={p.id} proposal={p} onRlhf={handleRlhf} />)}
          </div>
        </div>
        {/* Activity feed */}
        <div style={{ width: 260, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #18181b", flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: "#52525b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Live Activity</span>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
            {events.length === 0 ? (
              <div style={{ padding: "16px 12px", color: "#3f3f46", fontSize: 11, textAlign: "center" }}>Waiting for events...</div>
            ) : events.map(ev => (
              <div key={ev.id} style={{ padding: "6px 12px", borderBottom: "1px solid #111113" }}>
                <div style={{ fontSize: 11, color: "#a1a1aa", lineHeight: 1.4 }}>{ev.message}</div>
                <div style={{ fontSize: 10, color: "#3f3f46", marginTop: 2 }}>{timeAgo(new Date(ev.timestamp).toISOString())}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {showGitHub && <GitHubFixerModal onClose={() => setShowGitHub(false)} />}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}
