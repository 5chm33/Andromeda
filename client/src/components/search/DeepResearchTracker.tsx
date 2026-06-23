import React from "react";
import {
  FlaskConical,
  Loader2,
  CheckCircle2,
  Circle,
} from "lucide-react";
import type { SearchSource } from "../../../../drizzle/schema";

export interface DeepResearchProgress {
  step: string;
  message: string;
  queries?: string[];
  sources?: SearchSource[];
}

export function DeepResearchTracker({ progress }: { progress: DeepResearchProgress[] }) {
  const steps = [
    { key: "planning", label: "Planning research strategy" },
    { key: "queries", label: "Running parallel searches" },
    { key: "sources", label: "Aggregating sources" },
  ];
  const completedSteps = new Set(progress.map((p) => p.step));
  const currentStep = progress[progress.length - 1];
  return (
    <div className="rounded-xl p-4 space-y-3 bg-zinc-900 border border-purple-500/20">
      <div className="flex items-center gap-2 mb-2">
        <FlaskConical className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-medium text-purple-300">Deep Research Mode</span>
        <Loader2 className="w-3.5 h-3.5 text-purple-400 animate-spin ml-auto" />
      </div>
      <div className="space-y-2">
        {steps.map((step) => {
          const done = completedSteps.has(step.key);
          const active = currentStep?.step === step.key;
          return (
            <div key={step.key} className="flex items-center gap-2.5">
              {done ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : active ? (
                <Loader2 className="w-4 h-4 text-purple-400 animate-spin flex-shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-zinc-700 flex-shrink-0" />
              )}
              <span className={`text-xs ${done ? "text-zinc-300" : active ? "text-purple-300" : "text-zinc-600"}`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
      {currentStep?.queries && (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-zinc-600">Sub-queries:</p>
          {currentStep.queries.map((q, i) => (
            <p key={i} className="text-xs text-zinc-500 pl-2 border-l border-purple-500/30">{q}</p>
          ))}
        </div>
      )}
      {currentStep?.message && (
        <p className="text-xs text-zinc-500 italic">{currentStep.message}</p>
      )}
    </div>
  );
}
