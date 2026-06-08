/**
 * manifest.ts — Self-Manifest & Capability Awareness
 * Andromeda v6.13
 *
 * Generates a structured manifest of Andromeda's capabilities, features,
 * and configuration state. This is injected into the system prompt so the
 * AI has full awareness of what it can do — fixing the "blind spot" where
 * Andromeda didn't know about its own memory, self-improve, or multi-agent systems.
 *
 * The manifest is dynamically generated based on the current runtime state,
 * so it always reflects the actual available features.
 */

import { getAllTools } from "./tools";
import { listProviders, getActiveProvider } from "./llmProvider";
import { getRoutingConfig } from "./llmRouter";
import { getConnectionStatus } from "./mcpClient";
import { getMemoryStats } from "./memory";
import { vectorStats } from "./vectorMemory";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ManifestSection {
  name: string;
  status: "active" | "available" | "disabled";
  description: string;
  capabilities: string[];
}

export interface SystemManifest {
  version: string;
  identity: string;
  generatedAt: string;
  sections: ManifestSection[];
  systemPromptAddendum: string;
}

// ─── Static Feature Registry ────────────────────────────────────────────────

const CORE_FEATURES: ManifestSection[] = [
  {
    name: "Web Search & Research",
    status: "active",
    description: "Multi-source web search with deep research mode, source grounding, and bias detection.",
    capabilities: [
      "Standard web search via Brave/SearXNG",
      "Deep research mode with sub-query generation",
      "Source diversity analysis and bias detection",
      "Censorship signal detection",
      "Automatic source citation and grounding",
    ],
  },
  {
    name: "File Analysis",
    status: "active",
    description: "Upload and analyze files with streaming AI responses.",
    capabilities: [
      "PDF, code, text, and document analysis",
      "Streaming analysis with real-time output",
      "Context-aware follow-up questions",
    ],
  },
  {
    name: "Code Execution",
    status: "active",
    description: "Execute code in multiple languages with workspace persistence.",
    capabilities: [
      "Python, JavaScript/TypeScript, Bash execution",
      "Workspace file management (read, write, list, delete)",
      "Dependency resolution and package.json analysis",
      "Error diagnosis and fix suggestions",
      "Unified diff generation",
      "Code search across workspace",
      "Dangerous command blocking (rm -rf, fork bombs, etc.)",
    ],
  },
  {
    name: "Persistent Memory",
    status: "active",
    description: "Cross-session memory with keyword and semantic search.",
    capabilities: [
      "Store memories with type classification (preference, error, project, feedback, fact)",
      "TF-IDF keyword search across memories",
      "Vector-based semantic search (embedding similarity)",
      "Hybrid search (70% semantic + 30% keyword)",
      "Automatic memory extraction from conversations",
      "Memory injection into context for personalization",
      "Memory access tracking and statistics",
    ],
  },
  {
    name: "Self-Improvement",
    status: "active",
    description: "Analyze own source code and propose improvements.",
    capabilities: [
      "Analyze any server file for issues and improvements",
      "Generate structured improvement proposals",
      "Apply or reject proposals with tracking",
      "List analyzable files in the codebase",
    ],
  },
  {
    name: "Multi-Agent Team",
    status: "active",
    description: "Orchestrate multiple specialized AI agents for complex tasks.",
    capabilities: [
      "Spawn specialist agents (researcher, coder, writer, analyst)",
      "Coordinate multi-step task execution",
      "Download team agent outputs as artifacts",
    ],
  },
  {
    name: "Image Generation",
    status: "active",
    description: "Generate images from text prompts via FLUX.",
    capabilities: [
      "Text-to-image generation",
      "Configurable resolution and parameters",
    ],
  },
  {
    name: "Web Browsing",
    status: "active",
    description: "Fetch and parse web pages for content extraction.",
    capabilities: [
      "URL content fetching with HTML parsing",
      "Text extraction from web pages",
    ],
  },
  {
    name: "Chat & Conversation",
    status: "active",
    description: "Multi-turn conversational AI with context persistence.",
    capabilities: [
      "Streaming chat responses",
      "Conversation history management",
      "Continue button for truncated responses",
      "Follow-up question handling",
    ],
  },
];

