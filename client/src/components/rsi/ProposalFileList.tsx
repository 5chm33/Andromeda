/**
 * ProposalFileList.tsx — v12.4.0
 *
 * Clean vertical table of every file the RSI engine has touched.
 * No horizontal scrolling. No flow graphs. Just a scannable list.
 *
 * Layout:
 *   ┌─ Filter bar (All / Pending / Committed / Rejected) ─────────────────┐
 *   │  [search box]                              [refresh]                 │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │  FILE           DESCRIPTION          STATUS    TIME    RLHF          │
 *   │  ─────────────────────────────────────────────────────────────────── │
 *   │  ▶ server/foo.ts  Add null guard…    ✓ Committed  2m ago  👍 👎      │
 *   │  ▶ client/bar.tsx Fix type error…   ⏳ Pending   5m ago  —          │
 *   │  ▼ server/baz.ts  Refactor loop…    ✓ Committed  8m ago  👍 👎      │
 *   │    ┌─ diff ──────────────────────────────────────────────────────┐   │
 *   │    │  - old line                                                  │   │
 *   │    │  + new line                                                  │   │
 *   │    └─────────────────────────────────────────────────────────────┘   │
 *   └──────────────────────────────────────────────────────────────────────┘
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileCode2, ChevronDown, ChevronRight, ThumbsUp, ThumbsDown,
  CheckCircle2, XCircle, Clock, Loader2, RotateCcw, GitCommit,
  RefreshCw, Search, AlertCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProposalStatus = "pending" | "processing" | "applied" | "rejected" | "rolled_back";

interface Proposal {
  id: string;
  targetFile: string;
  title: string;
  rationale?: string;
  category?: string;
  diff?: string;
  originalSnippet?: string;
  proposedSnippet?: string;
  createdAt: number;
  status: ProposalStatus;
  commitHash?: string;
}

type FilterTab = "all" | "pending" | "applied" | "rejected";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeStatus(raw: string): ProposalStatus {
  if (raw === "applied" || raw === "adopted" || raw === "committed") return "applied";
  if (raw === "rejected" || raw === "failed") return "rejected";
  if (raw === "processing" || raw === "running") return "processing";
  if (raw === "rolled_back") return "rolled_back";
  return "pending";
}

function statusConfig(status: ProposalStatus) {
  switch (status) {
    case "applied":
      return { label: "Committed", color: "#34d399", bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.25)", Icon: CheckCircle2, spin: false };
    case "processing":
      return { label: "Running", color: "#a78bfa", bg: "rgba(124,58,237,0.12)", border: "rgba(124,58,237,0.25)", Icon: Loader2, spin: true };
    case "rejected":
      return { label: "Rejected", color: "#fb7185", bg: "rgba(244,63,94,0.12)", border: "rgba(244,63,94,0.25)", Icon: XCircle, spin: false };
    case "rolled_back":
      return { label: "Rolled Back", color: "#fbbf24", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.25)", Icon: RotateCcw, spin: false };
    default:
      return { label: "Pending", color: "#71717a", bg: "rgba(113,113,122,0.08)", border: "rgba(113,113,122,0.2)", Icon: Clock, spin: false };
  }
}

function shortFile(path: string): string {
  // Show last two path segments for context: "server/foo.ts"
  const parts = path.replace(/\\/g, "/").split("/");
  if (parts.length >= 2) return parts.slice(-2).join("/");
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
      <div className="font-mono text-[10px] leading-relaxed overflow-x-auto max-h-64">
        {lines.map((line, i) => {
          const isAdd = line.startsWith("+") && !line.startsWith("+++");
          const isDel = line.startsWith("-") && !line.startsWith("---");
          const isHunk = line.startsWith("@@");
          return (
            <div
              key={i}
              className="px-3 py-[1px] whitespace-pre"
              style={{
                background: isAdd ? "rgba(16,185,129,0.08)" : isDel ? "rgba(244,63,94,0.08)" : isHunk ? "rgba(99,102,241,0.08)" : "transparent",
                color: isAdd ? "#34d399" : isDel ? "#fb7185" : isHunk ? "#818cf8" : "#71717a",
              }}
            >
              {line || " "}
            </div>
          );
        })}
      </div>
    );
  }

  if (original && proposed) {
    return (
      <div className="grid grid-cols-2 gap-3 p-3">
        <div>
          <p className="text-[9px] font-semibold text-[#fb7185] uppercase tracking-wider mb-1.5">Before</p>
          <pre className="text-[10px] text-[#a1a1aa] bg-[rgba(244,63,94,0.05)] border border-[rgba(244,63,94,0.1)] rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-40">{original}</pre>
        </div>
        <div>
          <p className="text-[9px] font-semibold text-[#34d399] uppercase tracking-wider mb-1.5">After</p>
          <pre className="text-[10px] text-[#a1a1aa] bg-[rgba(16,185,129,0.05)] border border-[rgba(16,185,129,0.1)] rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-40">{proposed}</pre>
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

  const submit = async (e: React.MouseEvent, type: "accept" | "reject") => {
    e.stopPropagation();
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

  if (proposal.status !== "applied") {
    return <div className="w-14 flex-shrink-0" />;
  }

  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <button
        onClick={(e) => submit(e, "accept")}
        disabled={!!rated || submitting}
        title="Good improvement"
        className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110 disabled:opacity-40"
        style={{
          background: rated === "up" ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.04)",
          border: `1px solid ${rated === "up" ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.06)"}`,
          color: rated === "up" ? "#34d399" : "#52525b",
        }}
      >
        <ThumbsUp className="w-3 h-3" />
      </button>
      <button
        onClick={(e) => submit(e, "reject")}
        disabled={!!rated || submitting}
        title="Poor improvement"
        className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110 disabled:opacity-40"
        style={{
          background: rated === "down" ? "rgba(244,63,94,0.2)" : "rgba(255,255,255,0.04)",
          border: `1px solid ${rated === "down" ? "rgba(244,63,94,0.4)" : "rgba(255,255,255,0.06)"}`,
          color: rated === "down" ? "#fb7185" : "#52525b",
        }}
      >
        <ThumbsDown className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── Proposal Row ─────────────────────────────────────────────────────────────

function ProposalRow({ proposal, adminKey, index }: { proposal: Proposal; adminKey: string; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = statusConfig(proposal.status);
  const { Icon } = cfg;
  const hasDiff = !!(proposal.diff || (proposal.originalSnippet && proposal.proposedSnippet));

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18, delay: Math.min(index * 0.015, 0.3) }}
      className="border-b border-[#18181b] last:border-0"
    >
      {/* ── Main row ── */}
      <div
        className={`flex items-center gap-3 px-4 py-3 transition-colors ${hasDiff ? "cursor-pointer hover:bg-[#111115]" : "cursor-default"} group`}
        onClick={() => hasDiff && setExpanded(e => !e)}
      >
        {/* Expand chevron */}
        <div className="flex-shrink-0 w-4 text-[#3f3f46]">
          {hasDiff
            ? (expanded
                ? <ChevronDown className="w-3.5 h-3.5 text-[#71717a]" />
                : <ChevronRight className="w-3.5 h-3.5 group-hover:text-[#a1a1aa] transition-colors" />)
            : <div className="w-3.5" />}
        </div>

        {/* File icon */}
        <div
          className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
          style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
        >
          <FileCode2 className="w-3.5 h-3.5" style={{ color: cfg.color }} />
        </div>

        {/* File name */}
        <div className="w-44 flex-shrink-0 min-w-0">
          <span
            className="text-xs font-mono font-semibold text-[#e4e4e7] truncate block"
            title={proposal.targetFile}
          >
            {shortFile(proposal.targetFile)}
          </span>
          {proposal.category && (
            <span
              className="text-[9px] px-1.5 py-0.5 rounded font-medium mt-0.5 inline-block"
              style={{ background: "rgba(99,102,241,0.1)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.15)" }}
            >
              {proposal.category}
            </span>
          )}
        </div>

        {/* Description — takes up remaining space */}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[#a1a1aa] truncate leading-snug" title={proposal.title}>
            {proposal.title}
          </p>
          {proposal.rationale && !expanded && (
            <p className="text-[10px] text-[#52525b] truncate mt-0.5" title={proposal.rationale}>
              {proposal.rationale}
            </p>
          )}
        </div>

        {/* Status badge */}
        <div
          className="flex items-center gap-1.5 flex-shrink-0 px-2.5 py-1 rounded-md"
          style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
        >
          <Icon
            className={`w-3 h-3 ${cfg.spin ? "animate-spin" : ""}`}
            style={{ color: cfg.color }}
          />
          <span className="text-[10px] font-semibold" style={{ color: cfg.color }}>
            {cfg.label}
          </span>
        </div>

        {/* Timestamp */}
        <span className="text-[10px] text-[#3f3f46] font-mono flex-shrink-0 w-16 text-right">
          {timeAgo(proposal.createdAt)}
        </span>

        {/* RLHF thumbs */}
        <RlhfThumbs proposal={proposal} adminKey={adminKey} />
      </div>

      {/* ── Expanded diff ── */}
      <AnimatePresence>
        {expanded && hasDiff && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              className="mx-4 mb-3 rounded-lg overflow-hidden border border-[#27272a]"
              style={{ background: "#0a0a0c" }}
            >
              {proposal.rationale && (
                <div className="px-4 py-2.5 border-b border-[#1f1f23]">
                  <p className="text-[9px] font-semibold text-[#52525b] uppercase tracking-wider mb-1">Rationale</p>
                  <p className="text-[11px] text-[#a1a1aa] leading-relaxed">{proposal.rationale}</p>
                </div>
              )}
              <DiffViewer diff={proposal.diff} original={proposal.originalSnippet} proposed={proposal.proposedSnippet} />
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
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
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
      setError(null);
      const r = await fetch("/api/self/proposals?limit=200");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const raw: Record<string, unknown>[] = d.proposals ?? (Array.isArray(d) ? d : []);
      const list: Proposal[] = raw.map(p => ({
        id: String(p.id ?? p.proposalId ?? Math.random()),
        targetFile: String(p.targetFile ?? p.file ?? "unknown"),
        title: String(p.title ?? p.description ?? "Improvement"),
        rationale: p.rationale as string | undefined,
        category: p.category as string | undefined,
        diff: p.diff as string | undefined,
        originalSnippet: p.originalSnippet as string | undefined,
        proposedSnippet: p.proposedSnippet as string | undefined,
        createdAt: typeof p.createdAt === "number" ? p.createdAt : Date.now(),
        status: normalizeStatus(String(p.status ?? "pending")),
        commitHash: p.commitHash as string | undefined,
      }));
      if (list.length > 0) setProposals(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + polling
  useEffect(() => {
    loadProposals();
    const poll = setInterval(loadProposals, 15_000);
    return () => clearInterval(poll);
  }, [loadProposals]);

  // SSE live updates
  useEffect(() => {
    const es = new EventSource("/api/rsi/events");
    esRef.current = es;
    const refresh = () => { setTimeout(loadProposals, 800); };
    ["proposal:applied", "proposal:rejected", "proposal:new", "cycle:complete"].forEach(t => {
      es.addEventListener(t, refresh);
    });
    return () => { es.close(); esRef.current = null; };
  }, [loadProposals]);

  // Filter + search
  const filtered = proposals.filter(p => {
    const matchFilter =
      filter === "all" ||
      (filter === "pending" && (p.status === "pending" || p.status === "processing")) ||
      (filter === "applied" && p.status === "applied") ||
      (filter === "rejected" && (p.status === "rejected" || p.status === "rolled_back"));
    const q = search.toLowerCase();
    const matchSearch = !q || p.targetFile.toLowerCase().includes(q) || p.title.toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });

  const counts = {
    all: proposals.length,
    pending: proposals.filter(p => p.status === "pending" || p.status === "processing").length,
    applied: proposals.filter(p => p.status === "applied").length,
    rejected: proposals.filter(p => p.status === "rejected" || p.status === "rolled_back").length,
  };

  const TABS: { id: FilterTab; label: string; color?: string }[] = [
    { id: "all",      label: "All" },
    { id: "pending",  label: "Pending",   color: "#a78bfa" },
    { id: "applied",  label: "Committed", color: "#34d399" },
    { id: "rejected", label: "Rejected",  color: "#fb7185" },
  ];

  return (
    <div className="flex flex-col h-full" style={{ background: "#0d0d10" }}>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1f1f23] flex-shrink-0" style={{ background: "#0a0a0c" }}>
        {/* Filter tabs */}
        <div className="flex items-center gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
              style={{
                background: filter === tab.id ? "rgba(255,255,255,0.08)" : "transparent",
                color: filter === tab.id ? (tab.color ?? "#fafafa") : "#52525b",
                border: filter === tab.id ? "1px solid rgba(255,255,255,0.1)" : "1px solid transparent",
              }}
            >
              {tab.label}
              <span
                className="text-[10px] font-mono px-1 rounded"
                style={{
                  background: filter === tab.id ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
                  color: filter === tab.id ? (tab.color ?? "#a1a1aa") : "#3f3f46",
                }}
              >
                {counts[tab.id]}
              </span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex-1 relative max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#3f3f46]" />
          <input
            type="text"
            placeholder="Search files or descriptions…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-7 pr-3 py-1.5 rounded-md text-xs bg-[#18181b] border border-[#27272a] text-[#e4e4e7] placeholder-[#3f3f46] focus:outline-none focus:border-[#3f3f46] transition-colors"
          />
        </div>

        {/* Refresh */}
        <button
          onClick={loadProposals}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-[#52525b] hover:text-[#a1a1aa] hover:bg-[#18181b] transition-all border border-transparent hover:border-[#27272a]"
        >
          <RefreshCw className="w-3 h-3" />
          <span>Refresh</span>
        </button>
      </div>

      {/* ── Column headers ── */}
      <div
        className="flex items-center gap-3 px-4 py-2 border-b border-[#1f1f23] flex-shrink-0"
        style={{ background: "#0a0a0c" }}
      >
        <div className="w-4 flex-shrink-0" />
        <div className="w-7 flex-shrink-0" />
        <div className="w-44 flex-shrink-0 text-[9px] font-semibold uppercase tracking-wider text-[#3f3f46]">File</div>
        <div className="flex-1 text-[9px] font-semibold uppercase tracking-wider text-[#3f3f46]">Description</div>
        <div className="w-24 flex-shrink-0 text-[9px] font-semibold uppercase tracking-wider text-[#3f3f46]">Status</div>
        <div className="w-16 flex-shrink-0 text-[9px] font-semibold uppercase tracking-wider text-[#3f3f46] text-right">Time</div>
        <div className="w-14 flex-shrink-0 text-[9px] font-semibold uppercase tracking-wider text-[#3f3f46] text-center">RLHF</div>
      </div>

      {/* ── List ── */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 space-y-2">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-11 rounded-lg bg-[#18181b] animate-pulse" style={{ opacity: 1 - i * 0.1 }} />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-[#52525b]">
            <AlertCircle className="w-8 h-8 mb-3 text-[#fb7185] opacity-60" />
            <p className="text-sm text-[#fb7185]">Failed to load proposals</p>
            <p className="text-xs mt-1 text-[#52525b]">{error}</p>
            <button onClick={loadProposals} className="mt-4 px-4 py-2 rounded-lg bg-[#18181b] border border-[#27272a] text-xs text-[#a1a1aa] hover:text-[#fafafa] transition-colors">
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[#52525b]">
            <FileCode2 className="w-8 h-8 mb-3 opacity-30" />
            <p className="text-sm">
              {search ? `No results for "${search}"` : proposals.length === 0 ? "No proposals yet" : "No proposals match this filter"}
            </p>
            <p className="text-xs mt-1 text-[#3f3f46]">
              {proposals.length === 0 ? "RSI will populate this list as it runs cycles" : "Try a different filter or search term"}
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {filtered.map((proposal, i) => (
              <ProposalRow key={proposal.id} proposal={proposal} adminKey={adminKey} index={i} />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* ── Footer ── */}
      {!loading && proposals.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-[#1f1f23] flex-shrink-0" style={{ background: "#0a0a0c" }}>
          <span className="text-[10px] text-[#3f3f46] font-mono">
            {filtered.length} of {proposals.length} proposals
          </span>
          <span className="text-[10px] text-[#3f3f46] font-mono">
            {counts.applied} committed · {counts.pending} pending · {counts.rejected} rejected
          </span>
        </div>
      )}
    </div>
  );
}
