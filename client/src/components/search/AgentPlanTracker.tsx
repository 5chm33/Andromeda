import React from "react";
import {
  Bot,
  Globe,
  FileSearch,
  Code2,
  Sparkles,
  Loader2,
  CheckCircle2,
  Circle,
} from "lucide-react";

export interface AgentStep {
  type: "search" | "browse" | "code" | "answer";
  description: string;
  query?: string;
  url?: string;
  code?: string;
  language?: string;
}

export interface AgentStepResult {
  stepIndex: number;
  result?: string;
  sources?: any[];
  exitCode?: number;
  message?: string;
}

function AgentStepIcon({ type }: { type: AgentStep["type"] }) {
  switch (type) {
    case "search": return <Globe className="w-3.5 h-3.5 text-blue-400" />;
    case "browse": return <FileSearch className="w-3.5 h-3.5 text-cyan-400" />;
    case "code":   return <Code2 className="w-3.5 h-3.5 text-amber-400" />;
    case "answer": return <Sparkles className="w-3.5 h-3.5 text-violet-400" />;
    default:       return <Circle className="w-3.5 h-3.5 text-zinc-500" />;
  }
}

export function AgentPlanTracker({ steps, currentStep, results, isRunning }: {
  steps: AgentStep[];
  currentStep: number;
  results: AgentStepResult[];
  isRunning: boolean;
}) {
  return (
    <div className="rounded-xl p-4 space-y-3 bg-zinc-900 border border-violet-500/20">
      <div className="flex items-center gap-2">
        <Bot className="w-4 h-4 text-violet-400" />
        <span className="text-sm font-medium text-violet-300">Agent Mode</span>
        <span className="text-xs text-zinc-500 ml-1">{steps.length} steps planned</span>
        {isRunning && <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin ml-auto" />}
        {!isRunning && steps.length > 0 && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 ml-auto" />}
      </div>
      <div className="space-y-1.5">
        {steps.map((step, i) => {
          const isDone = i < currentStep || (!isRunning && i <= currentStep);
          const isActive = isRunning && i === currentStep;
          const result = results.find((r) => r.stepIndex === i);
          const hasError = result?.message;
          return (
            <div key={i} className={`flex items-start gap-2.5 rounded-lg px-3 py-2 transition-colors ${
              isActive ? "bg-violet-500/10 border border-violet-500/20" : isDone ? "opacity-70" : "opacity-30"
            }`}>
              <div className="flex-shrink-0 mt-0.5">
                {isActive ? <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin" />
                  : isDone && !hasError ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  : hasError ? <Circle className="w-3.5 h-3.5 text-red-400" />
                  : <Circle className="w-3.5 h-3.5 text-zinc-700" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <AgentStepIcon type={step.type} />
                  <span className={`text-xs font-medium ${isActive ? "text-white" : isDone ? "text-zinc-300" : "text-zinc-600"}`}>
                    {step.description}
                  </span>
                </div>
                {result?.result && <p className="text-xs text-zinc-500 mt-0.5 truncate">{result.result}</p>}
                {hasError && <p className="text-xs text-red-400/80 mt-0.5 truncate">{result?.message}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