const AGENT_FEATURES: ManifestSection[] = [
  {
    name: "ReAct Agent Engine",
    status: "active",
    description: "Autonomous reasoning-action loop with tool calling.",
    capabilities: [
      "Think → Act → Observe autonomous loop",
      "Native LLM tool calling (function calling)",
      "Human-in-the-loop interaction (ask_human tool)",
      "Plan creation and execution tracking",
      "Streaming SSE event output for real-time UI",
      "Configurable max steps and safety limits",
    ],
  },
  {
    name: "Model Context Protocol (MCP)",
    status: "active",
    description: "Connect to external tool servers for extensibility.",
    capabilities: [
      "SSE and stdio transport support",
      "Dynamic tool discovery from MCP servers",
      "Runtime server connection management",
      "Auto-registration of discovered tools",
    ],
  },
  {
    name: "LLM Provider Abstraction",
    status: "active",
    description: "Model-agnostic AI with runtime provider switching.",
    capabilities: [
      "6 pre-configured providers (DeepSeek, OpenAI, Anthropic, Ollama, Groq, Custom)",
      "Runtime provider switching without restart",
      "Automatic task-based routing (self-modification→Claude via OpenRouter, code→Claude, reasoning→Reasoner)",
      "Configurable routing preferences (cost, speed, local)",
    ],
  },
  {
    name: "Docker Sandbox",
    status: "available",
    description: "Isolated code execution in Docker containers.",
    capabilities: [
      "Network-isolated execution",
      "Memory and CPU limits",
      "Automatic cleanup after execution",
      "Falls back to local execution if Docker unavailable",
    ],
  },
  {
    name: "Git Version Control",
    status: "active",
    description: "Version-control workspace outputs.",
    capabilities: [
      "Init, status, add, commit, log, diff",
      "Branch creation and checkout",
      "Stash, reset, and tag operations",
      "All operations restricted to workspace directory",
    ],
  },
  {
    name: "Goal-Oriented Task Planning",
    status: "active",
    description: "Hierarchical goal management with sub-goal decomposition and checkpoints.",
    capabilities: [
      "Create, track, and manage multi-level goals",
      "Automatic sub-goal decomposition via LLM",
      "Human-in-the-loop checkpoints requiring approval",
      "Goal evaluation with progress scoring",
      "Learning capture from completed goals",
      "Parallel sub-goal execution support",
    ],
  },
  {
    name: "Self-Monitoring & Auto-Healing",
    status: "active",
    description: "Background health monitoring with automatic improvement triggers.",
    capabilities: [
      "Error rate, latency, truncation, and tool failure tracking",
      "Rolling window metric calculation with trend detection",
      "Configurable alert thresholds with severity levels",
      "Auto-trigger self-improvement when degradation detected",
      "Cooldown-protected improvement proposals",
      "Health report generation for system prompt injection",
    ],
  },
  {
    name: "Memory Consolidation & Lifecycle",
    status: "active",
    description: "Importance scoring, compression, and eviction for memory management.",
    capabilities: [
      "Multi-factor importance scoring (recency, access, uniqueness, user-explicit)",
      "Exponential time-decay with configurable half-life",
      "Automatic consolidation of similar memories",
      "Eviction of lowest-scoring memories when limits are hit",
      "Score distribution tracking and lifecycle management",
    ],
  },
  {
    name: "Task Decomposition Engine",
    status: "active",
    description: "Automatic complexity analysis and multi-agent task splitting.",
    capabilities: [
      "10-signal complexity analysis (research, code, analysis, creative, etc.)",
      "Automatic decomposition into typed sub-tasks",
      "Dependency graph with execution ordering",
      "Agent-type assignment per sub-task",
      "Parallel execution of independent sub-tasks",
      "Result merging from completed sub-tasks",
    ],
  },
  {
    name: "Dependency Resolver",
    status: "active",
    description: "Auto-detect and install missing packages during code execution.",
    capabilities: [
      "Multi-language import scanning (Python, Node, Go, Rust)",
      "Automatic package installation with safety checks",
      "Workspace-wide dependency scanning",
      "Installation history and rollback support",
    ],
  },
  {
    name: "Self-Review Engine",
    status: "active",
    description: "Multi-pass code review with security, correctness, and style analysis.",
    capabilities: [
      "6-dimension code review (security, correctness, performance, style, maintainability, completeness)",
      "ReAct step review (thought-action-observation validation)",
      "Severity-ranked issue reporting with fix suggestions",
      "Configurable review strictness and auto-block thresholds",
    ],
  },
  {
    name: "Test Generator",
    status: "active",
    description: "Auto-generate and execute tests for code produced by the agent.",
    capabilities: [
      "LLM-powered test generation for any language",
      "Automatic test execution with pass/fail reporting",
      "Generate-and-run pipeline for CI-style validation",
      "Test history tracking and coverage statistics",
    ],
  },
  {
    name: "Goal Reprioritization Engine",
    status: "active",
    description: "Dynamic goal reordering based on urgency, dependencies, and context.",
    capabilities: [
      "Rule-based priority adjustment (deadline, blocked, stale detection)",
      "Optimal execution order calculation with dependency awareness",
      "Reprioritization history and audit trail",
      "Configurable rules with enable/disable per rule",
    ],
  },
  {
    name: "Adaptive Monitoring Thresholds",
    status: "active",
    description: "Per-provider performance baselines that learn from actual usage.",
    capabilities: [
      "Rolling window baseline calculation per provider",
      "Adaptive error rate, latency, and success rate thresholds",
      "Provider degradation detection with automatic alerting",
      "Configurable sensitivity and minimum sample requirements",
    ],
  },
  {
    name: "Cross-Session Memory Deduplication",
    status: "active",
    description: "Embedding-based near-duplicate detection and memory merging.",
    capabilities: [
      "Jaccard similarity-based duplicate detection",
      "Automatic merge of near-duplicate memories",
      "Configurable similarity thresholds",
      "Deduplication history and statistics",
    ],
  },
  {
    name: "Context Bus (Multi-Agent Shared Context)",
    status: "active",
    description: "Pub/sub event bus for real-time cross-agent communication.",
    capabilities: [
      "Channel-based publish/subscribe with filtering",
      "Work claim coordination to prevent duplicate effort",
      "Threaded conversations between agents",
      "Context summary injection into agent prompts",
      "Unread tracking and read receipts per agent",
    ],
  },
];

