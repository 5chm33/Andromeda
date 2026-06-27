/**
 * optimizationSuggester.ts — v92.0.0 "Recursive Self-Improvement & Introspection"
 * Generates targeted optimization suggestions based on profiling and bottleneck data.
 */
export type OptimizationCategory = "algorithmic" | "caching" | "parallelism" | "memory" | "io" | "architecture";

export interface OptimizationSuggestion {
  suggestionId: string;
  category: OptimizationCategory;
  title: string;
  description: string;
  estimatedSpeedup: number;
  implementationComplexity: "low" | "medium" | "high";
  priority: number;
  targetComponent: string;
  generatedAt: number;
}

export interface OptimizationPlan {
  planId: string;
  agentId: string;
  suggestions: OptimizationSuggestion[];
  estimatedTotalSpeedup: number;
  totalPriority: number;
  createdAt: number;
}

const suggestions: OptimizationSuggestion[] = [];
const plans: OptimizationPlan[] = [];
let suggestionCounter = 0;
let planCounter = 0;

export function suggestOptimization(category: OptimizationCategory, title: string, description: string, targetComponent: string, estimatedSpeedup: number, complexity: OptimizationSuggestion["implementationComplexity"]): OptimizationSuggestion {
  const complexityPenalty = { low: 0, medium: 0.2, high: 0.4 }[complexity];
  const priority = Math.max(0, estimatedSpeedup - complexityPenalty);

  const suggestion: OptimizationSuggestion = {
    suggestionId: `os-${++suggestionCounter}`,
    category, title, description, estimatedSpeedup,
    implementationComplexity: complexity,
    priority, targetComponent,
    generatedAt: Date.now(),
  };
  suggestions.push(suggestion);
  return suggestion;
}

export function generatePlan(agentId: string, targetComponents?: string[]): OptimizationPlan {
  const eligible = targetComponents ? suggestions.filter(s => targetComponents.includes(s.targetComponent)) : [...suggestions];
  const sorted = eligible.sort((a, b) => b.priority - a.priority);

  const estimatedTotalSpeedup = sorted.reduce((s, sg) => s + sg.estimatedSpeedup, 0);
  const totalPriority = sorted.reduce((s, sg) => s + sg.priority, 0);

  const plan: OptimizationPlan = { planId: `op-${++planCounter}`, agentId, suggestions: sorted, estimatedTotalSpeedup, totalPriority, createdAt: Date.now() };
  plans.push(plan);
  return plan;
}

export function getSuggestions(category?: OptimizationCategory): OptimizationSuggestion[] { return category ? suggestions.filter(s => s.category === category) : [...suggestions]; }
export function getPlans(agentId?: string): OptimizationPlan[] { return agentId ? plans.filter(p => p.agentId === agentId) : [...plans]; }
export function _resetOptimizationSuggesterForTest(): void { suggestions.length = 0; plans.length = 0; suggestionCounter = 0; planCounter = 0; }
