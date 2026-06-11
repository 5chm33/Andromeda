/**
 * runtimeConfig.ts — v5.16
 *
 * Runtime Configuration Persistence Module.
 *
 * Provides a simple JSON file-backed config store that persists settings
 * (auto-apply threshold, model overrides, feature flags) to
 * `workspace/andromeda-config.json`.
 *
 * Features:
 * - Atomic writes (write to temp, rename)
 * - Schema validation with defaults
 * - Change listeners for reactive updates
 * - Merge semantics (partial updates don't clobber unrelated fields)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RuntimeConfig {
  // LLM settings
  llm: {
    baseUrl: string;
    apiKey: string; // stored as "***" in API responses, real value in file
    defaultModel: string;
    reasonerModel: string;
    maxTokens: number;
    temperature: number;
  };

  // Self-improvement settings
  selfImprove: {
    autoApplyEnabled: boolean;
    confidenceThreshold: number;
    maxAutoAppliesPerHour: number;
    requireTypeCheck: boolean;
    commitToGit: boolean;
    branchStrategy: "main" | "feature-branch";
  };

  // Search settings
  search: {
    qualityThreshold: number;
    maxResults: number;
    preferredEngine: "brave" | "searxng" | "auto";
  };

  // Feature flags
  features: {
    autoContinuation: boolean;
    largePasteDetection: boolean;
    multiPassFileEngine: boolean;
    selfHealing: boolean;
    dependencyAutoUpdate: boolean;
    planMode: boolean;
    todoTool: boolean;
    compactMode: boolean;
  };

  // UI preferences
  ui: {
    theme: "dark" | "light";
    showPhaseIndicator: boolean;
    showTokenUsage: boolean;
    maxHistoryItems: number;
  };

  // v5.32: Centralized config for autonomous modules
  continuousImprover: {
    enabled: boolean;
    intervalMs: number;
    maxAppliesPerCycle: number;
    dryRun: boolean;
  };

  orchestrator: {
    enabled: boolean;
    maxConcurrentGoals: number;
    goalTimeoutMs: number;
  };

  goalSuggester: {
    enabled: boolean;
    maxSuggestions: number;
    minConfidence: number;
  };

  contextBus: {
    maxEntries: number;
    maxAgeMs: number;
  };

  hotReload: {
    enabled: boolean;
    watchDynamic: boolean; // v5.32: Watch all .ts files, not just hardcoded list
  };

  // Meta
  _version: string;
  _lastModified: string;
  _modifiedBy: "user" | "system" | "self-improve";
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: RuntimeConfig = {
  llm: {
    baseUrl: "https://api.deepseek.com",
    apiKey: "",
    defaultModel: "deepseek/deepseek-chat",
    reasonerModel: "deepseek-reasoner",
    maxTokens: 32000,
    temperature: 0.7,
  },
  selfImprove: {
    autoApplyEnabled: true,   // v5.53: enabled by default
    confidenceThreshold: 75,  // v5.53: lowered from 90 for more responsive self-improvement
    maxAutoAppliesPerHour: 8, // v5.53: increased from 5
    requireTypeCheck: true,
    commitToGit: true,
    branchStrategy: "main",
  },
  search: {
    qualityThreshold: 0.6,
    maxResults: 10,
    preferredEngine: "auto",
  },
  features: {
    autoContinuation: true,
    largePasteDetection: true,
    multiPassFileEngine: true,
    selfHealing: true,
    dependencyAutoUpdate: false,
    planMode: true,
    todoTool: true,
    compactMode: true,
  },
  ui: {
    theme: "dark",
    showPhaseIndicator: true,
    showTokenUsage: true,
    maxHistoryItems: 50,
  },
  continuousImprover: {
    enabled: true,            // v5.53: enabled by default
    intervalMs: 30 * 60 * 1000, // 30 minutes
    maxAppliesPerCycle: 3,
    dryRun: false,            // v5.53: actually apply improvements
  },
  orchestrator: {
    enabled: true,            // v5.53: enabled by default
    maxConcurrentGoals: 3,
    goalTimeoutMs: 600_000,
  },
  goalSuggester: {
    enabled: true,
    maxSuggestions: 5,
    minConfidence: 0.7,
  },
  contextBus: {
    maxEntries: 5000,
    maxAgeMs: 30 * 60 * 1000,
  },
  hotReload: {
    enabled: true,
    watchDynamic: true,
  },
  _version: "5.32.0",
  _lastModified: new Date().toISOString(),
  _modifiedBy: "system",
};

// ─── Storage ──────────────────────────────────────────────────────────────────

function getServerDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function getConfigPath(): string {
  const workspaceDir = path.resolve(process.cwd(), "workspace");
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
  return path.join(workspaceDir, "andromeda-config.json");
}

// ─── Change Listeners ─────────────────────────────────────────────────────────

type ConfigChangeListener = (newConfig: RuntimeConfig, oldConfig: RuntimeConfig) => void;
const listeners: ConfigChangeListener[] = [];

export function onConfigChange(listener: ConfigChangeListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

function notifyListeners(newConfig: RuntimeConfig, oldConfig: RuntimeConfig): void {
  for (const listener of listeners) {
    try {
      listener(newConfig, oldConfig);
    } catch (err) {
      console.warn("[RuntimeConfig] Listener error:", (err as Error).message);
    }
  }
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Load the current runtime configuration.
 * Returns defaults merged with any persisted overrides.
 */
