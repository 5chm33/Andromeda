/**
 * ModuleBrowser.tsx — v101.0.0
 * Searchable, filterable browser for all Andromeda modules.
 * Fetches module metadata from /api/modules and displays health, test status,
 * version, and description for each module.
 */
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Package, Search, Filter, CheckCircle2, XCircle, AlertTriangle,
  RefreshCw, ChevronRight, Code2, Cpu, Brain, Shield, Zap, Database,
  BarChart3, GitBranch, Clock, Info, X, Activity
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ModuleInfo {
  name: string;
  version?: string;
  category: string;
  description?: string;
  testStatus: "passing" | "failing" | "missing";
  testCount?: number;
  linesOfCode?: number;
  exportCount?: number;
  hasLogger?: boolean;
  addedInVersion?: number;
}

// ── Category config ───────────────────────────────────────────────────────────
const CATEGORY_CONFIG: Record<string, { color: string; icon: React.FC<{size?: number; className?: string}> }> = {
  "Core":            { color: "#8b5cf6", icon: Brain },
  "Safety":          { color: "#ef4444", icon: Shield },
  "RSI":             { color: "#10b981", icon: Zap },
  "Memory":          { color: "#06b6d4", icon: Database },
  "Monitoring":      { color: "#f59e0b", icon: Activity },
  "Infrastructure":  { color: "#64748b", icon: Cpu },
  "Intelligence":    { color: "#a78bfa", icon: BarChart3 },
  "Communication":   { color: "#34d399", icon: GitBranch },
  "Other":           { color: "#94a3b8", icon: Code2 },
};

// ── Mock data (used when API is offline) ──────────────────────────────────────
function generateMockModules(): ModuleInfo[] {
  const categories = Object.keys(CATEGORY_CONFIG);
  const modules = [
    { name: "rsiEngine", category: "RSI", desc: "Core recursive self-improvement engine" },
    { name: "constitutionalGuard", category: "Safety", desc: "Constitutional AI safety layer" },
    { name: "episodicMemory", category: "Memory", desc: "Episodic memory store with temporal indexing" },
    { name: "swarmOrchestrator", category: "Core", desc: "Multi-agent swarm coordination" },
    { name: "chaosEngineer", category: "Monitoring", desc: "Chaos engineering and fault injection" },
    { name: "knowledgeGraph", category: "Intelligence", desc: "Knowledge graph with entity linking" },
    { name: "ethicsEngine", category: "Safety", desc: "Ethical reasoning and value alignment" },
    { name: "andromedaCore", category: "Core", desc: "Central integration hub — v100 capstone" },
    { name: "causalGraph", category: "Intelligence", desc: "Causal inference and do-calculus" },
    { name: "spikingNeuron", category: "Intelligence", desc: "Neuromorphic spiking neuron model" },
    { name: "workflowEngine", category: "Infrastructure", desc: "Event-driven workflow execution" },
    { name: "privacyEngine", category: "Safety", desc: "PII detection and data anonymization" },
    { name: "traceCollector", category: "Monitoring", desc: "Distributed trace collection" },
    { name: "agentRegistry", category: "Core", desc: "Multi-agent registry and discovery" },
    { name: "metaLearner", category: "Intelligence", desc: "Meta-learning and few-shot adaptation" },
    { name: "hierarchicalPlanner", category: "Core", desc: "Hierarchical goal decomposition planner" },
    { name: "selfAwarenessEngine", category: "Core", desc: "System self-model and introspection" },
    { name: "universalReasoningEngine", category: "Intelligence", desc: "General-purpose reasoning engine" },
    { name: "embodiedAgent", category: "Intelligence", desc: "Embodied cognition and spatial reasoning" },
    { name: "crowdWisdomAggregator", category: "Intelligence", desc: "Collective intelligence aggregation" },
  ];

  return modules.map((m, i) => ({
    name: m.name,
    version: `${Math.floor(i / 6) + 1}.0.0`,
    category: m.category,
    description: m.desc,
    testStatus: Math.random() > 0.05 ? "passing" : "failing",
    testCount: Math.floor(Math.random() * 20) + 5,
    linesOfCode: Math.floor(Math.random() * 200) + 50,
    exportCount: Math.floor(Math.random() * 8) + 2,
    hasLogger: Math.random() > 0.2,
    addedInVersion: Math.floor(Math.random() * 100) + 1,
  }));
}

