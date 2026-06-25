/**
 * ProposalFileList.tsx — v12.3.0
 *
 * Replaces the abstract flow-graph with a tangible, scannable file list.
 *
 * Features:
 *   - Each row = one file being improved (targetFile, title, status, diff)
 *   - Status badge: pending | running | passed | committed | rejected | rolled back
 *   - Click any row to expand the diff inline
 *   - Thumbs up / thumbs down RLHF rating on each row
 *   - Persists across page refreshes (loads from /api/self/proposals)
 *   - Live updates via SSE (proposal:new, proposal:applied, proposal:rejected)
 *   - Filter bar: All / Pending / Committed / Rejected
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileCode2, ChevronDown, ChevronRight, ThumbsUp, ThumbsDown,
  CheckCircle2, XCircle, Clock, Loader2, RotateCcw, GitCommit,
  RefreshCw, Filter,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProposalStatus = "pending" | "processing" | "applied" | "rejected" | "rolled_back";

interface Proposal {
  id: string;
  targetFile: string;
  title: string;
  rationale?: string;
  category?: string;
  impact?: string;
  confidence?: number;
  diff?: string;
  originalSnippet?: string;
  proposedSnippet?: string;
  createdAt: number;
  status: ProposalStatus;
  commitHash?: string;
}

type FilterTab = "all" | "pending" | "applied" | "rejected";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusConfig(status: ProposalStatus) {
  switch (status) {
    case "applied":
      return { label: "Committed", color: "#34d399", bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.2)", Icon: CheckCircle2 };
    case "processing":
      return { label: "Running", color: "#a78bfa", bg: "rgba(124,58,237,0.1)", border: "rgba(124,58,237,0.2)", Icon: Loader2, spin: true };
    case "rejected":
      return { label: "Rejected", color: "#fb7185", bg: "rgba(244,63,94,0.1)", border: "rgba(244,63,94,0.2)", Icon: XCircle };
    case "rolled_back":
      return { label: "Rolled Back", color: "#fbbf24", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.2)", Icon: RotateCcw };
    default:
      return { label: "Pending", color: "#71717a", bg: "rgba(113,113,122,0.08)", border: "rgba(113,113,122,0.15)", Icon: Clock };
  }
}

function shortFile(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

// ─── Diff Viewer ──────────────────────────────────────────────────────────────

function DiffViewer({ diff, original, proposed }: { diff?: string; original?: string; proposed?: string }) {
  if (diff) {
    const lines = diff.split("\n");
    return (
      <div className="font-mono text-[10px] leading-relaxed overflow-x-auto">
        {lines.map((line, i) => {
          const isAdd = line.startsWith("+") && !line.startsWith("+++");
          const isDel = line.startsWith("-") && !line.startsWith("---");
          const isHunk = line.startsWith("@@");
          return (
            <div
              key={i}
              className="px-3 py-0.5 whitespace-pre"
              style={{
                background: isAdd ? "rgba(16,185,129,0.08)" : isDel ? "rgba(244,63,94,0.08)" : isHunk ? "rgba(99,102,241,0.08)" : "transparent",
                color: isAdd ? "#34d399" : isDel ? "#fb7185" : isHunk ? "#818cf8" : "#71717a",
              }}
            >
              {line}
            </div>
          );
        })}
      </div>
    );
  }

  if (original && proposed) {
    return (
      <div className="grid grid-cols-2 gap-2 p-3">
        <div>
          <p className="text-[9px] font-semibold text-[#fb7185] uppercase tracking-wider mb-1.5 px-1">Before</p>
          <pre className="text-[10px] text-[#a1a1aa] bg-[rgba(244,63,94,0.05)] border border-[rgba(244,63,94,0.1)] rounded p-2 overflow-x-auto whitespace-pre-wrap">{original}</pre>
        </div>
        <div>
          <p className="text-[9px] font-semibold text-[#34d399] uppercase tracking-wider mb-1.5 px-1">After</p>
          <pre className="text-[10px] text-[#a1a1aa] bg-[rgba(16,185,129,0.05)] border border-[rgba(16,185,129,0.1)] rounded p-2 overflow-x-auto whitespace-pre-wrap">{proposed}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 text-[11px] text-[#52525b] italic">No diff available for this proposal.</div>
  );
}

// ─── RLHF Thumbs ─────────────────────────────────────────────────────────────

function RlhfThumbs({ proposal, adminKey }: { proposal: Proposal; adminKey: string }) {
  const [rated, setRated] = useState<"up" | "down" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (type: "accept" | "reject") => {
    if (rated || submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/v71/rlhf/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
        body: JSON.stringify({
          proposalId: proposal.id,
          targetFile: proposal.targetFile,
          category: proposal.category ?? "unknown",
          title: proposal.title,
          feedbackType: type,
          rawRating: type === "accept" ? 1.0 : 0.0,
        }),
      });
      setRated(type === "accept" ? "up" : "down");
    } catch { /* non-fatal */ }
    finally { setSubmitting(false); }
  };

  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <button
        onClick={(e) => { e.stopPropagation(); submit("accept"); }}
        disabled={!!rated || submitting}
        title="Good improvement"
        className="w-6 h-6 rounded flex items-center justify-center transition-all disabled:opacity-40"
        style={{
          background: rated === "up" ? "rgba(16,185,129,0.15)" : "transparent",
          border: rated === "up" ? "1px solid rgba(16,185,129,0.3)" : "1px solid transparent",
          color: rated === "up" ? "#34d399" : "#52525b",
        }}
      >
        <ThumbsUp className="w-3 h-3" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); submit("reject"); }}
        disabled={!!rated || submitting}
        title="Poor improvement"
        className="w-6 h-6 rounded flex items-center justify-center transition-all disabled:opacity-40"
        style={{
          background: rated === "down" ? "rgba(244,63,94,0.15)" : "transparent",
          border: rated === "down" ? "1px solid rgba(244,63,94,0.3)" : "1px solid transparent",
          color: rated === "down" ? "#fb7185" : "#52525b",
        }}
      >
        <ThumbsDown className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── Proposal Row ─────────────────────────────────────────────────────────────

