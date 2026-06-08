/**
 * ProposalNotifier
 *
 * A headless component that polls the RSI proposals API every 15 seconds and
 * fires a Sonner toast notification whenever new pending proposals arrive.
 * The toast includes a direct link to the RSI Dashboard for one-click review.
 *
 * Mount this once at the app root (e.g., in App.tsx) so notifications appear
 * regardless of which page the user is currently viewing.
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";

interface Proposal {
  id: string;
  title: string;
  targetFile: string;
  status: "pending" | "applied" | "rejected" | "rolled_back";
  confidence: number;
  createdAt?: string;
}

/** How often to poll for new proposals (ms). */
const POLL_INTERVAL_MS = 15_000;

/** How long to show the toast notification (ms). */
const TOAST_DURATION_MS = 8_000;

export function ProposalNotifier() {
  /** Set of proposal IDs we've already notified about. */
  const notifiedIds = useRef<Set<string>>(new Set());
  /** Whether this is the very first poll (skip notification on initial load). */
  const isFirstPoll = useRef(true);

  useEffect(() => {
    async function checkProposals() {
      try {
        const res = await fetch("/api/self/proposals?status=pending");
        if (!res.ok) return;

        const data = await res.json() as { proposals?: Proposal[] };
        const pending = (data.proposals ?? []).filter(p => p.status === "pending");

        if (isFirstPoll.current) {
          // On first load, just record existing IDs without notifying.
          pending.forEach(p => notifiedIds.current.add(p.id));
          isFirstPoll.current = false;
          return;
        }

        // Find proposals we haven't notified about yet.
        const newProposals = pending.filter(p => !notifiedIds.current.has(p.id));

        if (newProposals.length === 0) return;

        // Mark all as notified.
        newProposals.forEach(p => notifiedIds.current.add(p.id));

        if (newProposals.length === 1) {
          const p = newProposals[0];
          const fileName = p.targetFile.split("/").pop() ?? p.targetFile;
          const confidencePct = Math.round((p.confidence ?? 0) * 100);

          toast("RSI: New Proposal Ready", {
            description: `${p.title} — ${fileName} (${confidencePct}% confidence)`,
            duration: TOAST_DURATION_MS,
            action: {
              label: "Review",
              onClick: () => {
                window.location.hash = "#/rsi";
              },
            },
          });
        } else {
          toast(`RSI: ${newProposals.length} New Proposals Ready`, {
            description: newProposals
              .slice(0, 3)
              .map(p => `• ${p.title}`)
              .join("\n") + (newProposals.length > 3 ? `\n• ...and ${newProposals.length - 3} more` : ""),
            duration: TOAST_DURATION_MS,
            action: {
              label: "Review All",
              onClick: () => {
                window.location.hash = "#/rsi";
              },
            },
          });
        }
      } catch {
        // Network errors are expected during server restarts — silently ignore.
      }
    }

    // Poll immediately, then on interval.
    checkProposals();
    const interval = setInterval(checkProposals, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // This component renders nothing — it's purely a side-effect hook.
  return null;
}