// ── Module Card ───────────────────────────────────────────────────────────────
const ModuleCard: React.FC<{
  module: ModuleInfo;
  onClick: () => void;
  isSelected: boolean;
}> = ({ module, onClick, isSelected }) => {
  const catConfig = CATEGORY_CONFIG[module.category] ?? CATEGORY_CONFIG["Other"];
  const Icon = catConfig.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      onClick={onClick}
      className={`p-3 rounded-xl border cursor-pointer transition-all ${
        isSelected
          ? "border-purple-500 bg-purple-500/10"
          : "border-gray-800 bg-gray-900 hover:border-gray-700 hover:bg-gray-800/50"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: catConfig.color + "22", color: catConfig.color }}
          >
            <Icon size={14} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{module.name}</p>
            <p className="text-xs text-gray-500">{module.category}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {module.testStatus === "passing" ? (
            <CheckCircle2 size={14} className="text-green-400" />
          ) : module.testStatus === "failing" ? (
            <XCircle size={14} className="text-red-400" />
          ) : (
            <AlertTriangle size={14} className="text-yellow-400" />
          )}
        </div>
      </div>
      {module.description && (
        <p className="text-xs text-gray-500 mt-2 line-clamp-2 leading-relaxed">{module.description}</p>
      )}
      <div className="flex items-center gap-3 mt-2">
        {module.testCount && (
          <span className="text-xs text-gray-600">{module.testCount} tests</span>
        )}
        {module.linesOfCode && (
          <span className="text-xs text-gray-600">{module.linesOfCode} loc</span>
        )}
      </div>
    </motion.div>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────────
export default function ModuleBrowser() {
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "passing" | "failing">("all");
  const [selectedModule, setSelectedModule] = useState<ModuleInfo | null>(null);

  const fetchModules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/modules", { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json() as { modules: ModuleInfo[] };
        setModules(data.modules);
      } else throw new Error("API unavailable");
    } catch {
      setModules(generateMockModules());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchModules(); }, [fetchModules]);

  const filtered = useMemo(() => {
    return modules.filter(m => {
      const matchSearch = !search || m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.description?.toLowerCase().includes(search.toLowerCase());
      const matchCat = categoryFilter === "all" || m.category === categoryFilter;
      const matchStatus = statusFilter === "all" || m.testStatus === statusFilter;
      return matchSearch && matchCat && matchStatus;
    });
  }, [modules, search, categoryFilter, statusFilter]);

  const stats = useMemo(() => ({
    total: modules.length,
    passing: modules.filter(m => m.testStatus === "passing").length,
    failing: modules.filter(m => m.testStatus === "failing").length,
  }), [modules]);

  const categories = useMemo(() => {
    const cats = new Set(modules.map(m => m.category));
    return ["all", ...Array.from(cats).sort()];
  }, [modules]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Package className="text-green-400" size={22} />
            <h1 className="text-lg font-bold text-white">Module Browser</h1>
          </div>
          <button
            onClick={fetchModules}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-1.5 text-sm">
            <Package size={14} className="text-gray-500" />
            <span className="text-gray-400">{stats.total} modules</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <CheckCircle2 size={14} className="text-green-400" />
            <span className="text-green-400">{stats.passing} passing</span>
          </div>
          {stats.failing > 0 && (
            <div className="flex items-center gap-1.5 text-sm">
              <XCircle size={14} className="text-red-400" />
              <span className="text-red-400">{stats.failing} failing</span>
            </div>
          )}
        </div>

        {/* Search + Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-2.5 top-2.5 text-gray-500" />
            <input
              type="text"
              placeholder="Search modules…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-green-500"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-green-500"
          >
            {categories.map(c => (
              <option key={c} value={c}>{c === "all" ? "All Categories" : c}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as "all" | "passing" | "failing")}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-green-500"
          >
            <option value="all">All Status</option>
            <option value="passing">Passing</option>
            <option value="failing">Failing</option>
          </select>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Module Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-gray-500">
              <RefreshCw size={18} className="animate-spin mr-2" />
              Loading modules…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-500">
              No modules match your filters.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <AnimatePresence>
                {filtered.map(m => (
                  <ModuleCard
                    key={m.name}
                    module={m}
                    onClick={() => setSelectedModule(m === selectedModule ? null : m)}
                    isSelected={selectedModule?.name === m.name}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <AnimatePresence>
          {selectedModule && (
            <motion.div
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 20, opacity: 0 }}
              className="w-72 border-l border-gray-800 p-5 flex flex-col gap-4 overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-white">Module Details</h3>
                <button onClick={() => setSelectedModule(null)} className="text-gray-500 hover:text-white">
                  <X size={14} />
                </button>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-lg font-bold text-white">{selectedModule.name}</p>
                  {selectedModule.testStatus === "passing" ? (
                    <CheckCircle2 size={16} className="text-green-400" />
                  ) : (
                    <XCircle size={16} className="text-red-400" />
                  )}
                </div>
                <p className="text-xs text-gray-500">{selectedModule.category} · v{selectedModule.version}</p>
              </div>

              {selectedModule.description && (
                <p className="text-sm text-gray-400 leading-relaxed">{selectedModule.description}</p>
              )}

              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Tests", value: selectedModule.testCount ?? "—" },
                  { label: "Lines", value: selectedModule.linesOfCode ?? "—" },
                  { label: "Exports", value: selectedModule.exportCount ?? "—" },
                  { label: "Added v", value: selectedModule.addedInVersion ?? "—" },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-800 rounded-lg p-3">
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className="text-sm font-medium text-white">{value}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${selectedModule.hasLogger ? "bg-green-400" : "bg-yellow-400"}`} />
                <span className="text-xs text-gray-400">
                  {selectedModule.hasLogger ? "Structured logging enabled" : "Using console.log"}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
