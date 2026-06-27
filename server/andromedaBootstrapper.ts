/**
 * andromedaBootstrapper.ts — v100.0.0 "Andromeda: The Complete Autonomous AI System"
 * System bootstrapper that initializes and wires all Andromeda subsystems at startup.
 */
export interface BootstrapConfig {
  systemName: string;
  version: string;
  enabledModules: string[];
  startupTimeoutMs: number;
  healthCheckIntervalMs: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

export interface BootstrapResult {
  success: boolean;
  systemName: string;
  version: string;
  modulesLoaded: number;
  modulesFailed: number;
  startupDurationMs: number;
  errors: string[];
  warnings: string[];
  readyAt: number;
}

export interface ModuleManifest {
  moduleId: string;
  name: string;
  version: string;
  dependencies: string[];
  loaded: boolean;
  loadedAt: number | null;
  error: string | null;
}

const manifests = new Map<string, ModuleManifest>();
const bootstrapHistory: BootstrapResult[] = [];
let moduleCounter = 0;
let currentConfig: BootstrapConfig | null = null;

export function configure(config: BootstrapConfig): void {
  currentConfig = { ...config };
}

export function registerModule(name: string, version: string, dependencies: string[] = []): ModuleManifest {
  const manifest: ModuleManifest = { moduleId: `mod-${++moduleCounter}`, name, version, dependencies, loaded: false, loadedAt: null, error: null };
  manifests.set(manifest.moduleId, manifest);
  return manifest;
}

export function bootstrap(config?: BootstrapConfig): BootstrapResult {
  const cfg = config ?? currentConfig ?? { systemName: "Andromeda", version: "100.0.0", enabledModules: [], startupTimeoutMs: 5000, healthCheckIntervalMs: 30000, logLevel: "info" };
  const startTime = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];
  let modulesLoaded = 0;
  let modulesFailed = 0;

  // Sort modules by dependency order
  const sorted: ModuleManifest[] = [];
  const visited = new Set<string>();
  const visit = (manifest: ModuleManifest) => {
    if (visited.has(manifest.moduleId)) return;
    visited.add(manifest.moduleId);
    for (const dep of manifest.dependencies) {
      const depManifest = [...manifests.values()].find(m => m.name === dep);
      if (depManifest) visit(depManifest);
      else warnings.push(`Dependency '${dep}' for module '${manifest.name}' not registered`);
    }
    sorted.push(manifest);
  };
  for (const manifest of manifests.values()) visit(manifest);

  // Load modules in order
  for (const manifest of sorted) {
    if (cfg.enabledModules.length > 0 && !cfg.enabledModules.includes(manifest.name)) {
      warnings.push(`Module '${manifest.name}' skipped (not in enabledModules)`);
      continue;
    }
    try {
      manifest.loaded = true;
      manifest.loadedAt = Date.now();
      modulesLoaded++;
    } catch (err) {
      manifest.error = String(err);
      modulesFailed++;
      errors.push(`Failed to load '${manifest.name}': ${err}`);
    }
  }

  const result: BootstrapResult = { success: modulesFailed === 0, systemName: cfg.systemName, version: cfg.version, modulesLoaded, modulesFailed, startupDurationMs: Date.now() - startTime, errors, warnings, readyAt: Date.now() };
  bootstrapHistory.push(result);
  return result;
}

export function getManifest(moduleId: string): ModuleManifest | undefined { return manifests.get(moduleId); }
export function getAllManifests(): ModuleManifest[] { return [...manifests.values()]; }
export function getBootstrapHistory(): BootstrapResult[] { return [...bootstrapHistory]; }
export function getCurrentConfig(): BootstrapConfig | null { return currentConfig ? { ...currentConfig } : null; }
export function _resetAndromedaBootstrapperForTest(): void { manifests.clear(); bootstrapHistory.length = 0; moduleCounter = 0; currentConfig = null; }
