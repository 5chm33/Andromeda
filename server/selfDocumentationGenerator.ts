/**
 * Self-Documentation Generator — auto-generates and maintains module documentation.
 * Produces API docs, Mermaid architecture diagrams, and changelog entries.
 */

export interface ModuleDoc {
  moduleName: string;
  description: string;
  exports: ExportDoc[];
  generatedAt: number;
  version: string;
}

export interface ExportDoc {
  name: string;
  kind: "function" | "interface" | "class" | "const";
  signature: string;
  description: string;
}

export interface ArchitectureDiagram {
  format: "mermaid";
  content: string;
  moduleCount: number;
  edgeCount: number;
  generatedAt: number;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
  breakingChanges: string[];
}

export interface DocumentationCoverage {
  totalModules: number;
  documentedModules: number;
  coveragePercent: number;
  undocumentedModules: string[];
}

class SelfDocumentationGeneratorEngine {
  private docs: Map<string, ModuleDoc> = new Map();
  private changelog: ChangelogEntry[] = [];
  private diagramCache: ArchitectureDiagram | null = null;

  generateModuleDoc(moduleName: string, exports: ExportDoc[], description: string, version = "35.1.0"): ModuleDoc {
    const doc: ModuleDoc = {
      moduleName,
      description,
      exports,
      generatedAt: Date.now(),
      version,
    };
    this.docs.set(moduleName, doc);
    this.diagramCache = null; // Invalidate diagram cache
    return doc;
  }

  generateArchitectureDiagram(modules: Array<{ name: string; deps: string[] }>): ArchitectureDiagram {
    if (this.diagramCache && modules.length === this.diagramCache.moduleCount) {
      return this.diagramCache;
    }
    const lines = ["graph TD"];
    const edges: string[] = [];
    for (const mod of modules) {
      lines.push(`  ${mod.name.replace(/[^a-zA-Z0-9]/g, "_")}["${mod.name}"]`);
      for (const dep of mod.deps) {
        edges.push(`  ${mod.name.replace(/[^a-zA-Z0-9]/g, "_")} --> ${dep.replace(/[^a-zA-Z0-9]/g, "_")}["${dep}"]`);
      }
    }
    const content = [...lines, ...edges].join("\n");
    const diagram: ArchitectureDiagram = {
      format: "mermaid",
      content,
      moduleCount: modules.length,
      edgeCount: edges.length,
      generatedAt: Date.now(),
    };
    this.diagramCache = diagram;
    return diagram;
  }

  generateChangelog(version: string, changes: string[], breakingChanges: string[] = []): ChangelogEntry {
    const entry: ChangelogEntry = {
      version,
      date: new Date().toISOString().split("T")[0] ?? new Date().toISOString(),
      changes,
      breakingChanges,
    };
    this.changelog.push(entry);
    return entry;
  }

  updateDocumentation(moduleName: string, newExports: ExportDoc[]): ModuleDoc {
    const existing = this.docs.get(moduleName);
    if (existing) {
      existing.exports = newExports;
      existing.generatedAt = Date.now();
      return existing;
    }
    return this.generateModuleDoc(moduleName, newExports, `Auto-documented module: ${moduleName}`);
  }

  getDocumentationCoverage(allModuleNames: string[]): DocumentationCoverage {
    const documented = allModuleNames.filter(m => this.docs.has(m));
    const undocumented = allModuleNames.filter(m => !this.docs.has(m));
    return {
      totalModules: allModuleNames.length,
      documentedModules: documented.length,
      coveragePercent: allModuleNames.length > 0 ? (documented.length / allModuleNames.length) * 100 : 100,
      undocumentedModules: undocumented.slice(0, 20),
    };
  }

  getDocs(): ModuleDoc[] { return Array.from(this.docs.values()); }
  getChangelog(): ChangelogEntry[] { return [...this.changelog]; }
}

export const globalSelfDocumentation = new SelfDocumentationGeneratorEngine();

export function generateModuleDoc(moduleName: string, exports: ExportDoc[], description: string, version?: string): ModuleDoc {
  return globalSelfDocumentation.generateModuleDoc(moduleName, exports, description, version);
}
export function generateArchitectureDiagram(modules: Array<{ name: string; deps: string[] }>): ArchitectureDiagram {
  return globalSelfDocumentation.generateArchitectureDiagram(modules);
}
export function generateChangelog(version: string, changes: string[], breakingChanges?: string[]): ChangelogEntry {
  return globalSelfDocumentation.generateChangelog(version, changes, breakingChanges);
}
export function updateDocumentation(moduleName: string, newExports: ExportDoc[]): ModuleDoc {
  return globalSelfDocumentation.updateDocumentation(moduleName, newExports);
}
export function getDocumentationCoverage(allModuleNames: string[]): DocumentationCoverage {
  return globalSelfDocumentation.getDocumentationCoverage(allModuleNames);
}
export function initSelfDocumentationGenerator(): void {
  console.log("[SelfDoc] Self-Documentation Generator initialized.");
  globalSelfDocumentation.generateChangelog("35.1.0", [
    "Added perpetualStatePersistence, adaptiveExplorationController, multiObjectiveOptimizer",
    "Added knowledgeGraphBuilder, anomalyDetectionEngine, selfDocumentationGenerator",
  ]);
}