export function loadConfig(): RuntimeConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return { ...DEFAULT_CONFIG };

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    // Deep merge with defaults to handle schema evolution
    return deepMerge(DEFAULT_CONFIG, raw) as RuntimeConfig;
  } catch {
    console.warn("[RuntimeConfig] Failed to parse config file, using defaults");
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save a partial config update. Merges with existing config.
 * Returns the full merged config.
 */
export function saveConfig(
  updates: DeepPartial<RuntimeConfig>,
  modifiedBy: "user" | "system" | "self-improve" = "user"
): RuntimeConfig {
  const oldConfig = loadConfig();
  const newConfig = deepMerge(oldConfig, {
    ...updates,
    _lastModified: new Date().toISOString(),
    _modifiedBy: modifiedBy,
    _version: "6.20.0",
  }) as RuntimeConfig;

  // Atomic write: write to temp file, then rename
  const configPath = getConfigPath();
  const tempPath = configPath + ".tmp";

  // Redact API key in the stored version? No — we store the real key.
  // The API endpoint will redact when serving to frontend.
  fs.writeFileSync(tempPath, JSON.stringify(newConfig, null, 2), "utf-8");
  fs.renameSync(tempPath, configPath);

  notifyListeners(newConfig, oldConfig);
  return newConfig;
}

/**
 * Reset config to defaults.
 */
export function resetConfig(): RuntimeConfig {
  const oldConfig = loadConfig();
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  notifyListeners(DEFAULT_CONFIG, oldConfig);
  return { ...DEFAULT_CONFIG };
}

/**
 * Get a specific config section.
 */
export function getConfigSection<K extends keyof RuntimeConfig>(key: K): RuntimeConfig[K] {
  return loadConfig()[key];
}

/**
 * Get config safe for API response (redacts sensitive fields).
 */
export function getPublicConfig(): RuntimeConfig {
  const config = loadConfig();
  return {
    ...config,
    llm: {
      ...config.llm,
      apiKey: config.llm.apiKey ? "***configured***" : "",
    },
  };
}

// ─── Deep Merge Utility ───────────────────────────────────────────────────────

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

function deepMerge(target: any, source: any): any {
  if (!source) return target;
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object"
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }

  return result;
}

// ─── Environment Sync ─────────────────────────────────────────────────────────

/**
 * Apply config values to environment variables (for modules that read from env).
 * Called on startup and after config changes.
 */
export function syncConfigToEnv(): void {
  const config = loadConfig();

  if (config.llm.baseUrl) process.env.LLM_BASE_URL = config.llm.baseUrl;
  if (config.llm.apiKey) process.env.LLM_API_KEY = config.llm.apiKey;
  if (config.llm.defaultModel) process.env.LLM_DEFAULT_MODEL = config.llm.defaultModel;
  if (config.llm.reasonerModel) process.env.LLM_REASONER_MODEL = config.llm.reasonerModel;
  if (config.llm.maxTokens) process.env.LLM_MAX_TOKENS = String(config.llm.maxTokens);

  // v6.13: When using a non-DeepSeek provider (e.g. openrouter), override DEEPSEEK_API_URL
  // and DEEPSEEK_MODEL so that ai.ts routes through the active provider instead of DeepSeek directly.
  const llmModel = process.env.LLM_MODEL ?? "";
  if (llmModel && llmModel !== "deepseek" && llmModel !== "deepseek-chat" && llmModel !== "deepseek-v3") {
    // Defer to llmProvider for the actual URL/model/key resolution
    process.env.__ANDROMEDA_PROVIDER_OVERRIDE = "true";
  }
}

/**
 * Initialize runtime config on startup — loads persisted config and syncs to env.
 */
export function initRuntimeConfig(): void {
  syncConfigToEnv();
  console.log("[RuntimeConfig] Initialized from", getConfigPath());
}
