/**
 * SourceCard.tsx — v7.2.0
 *
 * Phase 2 upgrade: Perplexity-style horizontal pill source cards.
 * - Larger favicon (16px) with fallback letter avatar
 * - Domain pill with credibility color coding
 * - Compact horizontal layout (title + domain in one row)
 * - Hover: border glow + subtle lift
 * - Citation number badge
 */

import React, { useState } from "react";
import { ExternalLink, ShieldCheck, ShieldAlert, Shield } from "lucide-react";
import type { SearchSource } from "../../../../drizzle/schema";

function CredibilityDot({ level }: { level?: "high" | "medium" | "low" }) {
  if (level === "high") return <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" title="High credibility" />;
  if (level === "low") return <div className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" title="Low credibility" />;
  return null;
}

function FaviconAvatar({ src, domain }: { src?: string | null; domain?: string | null }) {
  const [failed, setFailed] = useState(false);
  const letter = (domain ?? "?")[0]?.toUpperCase() ?? "?";

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        className="w-4 h-4 rounded-sm flex-shrink-0 object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="w-4 h-4 rounded-sm flex-shrink-0 bg-zinc-700 flex items-center justify-center text-[9px] font-bold text-zinc-400">
      {letter}
    </div>
  );
}

export function SourceCard({ source, index }: { source: SearchSource; index: number }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-all cursor-pointer"
      style={{
        background: "oklch(0.13 0.012 265 / 0.8)",
        borderColor: "oklch(0.22 0.015 265 / 0.6)",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.62 0.22 265 / 0.35)";
        (e.currentTarget as HTMLElement).style.boxShadow = "0 0 12px oklch(0.62 0.22 265 / 0.08)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = "oklch(0.22 0.015 265 / 0.6)";
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
      }}
    >
      {/* Citation number */}
      <span className="flex-shrink-0 w-5 h-5 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] font-mono font-semibold text-zinc-500 mt-0.5">
        {index + 1}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1">
        {/* Title row */}
        <p className="text-xs font-medium text-zinc-300 line-clamp-2 leading-snug group-hover:text-white transition-colors">
          {source.title}
        </p>

        {/* Domain + credibility row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <FaviconAvatar src={source.favicon} domain={source.domain} />
          <span className="text-[11px] text-zinc-500 truncate max-w-[140px]">{source.domain}</span>
          <CredibilityDot level={source.credibility} />
          {source.source === "Brave" && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20 flex-shrink-0">Brave</span>
          )}
        </div>

        {/* Snippet */}
        {source.snippet && (
          <p className="text-[11px] text-zinc-600 line-clamp-2 leading-relaxed">{source.snippet}</p>
        )}
      </div>

      {/* External link icon */}
      <ExternalLink className="w-3.5 h-3.5 text-zinc-700 group-hover:text-zinc-400 transition-colors flex-shrink-0 mt-0.5" />
    </a>
  );
}

export function CredibilityBadge({ level }: { level?: "high" | "medium" | "low" }) {
  if (level === "high") return (
    <span className="flex items-center gap-1 text-xs text-emerald-400">
      <ShieldCheck className="w-3 h-3" /> High
    </span>
  );
  if (level === "low") return (
    <span className="flex items-center gap-1 text-xs text-amber-400">
      <ShieldAlert className="w-3 h-3" /> Low
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-xs text-zinc-500">
      <Shield className="w-3 h-3" /> Medium
    </span>
  );
}