function ProposalRow({ proposal, adminKey }: { proposal: Proposal; adminKey: string }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = statusConfig(proposal.status);
  const { Icon } = cfg;
  const hasDiff = !!(proposal.diff || (proposal.originalSnippet && proposal.proposedSnippet));

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="border-b border-[#1a1a1d] last:border-0"
    >
      {/* Main row */}
      <div
        className="flex items-center gap-3 px-4 py-3 hover:bg-[#111115] transition-colors cursor-pointer group"
        onClick={() => hasDiff && setExpanded(e => !e)}
      >
        {/* File icon */}
        <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
          <FileCode2 className="w-3.5 h-3.5" style={{ color: cfg.color }} />
        </div>

        {/* File name + title */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-[#e4e4e7] font-mono truncate max-w-[160px]" title={proposal.targetFile}>
              {shortFile(proposal.targetFile)}
            </span>
            {proposal.category && (
              <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: "rgba(99,102,241,0.1)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.15)" }}>
                {proposal.category}
              </span>
            )}
          </div>
          <p className="text-[11px] text-[#71717a] mt-0.5 truncate" title={proposal.title}>{proposal.title}</p>
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-1.5 flex-shrink-0 px-2 py-1 rounded-md" style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
          <Icon className={`w-3 h-3 ${(cfg as any).spin ? "animate-spin" : ""}`} style={{ color: cfg.color }} />
          <span className="text-[10px] font-medium" style={{ color: cfg.color }}>{cfg.label}</span>
        </div>

        {/* Time */}
        <span className="text-[10px] text-[#3f3f46] font-mono flex-shrink-0 hidden sm:block">{timeAgo(proposal.createdAt)}</span>

        {/* RLHF thumbs — only show for applied proposals */}
        {proposal.status === "applied" && (
          <RlhfThumbs proposal={proposal} adminKey={adminKey} />
        )}

        {/* Expand chevron */}
        {hasDiff && (
          <ChevronDown
            className={`w-3.5 h-3.5 text-[#3f3f46] flex-shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        )}
        {!hasDiff && <div className="w-3.5 flex-shrink-0" />}
      </div>

      {/* Expanded diff */}
      <AnimatePresence>
        {expanded && hasDiff && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mx-4 mb-3 rounded-lg overflow-hidden border border-[#1f1f23]" style={{ background: "#0a0a0c" }}>
              {/* Rationale */}
              {proposal.rationale && (
                <div className="px-4 py-2.5 border-b border-[#1f1f23]">
                  <p className="text-[10px] font-semibold text-[#52525b] uppercase tracking-wider mb-1">Rationale</p>
                  <p className="text-[11px] text-[#a1a1aa] leading-relaxed">{proposal.rationale}</p>
                </div>
              )}
              <DiffViewer diff={proposal.diff} original={proposal.originalSnippet} proposed={proposal.proposedSnippet} />
              {/* Commit hash if applied */}
              {proposal.commitHash && (
                <div className="px-4 py-2 border-t border-[#1f1f23] flex items-center gap-2">
                  <GitCommit className="w-3 h-3 text-[#34d399]" />
                  <span className="text-[10px] font-mono text-[#34d399]">{proposal.commitHash.slice(0, 8)}</span>
                  <span className="text-[10px] text-[#52525b]">pushed to GitHub</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ProposalFileList() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [adminKey, setAdminKey] = useState<string>(
    typeof localStorage !== "undefined" ? (localStorage.getItem("andromeda_admin_key") ?? "") : ""
  );
  const esRef = useRef<EventSource | null>(null);

  // Auto-fetch admin key
  useEffect(() => {
    if (adminKey) return;
    fetch("/api/admin/local-key")
      .then(r => r.ok ? r.json() : null)
      .then((d: { key?: string } | null) => {
        if (d?.key) {
          localStorage.setItem("andromeda_admin_key", d.key);
          setAdminKey(d.key);
        }
      })
      .catch(() => {});
  }, [adminKey]);

  const loadProposals = useCallback(async () => {
    try {
      const r = await fetch("/api/self/proposals?limit=100");
      if (!r.ok) throw new Error("unavailable");
      const d = await r.json();
      const raw: Record<string, unknown>[] = d.proposals ?? (Array.isArray(d) ? d : []);
      const list: Proposal[] = raw.map(p => ({
        id: String(p.id ?? p.proposalId ?? Math.random()),
        targetFile: String(p.targetFile ?? p.file ?? "unknown"),
        title: String(p.title ?? p.description ?? "Improvement"),
        rationale: p.rationale as string | undefined,
        category: p.category as string | undefined,
        impact: p.impact as string | undefined,
        confidence: typeof p.confidence === "number" ? p.confidence : undefined,
        diff: p.diff as string | undefined,
        originalSnippet: p.originalSnippet as string | undefined,
        proposedSnippet: p.proposedSnippet as string | undefined,
        createdAt: typeof p.createdAt === "number" ? p.createdAt : Date.now(),
        status: normalizeStatus(String(p.status ?? "pending")),
        commitHash: p.commitHash as string | undefined,
      }));
      if (list.length > 0) {
        setProposals(list);
      }
    } catch { /* keep existing proposals on error */ }
    finally { setLoading(false); }
  }, []);

  // Connect SSE for live updates
  useEffect(() => {
    loadProposals();
    const poll = setInterval(loadProposals, 15_000);

    const es = new EventSource("/api/rsi/events");
    esRef.current = es;

    const handleEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Record<string, unknown>;
        // When a proposal is applied or rejected, refresh the list
        if (data.proposalId || data.id) {
          setTimeout(loadProposals, 1500); // slight delay for DB write
        }
      } catch { /* non-fatal */ }
    };

    ["proposal:applied", "proposal:rejected", "proposal:new", "cycle:complete"].forEach(type => {
      es.addEventListener(type, handleEvent);
    });

    return () => {
      clearInterval(poll);
      es.close();
      esRef.current = null;
    };
  }, [loadProposals]);

  const filtered = proposals.filter(p => {
    if (filter === "all") return true;
    if (filter === "pending") return p.status === "pending" || p.status === "processing";
    if (filter === "applied") return p.status === "applied";
    if (filter === "rejected") return p.status === "rejected" || p.status === "rolled_back";
    return true;
  });

  const counts = {
    all: proposals.length,
    pending: proposals.filter(p => p.status === "pending" || p.status === "processing").length,
    applied: proposals.filter(p => p.status === "applied").length,
    rejected: proposals.filter(p => p.status === "rejected" || p.status === "rolled_back").length,
  };

  const tabs: { id: FilterTab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "pending", label: "Pending" },
    { id: "applied", label: "Committed" },
    { id: "rejected", label: "Rejected" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-1 px-4 py-3 border-b border-[#1f1f23] flex-shrink-0" style={{ background: "#0f0f12" }}>
        <Filter className="w-3 h-3 text-[#52525b] mr-1" />
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all"
            style={filter === tab.id
              ? { background: "rgba(124,58,237,0.15)", color: "#c4b5fd", border: "1px solid rgba(124,58,237,0.25)" }
              : { background: "transparent", color: "#71717a", border: "1px solid transparent" }}
          >
            {tab.label}
            <span className="text-[9px] px-1 rounded" style={{
              background: filter === tab.id ? "rgba(124,58,237,0.2)" : "rgba(113,113,122,0.1)",
              color: filter === tab.id ? "#a78bfa" : "#52525b",
            }}>
              {counts[tab.id]}
            </span>
          </button>
        ))}
        <button
          onClick={() => { setLoading(true); loadProposals(); }}
          className="ml-auto flex items-center gap-1 text-[10px] text-[#52525b] hover:text-[#a1a1aa] transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && proposals.length === 0 ? (
          <div className="p-4 space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-[#18181b] animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[#52525b]">
            <FileCode2 className="w-8 h-8 mb-3 opacity-20" />
            <p className="text-sm">No {filter === "all" ? "" : filter} proposals yet</p>
            <p className="text-xs mt-1 text-[#3f3f46]">RSI will populate this list as it runs</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {filtered.map(p => (
              <ProposalRow key={p.id} proposal={p} adminKey={adminKey} />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

// ─── Status normalizer ────────────────────────────────────────────────────────

function normalizeStatus(raw: string): ProposalStatus {
  switch (raw) {
    case "applied":
    case "approved":
      return "applied";
    case "rejected":
      return "rejected";
    case "processing":
      return "processing";
    case "rolled_back":
      return "rolled_back";
    default:
      return "pending";
  }
}
