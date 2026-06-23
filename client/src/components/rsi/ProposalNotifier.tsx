/**
 * ProposalNotifier.tsx — Real-time RSI Event Notifications
 * Andromeda v9.14.0
 *
 * Connects to the /api/rsi/events SSE stream and fires Sonner toast
 * notifications instantly when RSI events occur — replaces 15s polling.
 *
 * Events handled:
 *   proposal:applied  → green success toast
 *   proposal:rejected → amber warning toast
 *   cycle:complete    → info toast with cycle summary
 *
 * Falls back to polling if SSE is unavailable (e.g., behind a proxy
 * that doesn't support streaming).
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";

interface RsiEventData {
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

/** How often to poll as a fallback if SSE fails (ms). */
const FALLBACK_POLL_MS = 15_000;

/** Reconnect delay after SSE error (ms). */
const SSE_RECONNECT_MS = 5_000;

export function ProposalNotifier() {
  const esRef = useRef<EventSource | null>(null);
  const lastTimestampRef = useRef<number>(Date.now());
  const fallbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notifiedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let destroyed = false;

    // ── SSE connection ──────────────────────────────────────────────────────
    const connectSse = () => {
      if (destroyed) return;

      const since = lastTimestampRef.current;
      const es = new EventSource(`/api/rsi/events?since=${since}`);
      esRef.current = es;

      es.addEventListener("proposal:applied", (e: MessageEvent) => {
        const event: RsiEventData = JSON.parse(e.data);
        lastTimestampRef.current = event.timestamp;
        const { title, targetFile, confidence } = event.data as {
          title?: string;
          targetFile?: string;
          confidence?: number;
        };
        const label = title || "Improvement applied";
        const file = targetFile ? String(targetFile).split("/").pop() : "";
        const pct = confidence ? ` (${Math.round(Number(confidence) * 100)}%)` : "";
        toast.success(`RSI Applied: ${label}`, {
          description: file ? `${file}${pct}` : pct || undefined,
          duration: 6000,
          action: {
            label: "View",
            onClick: () => { window.location.hash = "#/rsi"; },
          },
        });
      });

      es.addEventListener("proposal:rejected", (e: MessageEvent) => {
        const event: RsiEventData = JSON.parse(e.data);
        lastTimestampRef.current = event.timestamp;
        const { title } = event.data as { title?: string };
        toast.warning(`RSI Rejected: ${title || "Proposal"}`, {
          duration: 4000,
          action: {
            label: "View",
            onClick: () => { window.location.hash = "#/rsi"; },
          },
        });
      });

      es.addEventListener("cycle:complete", (e: MessageEvent) => {
        const event: RsiEventData = JSON.parse(e.data);
        lastTimestampRef.current = event.timestamp;
        const { cycleNumber, proposalsApplied, proposalsRolledBack } = event.data as {
          cycleNumber?: number;
          proposalsApplied?: number;
          proposalsRolledBack?: number;
        };
        if ((proposalsApplied ?? 0) > 0 || (proposalsRolledBack ?? 0) > 0) {
          toast.info(`RSI Cycle #${cycleNumber ?? "?"} Complete`, {
            description: `${proposalsApplied ?? 0} applied, ${proposalsRolledBack ?? 0} rolled back`,
            duration: 5000,
            action: {
              label: "Dashboard",
              onClick: () => { window.location.hash = "#/rsi"; },
            },
          });
        }
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (!destroyed) {
          // Reconnect after delay, falling back to polling in the meantime
          startFallbackPolling();
          setTimeout(() => {
            stopFallbackPolling();
            connectSse();
          }, SSE_RECONNECT_MS);
        }
      };
    };

    // ── Fallback polling (used when SSE is reconnecting) ───────────────────
    const startFallbackPolling = () => {
      if (fallbackTimerRef.current) return;
      fallbackTimerRef.current = setInterval(async () => {
        try {
          const res = await fetch("/api/self/proposals?status=pending");
          if (!res.ok) return;
          const data = await res.json() as { proposals?: Array<{ id: string; title: string; targetFile: string; confidence: number }> };
          const pending = data.proposals ?? [];
          const newOnes = pending.filter(p => !notifiedIdsRef.current.has(p.id));
          newOnes.forEach(p => notifiedIdsRef.current.add(p.id));
          if (newOnes.length > 0) {
            toast(`RSI: ${newOnes.length} New Proposal${newOnes.length > 1 ? "s" : ""} Ready`, {
              description: newOnes.slice(0, 2).map(p => `• ${p.title}`).join("\n"),
              duration: 8000,
              action: { label: "Review", onClick: () => { window.location.hash = "#/rsi"; } },
            });
          }
        } catch { /* silent */ }
      }, FALLBACK_POLL_MS);
    };

    const stopFallbackPolling = () => {
      if (fallbackTimerRef.current) {
        clearInterval(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };

    connectSse();

    return () => {
      destroyed = true;
      esRef.current?.close();
      esRef.current = null;
      stopFallbackPolling();
    };
  }, []);

  // This component renders nothing — it's purely a side-effect hook.
  return null;
}
