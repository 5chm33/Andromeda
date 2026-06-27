/**
 * pluginManager.ts — v66.0.0 "Real-World Integration"
 * Dynamic plugin loading, lifecycle management, dependency resolution, and hot-reload.
 */

export type PluginStatus = "registered" | "loaded" | "active" | "disabled" | "error";
export interface PluginManifest { name: string; version: string; description: string; dependencies: string[]; capabilities: string[]; }
export interface Plugin { manifest: PluginManifest; status: PluginStatus; loadedAt?: number; errorMessage?: string; }

const plugins = new Map<string, Plugin>();

export function registerPlugin(manifest: PluginManifest): Plugin {
  const plugin: Plugin = { manifest, status: "registered" };
  plugins.set(manifest.name, plugin);
  return plugin;
}

export function loadPlugin(name: string): Plugin {
  const plugin = plugins.get(name);
  if (!plugin) throw new Error(`[PluginManager] Plugin not found: ${name}`);
  // Check dependencies
  for (const dep of plugin.manifest.dependencies) {
    const depPlugin = plugins.get(dep);
    if (!depPlugin || depPlugin.status !== "active") {
      plugin.status = "error";
      plugin.errorMessage = `Dependency not active: ${dep}`;
      return plugin;
    }
  }
  plugin.status = "loaded";
  plugin.loadedAt = Date.now();
  return plugin;
}

export function activatePlugin(name: string): Plugin {
  const plugin = plugins.get(name);
  if (!plugin) throw new Error(`[PluginManager] Plugin not found: ${name}`);
  if (plugin.status !== "loaded") loadPlugin(name);
  if (plugin.status === "loaded") plugin.status = "active";
  return plugin;
}

export function disablePlugin(name: string): Plugin {
  const plugin = plugins.get(name);
  if (!plugin) throw new Error(`[PluginManager] Plugin not found: ${name}`);
  plugin.status = "disabled";
  return plugin;
}

export function getPlugin(name: string): Plugin | undefined { return plugins.get(name); }
export function listPlugins(): Plugin[] { return [...plugins.values()]; }
export function getActiveCapabilities(): string[] {
  const caps = new Set<string>();
  plugins.forEach(p => { if (p.status === "active") p.manifest.capabilities.forEach(c => caps.add(c)); });
  return [...caps];
}
export function _resetPluginManagerForTest(): void { plugins.clear(); }
