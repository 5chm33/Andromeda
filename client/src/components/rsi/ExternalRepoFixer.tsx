/**
 * ExternalRepoFixer.tsx — v12.3.0
 *
 * "Fix Any GitHub Repo" — popup modal that lets the user enter a GitHub URL
 * and optionally a PAT, then kicks off an autonomous clone → RSI → PR flow.
 *
 * Fixes in v12.3.0:
 *   - Admin key is now fetched from /api/admin/local-key on dialog open
 *     with a 5-second timeout (server can be slow under RSI load)
 *   - Falls back to a visible key input field if auto-fetch fails
 *   - Errors are shown prominently (no more silent 401s)
 *   - SSE stream uses ?key= query param (EventSource can't send headers)
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

// ─── Component ────────────────────────────────────────────────────────────────

interface ExternalRepoFixerProps {
  adminKey?: string;
}

export function ExternalRepoFixer({ adminKey: adminKeyProp }: ExternalRepoFixerProps = {}) {
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
  const [resolvedKey, setResolvedKey] = useState<string>(
    adminKeyProp ?? (typeof localStorage !== "undefined" ? (localStorage.getItem("andromeda_admin_key") ?? "") : "")
  );
  const [keyFetching, setKeyFetching] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const sseRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  // When dialog opens, try to fetch the admin key
  useEffect(() => {
    if (!open) return;
    if (resolvedKey) return; // already have it

    setKeyFetching(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    fetch("/api/admin/local-key", { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then((d: { key?: string } | null) => {
        clearTimeout(timeout);
        if (d?.key) {
          localStorage.setItem("andromeda_admin_key", d.key);
          setResolvedKey(d.key);
          setShowKeyInput(false);
        } else {
          setShowKeyInput(true);
        }
      })
      .catch(() => {
        clearTimeout(timeout);
        setShowKeyInput(true);
      })
      .finally(() => setKeyFetching(false));

    return () => { clearTimeout(timeout); controller.abort(); };
  }, [open, resolvedKey]);

  // Clean up SSE on unmount
  useEffect(() => {
    return () => {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
    };
  }, []);

  const connectSse = useCallback((id: string, key: string) => {
    if (sseRef.current) sseRef.current.close();
    const keyParam = key ? `?key=${encodeURIComponent(key)}` : "";
    const es = new EventSource(`/api/rsi/fix-external-repo/${id}/stream${keyParam}`);
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
    if (!resolvedKey) {
      setError("Admin key is required. Please enter it in the field above.");
      return;
    }

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
          "X-Admin-Key": resolvedKey,
        },
        body: JSON.stringify({
          repoUrl: repoUrl.trim(),
          githubPat: githubPat.trim() || undefined,
          cycles,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        if (resp.status === 401) {
          setShowKeyInput(true);
          setResolvedKey("");
          localStorage.removeItem("andromeda_admin_key");
          throw new Error("Admin key invalid or expired. Please enter it manually.");
        }
        throw new Error(data.error ?? `Server returned ${resp.status}`);
      }
      setJobId(data.jobId);
      connectSse(data.jobId, resolvedKey);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
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
    if (!v && (status === "idle" || status === "done" || status === "failed")) {
      handleReset();
    }
  };

  const isRunning = status !== "idle" && status !== "done" && status !== "failed";
  const isDone = status === "done";
  const isFailed = status === "failed";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{ background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.25)", color: "#c4b5fd" }}
        >
          <span>🔧</span>
          Fix Any GitHub Repo
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-lg" style={{ background: "#111113", border: "1px solid #27272a", color: "#e4e4e7" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: "#fafafa", letterSpacing: "-0.025em" }}>
            <span className="text-xl">🤖</span>
            Fix Any GitHub Repo
          </DialogTitle>
          <DialogDescription style={{ color: "#71717a" }}>
            Andromeda will autonomously clone the repository, apply code improvements,
            commit the changes to a new branch, and open a Pull Request.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Admin key input — shown if auto-fetch failed */}
          {showKeyInput && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium" style={{ color: "#fb7185" }}>
                Admin Key{" "}
                <span className="font-normal" style={{ color: "#52525b" }}>(auto-fetch failed — paste from .env.local)</span>
              </Label>
              <Input
                type="password"
                placeholder="ANDROMEDA_ADMIN_KEY value"
                value={resolvedKey}
                onChange={(e) => {
                  setResolvedKey(e.target.value);
                  localStorage.setItem("andromeda_admin_key", e.target.value);
                }}
                disabled={isRunning}
                className="font-mono text-sm"
                style={{ background: "#18181b", border: "1px solid rgba(244,63,94,0.3)", color: "#e4e4e7" }}
              />
            </div>
          )}

          {keyFetching && (
            <p className="text-[11px] text-[#52525b] flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 border border-[#52525b] rounded-full animate-spin border-t-transparent" />
              Fetching admin key from server…
            </p>
          )}

          {/* Repo URL */}
          <div className="space-y-1.5">
            <Label htmlFor="repo-url" className="text-xs font-medium" style={{ color: "#a1a1aa" }}>
              GitHub Repository URL
            </Label>
            <Input
              id="repo-url"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !isRunning && repoUrl.trim() && handleSubmit()}
              disabled={isRunning}
              className="font-mono text-sm"
              style={{ background: "#18181b", border: "1px solid #27272a", color: "#e4e4e7" }}
            />
          </div>

          {/* GitHub PAT */}
          <div className="space-y-1.5">
            <Label htmlFor="github-pat" className="text-xs font-medium" style={{ color: "#a1a1aa" }}>
              GitHub Token{" "}
              <span className="font-normal" style={{ color: "#52525b" }}>(optional — uses server default if blank)</span>
            </Label>
            <Input
              id="github-pat"
              type="password"
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              value={githubPat}
              onChange={(e) => setGithubPat(e.target.value)}
              disabled={isRunning}
              className="font-mono text-sm"
              style={{ background: "#18181b", border: "1px solid #27272a", color: "#e4e4e7" }}
            />
          </div>

          {/* Improvement cycles */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium" style={{ color: "#a1a1aa" }}>
              Improvement Cycles:{" "}
              <span className="font-semibold" style={{ color: "#c4b5fd" }}>{cycles}</span>
            </Label>
            <div className="flex gap-2">
              {[1, 2, 3, 5, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => setCycles(n)}
                  disabled={isRunning}
                  className="px-3 py-1 rounded text-xs font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={cycles === n
                    ? { background: "rgba(124,58,237,0.25)", color: "#c4b5fd", border: "1px solid rgba(124,58,237,0.4)" }
                    : { background: "#18181b", color: "#71717a", border: "1px solid #27272a" }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Progress section */}
          {status !== "idle" && (
            <div className="space-y-2 rounded-xl p-3" style={{ background: "#0f0f12", border: "1px solid #1f1f23" }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative inline-flex">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ background: isDone ? "#34d399" : isFailed ? "#fb7185" : "#a78bfa" }}
                    />
                    {isRunning && (
                      <span className="absolute inset-0 rounded-full animate-ping" style={{ background: "#a78bfa", opacity: 0.4 }} />
                    )}
                  </span>
                  <span className="text-xs font-medium" style={{ color: "#e4e4e7" }}>
                    {STATUS_LABELS[status]}
                  </span>
                </div>
                <span className="text-xs font-mono" style={{ color: "#52525b" }}>{progress}%</span>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#27272a" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${progress}%`,
                    background: isDone ? "#34d399" : isFailed ? "#fb7185" : "linear-gradient(90deg, #7c3aed, #6366f1)",
                  }}
                />
              </div>

              {/* Event log */}
              <div ref={logRef} className="max-h-32 overflow-y-auto space-y-0.5 mt-1">
                {messages.map((msg, i) => (
                  <p key={i} className="text-[10px] font-mono leading-relaxed" style={{ color: "#52525b" }}>
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
                  style={{ color: "#34d399" }}
                >
                  <span>🎉</span>
                  <span className="underline underline-offset-2">View Pull Request</span>
                  <span style={{ color: "#52525b" }}>↗</span>
                </a>
              )}

              {/* Error */}
              {error && (
                <p className="text-[10px] font-mono mt-1 break-all" style={{ color: "#fb7185" }}>
                  ✗ {error}
                </p>
              )}
            </div>
          )}

          {/* Standalone error (before job starts) */}
          {error && status === "idle" && (
            <p className="text-[11px] font-mono p-2 rounded" style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.2)", color: "#fb7185" }}>
              ✗ {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          {(isDone || isFailed) && (
            <button
              onClick={handleReset}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: "#18181b", border: "1px solid #27272a", color: "#a1a1aa" }}
            >
              Fix Another Repo
            </button>
          )}
          {!isDone && !isFailed && (
            <button
              onClick={handleSubmit}
              disabled={isRunning || isSubmitting || !repoUrl.trim() || keyFetching}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg, #7c3aed, #6366f1)", color: "#fff" }}
            >
              {isRunning || isSubmitting ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} />
                  {isSubmitting ? "Starting..." : "Running..."}
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