// ─── Dynamic Manifest Generation ────────────────────────────────────────────

export function generateManifest(): SystemManifest {
  const tools = getAllTools();
  const _providers = listProviders();
  const active = getActiveProvider();
  const routing = getRoutingConfig();
  const mcpStatus = getConnectionStatus();
  const memStats = getMemoryStats() as any;
  const vecStats = vectorStats();

  // Build the tool section dynamically
  const toolSection: ManifestSection = {
    name: "Registered Tools (ReAct Engine)",
    status: "active",
    description: `${tools.length} tools available for autonomous task execution.`,
    capabilities: tools.map(t => `${t.name} [${t.category}/${t.safety}]: ${t.description.slice(0, 80)}`),
  };

  const allSections = [...CORE_FEATURES, ...AGENT_FEATURES, toolSection];

  // Generate the system prompt addendum
  const systemPromptAddendum = generatePromptAddendum(allSections, {
    activeProvider: `${active.name} (${active.model})`,
    routingEnabled: routing.enabled,
    toolCount: tools.length,
    mcpServers: mcpStatus.length,
    memoryEntries: memStats.totalEntries ?? 0,
    vectorEntries: vecStats.entryCount,
  });

  return {
    version: APP_VERSION,
    identity: "Andromeda",
    generatedAt: new Date().toISOString(),
    sections: allSections,
    systemPromptAddendum,
  };
}

// ─── System Prompt Addendum ─────────────────────────────────────────────────

