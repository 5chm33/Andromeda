import React from "react";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ExternalLink,
} from "lucide-react";
import type { SearchSource } from "../../../../drizzle/schema";

function CredibilityBadge({ level }: { level?: "high" | "medium" | "low" }) {
  if (level === "high")
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-400">
        <ShieldCheck className="w-3 h-3" /> High
      </span>
    );
  if (level === "low")
    return (
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

export function SourceCard({ source, index }: { source: SearchSource; index: number }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col gap-1.5 p-3 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/80 transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {source.favicon && (
            <img
              src={source.favicon}
              alt=""
              className="w-3.5 h-3.5 rounded flex-shrink-0 opacity-70"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          )}
          <span className="text-xs text-zinc-500 truncate">{source.domain}</span>
          {source.source === "Brave" && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-orange-500/10 text-orange-400 flex-shrink-0">Brave</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-xs text-zinc-600 font-mono">[{index + 1}]</span>
          <ExternalLink className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
        </div>
      </div>
      <p className="text-xs font-medium text-zinc-300 line-clamp-2 leading-snug group-hover:text-white transition-colors">
        {source.title}
      </p>
      <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">{source.snippet}</p>
      <CredibilityBadge level={source.credibility} />
    </a>
  );
}

export { CredibilityBadge };
