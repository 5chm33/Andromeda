/**
 * AmbientOrb.tsx — Agent State Orb
 * Andromeda v11.0.0 — Phase 11: UI Overhaul
 *
 * A glowing orb that pulses and changes color based on the current agent state.
 * Replaces the flat status bar with a living, breathing visual indicator.
 *
 * States:
 *   idle        → soft blue pulse (resting)
 *   thinking    → violet rapid pulse (LLM generating)
 *   tool_call   → cyan fast pulse (tool executing)
 *   shadow_test → amber medium pulse (shadow testing RSI)
 *   success     → green flash → idle
 *   error       → red flash → idle
 */
import { useEffect, useState } from "react";

export type OrbState =
  | "idle"
  | "thinking"
  | "tool_call"
  | "shadow_test"
  | "success"
  | "error";

interface AmbientOrbProps {
  state: OrbState;
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
}

const ORB_CONFIG: Record<OrbState, {
  color: string;
  glow: string;
  ring: string;
  animation: string;
  label: string;
}> = {
  idle: {
    color: "bg-blue-500/70",
    glow: "shadow-[0_0_12px_oklch(0.62_0.22_265/0.5),0_0_30px_oklch(0.62_0.22_265/0.2)]",
    ring: "ring-blue-500/20",
    animation: "animate-pulse",
    label: "Ready",
  },
  thinking: {
    color: "bg-violet-500/80",
    glow: "shadow-[0_0_16px_oklch(0.72_0.28_295/0.7),0_0_40px_oklch(0.72_0.28_295/0.3)]",
    ring: "ring-violet-500/30",
    animation: "animate-[pulse_0.8s_ease-in-out_infinite]",
    label: "Thinking…",
  },
  tool_call: {
    color: "bg-cyan-400/80",
    glow: "shadow-[0_0_16px_oklch(0.82_0.22_195/0.7),0_0_40px_oklch(0.82_0.22_195/0.3)]",
    ring: "ring-cyan-400/30",
    animation: "animate-[pulse_0.6s_ease-in-out_infinite]",
    label: "Executing…",
  },
  shadow_test: {
    color: "bg-amber-400/80",
    glow: "shadow-[0_0_16px_oklch(0.78_0.2_70/0.7),0_0_40px_oklch(0.78_0.2_70/0.3)]",
    ring: "ring-amber-400/30",
    animation: "animate-[pulse_1.2s_ease-in-out_infinite]",
    label: "Shadow Testing",
  },
  success: {
    color: "bg-green-400/80",
    glow: "shadow-[0_0_20px_oklch(0.78_0.22_145/0.8),0_0_50px_oklch(0.78_0.22_145/0.3)]",
    ring: "ring-green-400/40",
    animation: "animate-[pulse_0.4s_ease-in-out_3]",
    label: "Done",
  },
  error: {
    color: "bg-red-500/80",
    glow: "shadow-[0_0_16px_oklch(0.65_0.25_25/0.7),0_0_40px_oklch(0.65_0.25_25/0.3)]",
    ring: "ring-red-500/30",
    animation: "animate-[pulse_0.5s_ease-in-out_4]",
    label: "Error",
  },
};

const SIZE_MAP = {
  sm: { orb: "w-2 h-2", ring: "w-4 h-4", text: "text-xs" },
  md: { orb: "w-3 h-3", ring: "w-5 h-5", text: "text-xs" },
  lg: { orb: "w-4 h-4", ring: "w-7 h-7", text: "text-sm" },
};

export function AmbientOrb({ state, size = "md", className = "", label }: AmbientOrbProps) {
  const cfg = ORB_CONFIG[state];
  const sz = SIZE_MAP[size];

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Orb with ring */}
      <div className={`relative flex items-center justify-center ${sz.ring}`}>
        {/* Outer ring */}
        <div className={`absolute inset-0 rounded-full ${cfg.color.replace("70", "20").replace("80", "15")} ring-1 ${cfg.ring}`} />
        {/* Inner orb */}
        <div className={`rounded-full ${sz.orb} ${cfg.color} ${cfg.glow} ${cfg.animation}`} />
      </div>
      {/* Label */}
      {(label !== undefined ? label : cfg.label) && (
        <span className={`${sz.text} text-muted-foreground font-medium tabular-nums`}>
          {label ?? cfg.label}
        </span>
      )}
    </div>
  );
}

/**
 * Hook to derive OrbState from chat/agent state flags.
 */
export function useOrbState(isLoading: boolean, isStreaming: boolean, isShadowTesting: boolean, lastError: boolean): OrbState {
  const [orbState, setOrbState] = useState<OrbState>("idle");

  useEffect(() => {
    if (lastError) {
      setOrbState("error");
      const t = setTimeout(() => setOrbState("idle"), 2500);
      return () => clearTimeout(t);
    }
    if (isShadowTesting) {
      setOrbState("shadow_test");
      return;
    }
    if (isStreaming) {
      setOrbState("thinking");
      return;
    }
    if (isLoading) {
      setOrbState("tool_call");
      return;
    }
    // Transition through success briefly
    if (orbState === "thinking" || orbState === "tool_call") {
      setOrbState("success");
      const t = setTimeout(() => setOrbState("idle"), 1500);
      return () => clearTimeout(t);
    }
    setOrbState("idle");
  }, [isLoading, isStreaming, isShadowTesting, lastError]);

  return orbState;
}
