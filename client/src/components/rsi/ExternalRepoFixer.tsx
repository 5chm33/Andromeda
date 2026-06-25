/**
 * ExternalRepoFixer.tsx — v12.0.0
 *
 * "Fix Any GitHub Repo" — popup modal that lets the user enter a GitHub URL
 * and optionally a PAT, then kicks off an autonomous clone → RSI → PR flow.
 *
 * Features:
 *   - Clean dialog with URL input + optional PAT input
 *   - Cycle count selector (1–10)
 *   - Real-time SSE progress stream with animated progress bar
 *   - Clickable PR link on completion
 *   - Error display with retry button
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

// ─── Types ────────────────────────────────────────────────────────────────────

type FixJobStatus =
  | "idle"
  | "pending"
  | "cloning"
  | "analyzing"
  | "improving"
  | "committing"
  | "pushing"
  | "pr_opened"
  | "done"
  | "failed";

interface FixJobEvent {
  jobId: string;
  status: FixJobStatus;
  message: string;
  progress: number;
  prUrl?: string;
  error?: string;
  timestamp: number;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<FixJobStatus, string> = {
  idle: "Ready",
  pending: "Starting...",
  cloning: "Cloning repository",
  analyzing: "Analyzing code",
  improving: "Applying improvements",
  committing: "Committing changes",
  pushing: "Pushing branch",
  pr_opened: "Opening Pull Request",
  done: "Done",
  failed: "Failed",
};

const STATUS_COLORS: Record<FixJobStatus, string> = {
  idle: "bg-slate-600",
  pending: "bg-blue-600",
  cloning: "bg-blue-500",
  analyzing: "bg-violet-500",
  improving: "bg-amber-500",
  committing: "bg-emerald-600",
  pushing: "bg-emerald-500",
  pr_opened: "bg-emerald-400",
  done: "bg-emerald-400",
  failed: "bg-red-500",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface ExternalRepoFixerProps {
  adminKey?: string;
}

export function ExternalRepoFixer({ adminKey: adminKeyProp }: ExternalRepoFixerProps = {}) {
  const adminKey = adminKeyProp ?? (typeof localStorage !== "undefined" ? (localStorage.getItem("andromeda_admin_key") ?? "") : "");
  const [open, setOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [githubPat, setGithubPat] = useState("");
  const [cycles, setCycles] = useState(3);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<FixJobStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [messages, setMessages] = useState<string[]>([]);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const sseRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  // Clean up SSE on unmount or close
  useEffect(() => {
    return () => {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
    };
  }, []);

  const connectSse = useCallback((id: string) => {
    if (sseRef.current) {
      sseRef.current.close();
    }
    // v12.2.1: EventSource cannot send custom headers, so pass admin key as query param
    const keyParam = adminKey ? `?key=${encodeURIComponent(adminKey)}` : "";
    const url = `/api/rsi/fix-external-repo/${id}/stream${keyParam}`;
    const es = new EventSource(url);
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const evt: FixJobEvent = JSON.parse(e.data);
        setStatus(evt.status as FixJobStatus);
        setProgress(evt.progress);
        setMessages((prev) => [...prev, `[${new Date(evt.timestamp).toLocaleTimeString()}] ${evt.message}`]);
        if (evt.prUrl) setPrUrl(evt.prUrl);
        if (evt.error) setError(evt.error);
        if (evt.status === "done" || evt.status === "failed") {
          es.close();
          sseRef.current = null;
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      es.close();
      sseRef.current = null;
    };
  }, [adminKey]);

  const handleSubmit = async () => {
    if (!repoUrl.trim()) return;
    setIsSubmitting(true);
    setError(null);
    setPrUrl(null);
    setMessages([]);
    setProgress(0);
    setStatus("pending");

    try {
      const resp = await fetch("/api/rsi/fix-external-repo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({
          repoUrl: repoUrl.trim(),
          githubPat: githubPat.trim() || undefined,
          cycles,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error ?? "Failed to start fix job");
      }
      setJobId(data.jobId);
      connectSse(data.jobId);
    } catch (err) {
      setError(String(err));
      setStatus("failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    setJobId(null);
    setStatus("idle");
    setProgress(0);
    setMessages([]);
    setPrUrl(null);
    setError(null);
    setRepoUrl("");
    setGithubPat("");
    setCycles(3);
  };

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) {
      // Don't reset if a job is running
      if (status === "idle" || status === "done" || status === "failed") {
        handleReset();
      }
    }
  };

  const isRunning = status !== "idle" && status !== "done" && status !== "failed";
  const isDone = status === "done";
  const isFailed = status === "failed";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="border-violet-500/50 text-violet-300 hover:bg-violet-500/10 hover:text-violet-200 gap-2 transition-all duration-200"
        >
          <span className="text-base leading-none">🔧</span>
          Fix Any GitHub Repo
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg" style={{ background: '#111113', border: '1px solid #27272a', color: '#e4e4e7' }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: '#fafafa', letterSpacing: '-0.025em' }}>
            <span className="text-xl">🤖</span>
            Fix Any GitHub Repo
          </DialogTitle>
          <DialogDescription style={{ color: '#71717a' }}>
            Andromeda will autonomously clone the repository, apply code improvements,
            commit the changes to a new branch, and open a Pull Request — all without
            any human intervention.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Repo URL */}
          <div className="space-y-1.5">
            <Label htmlFor="repo-url" className="text-xs font-medium" style={{ color: '#a1a1aa' }}>
              GitHub Repository URL
            </Label>
            <Input
              id="repo-url"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              disabled={isRunning}
              className="font-mono text-sm"
              style={{ background: '#18181b', border: '1px solid #27272a', color: '#e4e4e7' }}
            />
          </div>

          {/* GitHub PAT */}
          <div className="space-y-1.5">
            <Label htmlFor="github-pat" className="text-xs font-medium" style={{ color: '#a1a1aa' }}>
              GitHub Token{" "}
              <span className="font-normal" style={{ color: '#52525b' }}>(optional — uses server default if blank)</span>
            </Label>
            <Input
              id="github-pat"
              type="password"
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              value={githubPat}
              onChange={(e) => setGithubPat(e.target.value)}
              disabled={isRunning}
              className="font-mono text-sm"
              style={{ background: '#18181b', border: '1px solid #27272a', color: '#e4e4e7' }}
            />
          </div>

          {/* Improvement cycles */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium" style={{ color: '#a1a1aa' }}>
              Improvement Cycles: <span className="font-semibold" style={{ color: '#c4b5fd' }}>{cycles}</span>
            </Label>
            <div className="flex gap-2">
              {[1, 2, 3, 5, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => setCycles(n)}
                  disabled={isRunning}
                  className="px-3 py-1 rounded text-xs font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={cycles === n
                    ? { background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.4)' }
                    : { background: '#18181b', color: '#71717a', border: '1px solid #27272a' }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Progress section — shown when job is running or done */}
          {status !== "idle" && (
            <div className="space-y-2 rounded-xl p-3" style={{ background: '#0f0f12', border: '1px solid #1f1f23' }}>
              {/* Status badge + progress */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative inline-flex">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: isDone ? '#34d399' : isFailed ? '#fb7185' : '#a78bfa' }} />
                    {isRunning && <span className="absolute inset-0 rounded-full animate-ping" style={{ background: '#a78bfa', opacity: 0.4 }} />}
                  </span>
                  <span className="text-xs font-medium" style={{ color: '#e4e4e7' }}>
                    {STATUS_LABELS[status]}
                  </span>
                </div>
                <span className="text-xs font-mono" style={{ color: '#52525b' }}>{progress}%</span>
              </div>
              {/* Custom progress bar */}
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#27272a' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${progress}%`, background: isDone ? '#34d399' : isFailed ? '#fb7185' : 'linear-gradient(90deg, #7c3aed, #6366f1)' }}
                />
              </div>

              {/* Event log */}
              <div ref={logRef} className="max-h-32 overflow-y-auto space-y-0.5 mt-1">
                {messages.map((msg, i) => (
                  <p key={i} className="text-[10px] font-mono leading-relaxed" style={{ color: '#52525b' }}>
                    {msg}
                  </p>
                ))}
              </div>

              {/* PR link */}
              {prUrl && (
                <a
                  href={prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs transition-colors mt-1"
                  style={{ color: '#34d399' }}
                >
                  <span>🎉</span>
                  <span className="underline underline-offset-2">View Pull Request</span>
                  <span style={{ color: '#52525b' }}>↗</span>
                </a>
              )}

              {/* Error */}
              {error && (
                <p className="text-[10px] font-mono mt-1 break-all" style={{ color: '#fb7185' }}>
                  ✗ {error}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {(isDone || isFailed) && (
            <button
              onClick={handleReset}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: '#18181b', border: '1px solid #27272a', color: '#a1a1aa' }}
            >
              Fix Another Repo
            </button>
          )}
          {!isDone && !isFailed && (
            <button
              onClick={handleSubmit}
              disabled={isRunning || isSubmitting || !repoUrl.trim()}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #6366f1)', color: '#fff' }}
            >
              {isRunning ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
                  Running...
                </>
              ) : (
                <>
                  <span>🚀</span>
                  Fix Autonomously
                </>
              )}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
