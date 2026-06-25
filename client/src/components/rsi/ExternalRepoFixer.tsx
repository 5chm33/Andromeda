/**
 * ExternalRepoFixer.tsx — v11.293.0
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
  adminKey: string;
}

export function ExternalRepoFixer({ adminKey }: ExternalRepoFixerProps) {
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
    const url = `/api/rsi/fix-external-repo/${id}/stream`;
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
  }, []);

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

      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-slate-100 flex items-center gap-2">
            <span className="text-xl">🤖</span>
            Fix Any GitHub Repo
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Andromeda will autonomously clone the repository, apply code improvements,
            commit the changes to a new branch, and open a Pull Request — all without
            any human intervention.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Repo URL */}
          <div className="space-y-1.5">
            <Label htmlFor="repo-url" className="text-slate-300 text-xs font-medium">
              GitHub Repository URL
            </Label>
            <Input
              id="repo-url"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              disabled={isRunning}
              className="bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:ring-violet-500/20 font-mono text-sm"
            />
          </div>

          {/* GitHub PAT */}
          <div className="space-y-1.5">
            <Label htmlFor="github-pat" className="text-slate-300 text-xs font-medium">
              GitHub Token{" "}
              <span className="text-slate-500 font-normal">(optional — uses server default if blank)</span>
            </Label>
            <Input
              id="github-pat"
              type="password"
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              value={githubPat}
              onChange={(e) => setGithubPat(e.target.value)}
              disabled={isRunning}
              className="bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:ring-violet-500/20 font-mono text-sm"
            />
          </div>

          {/* Improvement cycles */}
          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs font-medium">
              Improvement Cycles: <span className="text-violet-300 font-semibold">{cycles}</span>
            </Label>
            <div className="flex gap-2">
              {[1, 2, 3, 5, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => setCycles(n)}
                  disabled={isRunning}
                  className={`px-3 py-1 rounded text-xs font-medium transition-all duration-150 ${
                    cycles === n
                      ? "bg-violet-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Progress section — shown when job is running or done */}
          {status !== "idle" && (
            <div className="space-y-2 rounded-lg bg-slate-800/50 border border-slate-700/50 p-3">
              {/* Status badge + progress */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${STATUS_COLORS[status]} ${
                      isRunning ? "animate-pulse" : ""
                    }`}
                  />
                  <span className="text-xs font-medium text-slate-300">
                    {STATUS_LABELS[status]}
                  </span>
                </div>
                <span className="text-xs text-slate-500 font-mono">{progress}%</span>
              </div>
              <Progress
                value={progress}
                className="h-1.5 bg-slate-700"
              />

              {/* Event log */}
              <div
                ref={logRef}
                className="max-h-32 overflow-y-auto space-y-0.5 mt-1"
              >
                {messages.map((msg, i) => (
                  <p key={i} className="text-[10px] text-slate-400 font-mono leading-relaxed">
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
                  className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors mt-1"
                >
                  <span>🎉</span>
                  <span className="underline underline-offset-2">View Pull Request</span>
                  <span className="text-slate-500">↗</span>
                </a>
              )}

              {/* Error */}
              {error && (
                <p className="text-[10px] text-red-400 font-mono mt-1 break-all">
                  ✗ {error}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {(isDone || isFailed) && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              className="border-slate-600 text-slate-300 hover:bg-slate-800"
            >
              Fix Another Repo
            </Button>
          )}
          {!isDone && !isFailed && (
            <Button
              onClick={handleSubmit}
              disabled={isRunning || isSubmitting || !repoUrl.trim()}
              size="sm"
              className="bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 gap-2"
            >
              {isRunning ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <span>🚀</span>
                  Fix Autonomously
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
