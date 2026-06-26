/**
 * Module Composer — composes new modules from existing building blocks.
 * Implements higher-order composition patterns and module fusion.
 */

export interface ModuleBlueprint {
  id: string;
  name: string;
  inputTypes: string[];
  outputTypes: string[];
  composedFrom: string[];
  compositionPattern: "pipeline" | "fan_out" | "fan_in" | "map_reduce" | "feedback";
  estimatedComplexity: number;  // O(n) = 1, O(n²) = 2, etc.
  createdAt: number;
}

export interface CompositionResult {
  blueprint: ModuleBlueprint;
  isValid: boolean;
  typeErrors: string[];
  complexityScore: number;
  recommendation: string;
}

export interface ComposerReport {
  totalComposed: number;
  validCompositions: number;
  avgComplexity: number;
  mostUsedPattern: string;
}

class ModuleComposerEngine {
  private blueprints: ModuleBlueprint[] = [];
  private counter = 0;

  compose(
    name: string,
    modules: Array<{ id: string; inputTypes: string[]; outputTypes: string[] }>,
    pattern: ModuleBlueprint["compositionPattern"]
  ): CompositionResult {
    const typeErrors: string[] = [];

    // Type compatibility check for pipeline pattern
    if (pattern === "pipeline") {
      for (let i = 0; i < modules.length - 1; i++) {
        const current = modules[i]!;
        const next = modules[i + 1]!;
        const compatible = current.outputTypes.some(t => next.inputTypes.includes(t));
        if (!compatible) {
          typeErrors.push(`Type mismatch: ${current.id} outputs [${current.outputTypes}] but ${next.id} expects [${next.inputTypes}]`);
        }
      }
    }

    const complexity = pattern === "map_reduce" ? 2 : pattern === "fan_out" || pattern === "fan_in" ? 1.5 : 1;
    const blueprint: ModuleBlueprint = {
      id: `blueprint-${++this.counter}`,
      name,
      inputTypes: modules[0]?.inputTypes ?? [],
      outputTypes: modules[modules.length - 1]?.outputTypes ?? [],
      composedFrom: modules.map(m => m.id),
      compositionPattern: pattern,
      estimatedComplexity: complexity,
      createdAt: Date.now(),
    };
    this.blueprints.push(blueprint);

    const recommendation = typeErrors.length === 0
      ? `Valid ${pattern} composition of ${modules.length} modules`
      : `Fix ${typeErrors.length} type error(s) before deployment`;

    return {
      blueprint,
      isValid: typeErrors.length === 0,
      typeErrors,
      complexityScore: complexity,
      recommendation,
    };
  }

  getComposerReport(): ComposerReport {
    const valid = this.blueprints.filter(b => b.estimatedComplexity <= 2);
    const patternCounts = this.blueprints.reduce((acc, b) => {
      acc[b.compositionPattern] = (acc[b.compositionPattern] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const mostUsed = Object.entries(patternCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
    return {
      totalComposed: this.blueprints.length,
      validCompositions: valid.length,
      avgComplexity: this.blueprints.length > 0
        ? this.blueprints.reduce((s, b) => s + b.estimatedComplexity, 0) / this.blueprints.length
        : 0,
      mostUsedPattern: mostUsed,
    };
  }

  getBlueprints(): ModuleBlueprint[] { return [...this.blueprints]; }
}

export const globalModuleComposer = new ModuleComposerEngine();

export function composeModules(
  name: string,
  modules: Array<{ id: string; inputTypes: string[]; outputTypes: string[] }>,
  pattern: ModuleBlueprint["compositionPattern"]
): CompositionResult {
  return globalModuleComposer.compose(name, modules, pattern);
}
export function getComposerReport(): ComposerReport {
  return globalModuleComposer.getComposerReport();
}
export function initModuleComposer(): void {
  console.log("[ModuleComposer] Module Composer initialized.");
}