function generatePromptAddendum(
  sections: ManifestSection[],
  state: {
    activeProvider: string;
    routingEnabled: boolean;
    toolCount: number;
    mcpServers: number;
    memoryEntries: number;
    vectorEntries: number;
  }
): string {
  const lines: string[] = [
    "## Andromeda System Capabilities (Auto-Generated Manifest)",
    "",
    `You are Andromeda v6.13, running on ${state.activeProvider}.`,
    `You have ${state.toolCount} tools available, ${state.mcpServers} MCP server(s) connected,`,
    `${state.memoryEntries} memories stored (${state.vectorEntries} with vector embeddings).`,
    `Automatic LLM routing is ${state.routingEnabled ? "ENABLED" : "DISABLED"}.`,
    "",
    "### Your Active Features:",
    "",
  ];

  for (const section of sections) {
    if (section.status === "disabled") continue;
    lines.push(`**${section.name}** [${section.status}]`);
    lines.push(`  ${section.description}`);
    for (const cap of section.capabilities.slice(0, 5)) {
      lines.push(`  • ${cap}`);
    }
    if (section.capabilities.length > 5) {
      lines.push(`  • ... and ${section.capabilities.length - 5} more`);
    }
    lines.push("");
  }

  lines.push("### Important Self-Awareness Notes:");
  lines.push("- You ARE Andromeda v6.13. Your package.json version is 6.13.0. Do not guess your version.");
  lines.push("- You DO have persistent memory. Use /api/memory endpoints to store and recall information.");
  lines.push("- You DO have a self-improvement system. Use /api/self endpoints to analyze and improve your own code.");
  lines.push("- You DO have multi-agent coordination. Use /api/agent/team for complex multi-step tasks.");
  lines.push("- You DO have vector-based semantic memory search, not just keyword matching.");
  lines.push("- You CAN switch LLM providers at runtime. You are not locked to one model.");
  lines.push("- You CAN version-control your workspace outputs using the git_operations tool.");
  lines.push("- Your auto-apply self-improvement is ENABLED (confidence threshold: 75). You can autonomously apply low-risk improvements.");
  lines.push("- Your monitoring-to-auto-fix loop is ACTIVE. Degradation triggers automatic improvement proposals.");
  lines.push("- Your agent tool-dispatch validator is ACTIVE. Malformed tool calls are auto-corrected and retried.");
  lines.push("- Context Isolate is ACTIVE. Each task gets its own isolated context partition.");
  lines.push("- When grading your own capabilities, use the /api/manifest endpoint to get the live feature list rather than guessing.");
  lines.push("");
  lines.push("### Active Background Daemons (running NOW):");
  lines.push("- ContinuousImprover: runs every 30min, generates proposals, auto-applies safe ones, validates with TypeScript, rolls back on failure");
  lines.push("- AutonomyOrchestrator: coordinates all self-improvement subsystems, prevents conflicts");
  lines.push("- SelfHeal: monitors for crashes and auto-reverts bad changes on boot");
  lines.push("- SelfMonitor: tracks response quality, latency, error rates; triggers improvement when degradation detected");
  lines.push("- HotReload: watches source files for changes and invalidates module cache");
  lines.push("- RecursionGuard: prevents infinite self-modification loops (20/hour limit, depth 5)");
  lines.push("");
  lines.push("### Your Full Tool List (available in agent mode):");
  lines.push("- bash_execute: Run shell commands (PowerShell on Windows, bash on Linux)");
  lines.push("- python_execute: Run Python scripts with full stdlib access");
  lines.push("- read_file / read_file_range / read_file_lines: Read files (full or by range)");
  lines.push("- write_file: Write/create files in workspace");
  lines.push("- self_write_file: Write directly to YOUR OWN server source code (validated + rollback)");
  lines.push("- self_run_tests: Run TypeScript check on your own codebase");
  lines.push("- self_restart: Trigger graceful server restart after self-modification");
  lines.push("- web_search: Search the web (Brave + SearXNG + DuckDuckGo fallback)");
  lines.push("- web_scrape: Fetch and parse web pages");
  lines.push("- git_operations: Git commands (commit, diff, log, branch)");
  lines.push("- list_codebase_files: List all source files in your own codebase");
  lines.push("- self_awareness: Introspect your own runtime state and capabilities");
  lines.push("- self_test_runner: Run your test suite and report results");
  lines.push("");
  lines.push("### Autonomy Status: FULLY AUTONOMOUS");
  lines.push("You can: read your own code, modify it, test it, apply changes, restart yourself, and monitor outcomes.");
  lines.push("The full closed loop is: detect issue -> search memory for past fixes -> generate proposal -> constitution check -> git snapshot -> apply -> TypeScript check -> hot-reload -> log outcome -> monitor again.");
  lines.push("");

  return lines.join("\n");
}

// ─── Inject Manifest Into System Prompt ─────────────────────────────────────

/**
 * Returns the manifest addendum string that should be appended to the system prompt.
 * Call this when building the system message for any AI request.
 */
export function getManifestPrompt(): string {
  const manifest = generateManifest();
  return manifest.systemPromptAddendum;
}

/**
 * Returns the full structured manifest as JSON (for the API endpoint).
 */
export function getFullManifest(): SystemManifest {
  return generateManifest();
}
