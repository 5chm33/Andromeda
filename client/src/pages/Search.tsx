import { useAuth } from "@/_core/hooks/useAuth";
import React from "react";
import { ThemeCanvas } from "@/components/ThemeCanvas";
import { SkinSelector } from "@/components/SkinSelector";
import { getSavedSkin } from "@/lib/themeEngine";
import type { SkinId } from "@/lib/themeEngine";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { Streamdown } from "streamdown";
import {
  Search as SearchIcon,
  Sparkles,
  Copy,
  Share2,
  Download,
  ExternalLink,
  Shield,
  ShieldCheck,
  Loader2,
  History,
  LogIn,
  RefreshCw,
  ChevronRight,
  FlaskConical,
  Paperclip,
  X,
  FileText,
  FileCode,
  Image as ImageIcon,
  CheckCircle2,
  Circle,
  Zap,
  Wrench,
  FileEdit,
  MessageSquare,
  ChevronDown,
  CornerDownRight,
  SendHorizonal,
  Bot,
  Globe,
  Code2,
  FileSearch,
  ListChecks,
  FolderOpen,
  FileX,
  ShieldCheck as ShieldCheckIcon,
  AlertTriangle,
  Clock, Target, Activity, Database, GitBranch,
  Users,
  Lock,
  Calendar,
  Play,
  Pause,
  Key,
  Radio,
  Eye,
  ChevronLeft,
  Plus,
  Hash,
  Menu,
  PanelLeft,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import JSZip from "jszip";
import { getRawZip } from "@/lib/zipStore";
import type { SearchSource } from "../../../drizzle/schema";
// v5.30: Decomposed sub-components
import {
  SourceCard,
  CredibilityBadge,
  DeepResearchTracker,
  AgentPlanTracker,
  FileAttachmentPreview,
  ImageGenPanel,
  CodeExecutorPanel,
  EditFilePanel,
  PanelErrorBoundary,
} from "@/components/search";
import type { DeepResearchProgress, AgentStep, AgentStepResult, AttachedFile } from "@/components/search";

type FilterType = "all" | "web" | "academic";
type SearchMode = "standard" | "deep";

interface ThreadTurn {
  query: string;
  answer: string;
  sources: SearchSource[];
  filter: FilterType;
  expanded: boolean;
}

// ─── Main Search Page ─────────────────────────────────────────────────────────
export default function Search() {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);
  const initialQuery = params.get("q") || "";

  const initialMode = (params.get("mode") as SearchMode) || "standard";
  const initialFileMode = params.get("fileMode") === "1";
  // v6.15: Model is now provider-agnostic — "deepseek-chat" is just the default label
  // The server resolves the actual model via LLM_MODEL env var (e.g. openrouter → Claude)
  const initialModel = (params.get("model") as string) ||
    (localStorage.getItem("andromeda_model") as string) || "deepseek-chat";
  const initialPanel = params.get("panel") || "";
  const initialImageGen = params.get("imageGen") === "1" || initialPanel === "image";
  const initialDeepMode = params.get("deep") === "1";

  const [inputValue, setInputValue] = useState("");  // v5.55: start empty so user can type next question immediately
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<FilterType>("all");
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [sources, setSources] = useState<SearchSource[]>([]);
  const [aiAnswer, setAiAnswer] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [continueMessages, setContinueMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [deepProgress, setDeepProgress] = useState<DeepResearchProgress[]>([]);
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(() => {
    if (initialFileMode) {
      try {
        const stored = sessionStorage.getItem("andromeda_attached_file");
        if (stored) { sessionStorage.removeItem("andromeda_attached_file"); return JSON.parse(stored); }
      } catch { /* ignore */ }
    }
    return null;
  });
  const [extraFiles, setExtraFiles] = useState<AttachedFile[]>(() => {
    if (initialFileMode) {
      try {
        const stored = sessionStorage.getItem("andromeda_extra_files");
        if (stored) { sessionStorage.removeItem("andromeda_extra_files"); return JSON.parse(stored); }
      } catch { /* ignore */ }
    }
    return [];
  });
  const [isFileMode, setIsFileMode] = useState(initialFileMode);
  const [model, setModel] = useState<string>(initialModel);  // v6.15: provider-agnostic
  // v5.49: Manus-style model tier selector (Auto / Fast / Coding / Max)
  // v5.99: Default changed from "auto" (DeepSeek V3) to "coding" (Kimi k2.6).
  // DeepSeek V3 cannot reliably call tools — it hallucinates XML instead of using real tool calls.
  // Kimi k2.6 is the best-in-class coding model and handles self-modification correctly.
  const [modelTier, setModelTierState] = useState<"auto" | "fast" | "coding" | "max">(() => {
    return (localStorage.getItem("andromeda_tier") as "auto" | "fast" | "coding" | "max") || "coding";
  });
  const [showCodeExecutor, setShowCodeExecutor] = useState(false);
  const [showImageGen, setShowImageGen] = useState(initialImageGen);
  // v5.10: Sandbox ZIP editing state (replaces EditFilePanel)
  const [zipEditResult, setZipEditResult] = useState<{ editedZip: string; summary: string; editsApplied: number; log: string[]; fileName: string } | null>(null);
  const [isZipEditing, setIsZipEditing] = useState(false);

  // v5.10: Claude Code-inspired Plan Mode
  const [isPlanMode, setIsPlanMode] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<{ title: string; steps: Array<{ id: number; action: string; description: string; risk: string; reversible: boolean }>; estimatedDuration: string; warnings: string[]; goalQuery: string } | null>(null);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);

  // v5.10: /compact context compression
  const [isCompacting, setIsCompacting] = useState(false);

  // Background skin (shared with Home)
  const [currentSkin, setCurrentSkin] = useState<SkinId>(() => getSavedSkin());

  // ─── Agent Mode state ─────────────────────────────────────────────────────
  const [isAgentMode, setIsAgentMode] = useState(initialPanel === "agent");
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [agentCurrentStep, setAgentCurrentStep] = useState(-1);
  const [agentResults, setAgentResults] = useState<AgentStepResult[]>([]);
  const [isAgentRunning, setIsAgentRunning] = useState(false);

  // ─── v4.8: Grounding & confidence state ────────────────────────────────────
  const [groundingConfidence, setGroundingConfidence] = useState<number | null>(null);
  const [groundingWarnings, setGroundingWarnings] = useState<string[]>([]);
  const [unverifiedCount, setUnverifiedCount] = useState(0);

  // ─── v4.8: Workspace panel state ────────────────────────────────────────────
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState<Array<{ name: string; size: number; modifiedAt: string; isDirectory: boolean }>>([]);
  const [workspaceViewFile, setWorkspaceViewFile] = useState<{ name: string; content: string } | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);

  // ─── v4.8: Error explainer state ────────────────────────────────────────────
  const [errorDiagnosis, setErrorDiagnosis] = useState<any>(null);

  // ─── v5.1: Team Agent state ──────────────────────────────────────────────────
  const [showTeamAgent, setShowTeamAgent] = useState(initialPanel === "team");
  const [teamTask, setTeamTask] = useState("");
  const [isTeamRunning, setIsTeamRunning] = useState(false);
  const [teamAgents, setTeamAgents] = useState<Array<{ role: string; name: string; emoji: string; status: string; output?: string; artifacts?: any[]; issues?: any[] }>>([]);
  const [teamSummary, setTeamSummary] = useState<any>(null);

  // ─── v5.1: Memory state ───────────────────────────────────────────────────────
  const [showMemory, setShowMemory] = useState(initialPanel === "memory");
  const [memoryEntries, setMemoryEntries] = useState<any[]>([]);
  const [memoryStats, setMemoryStats] = useState<any>(null);
  const [isLoadingMemory, setIsLoadingMemory] = useState(false);
  const [newMemoryContent, setNewMemoryContent] = useState("");
  const [newMemoryType, setNewMemoryType] = useState("fact");

  // ─── v5.1: Self-Improve state ─────────────────────────────────────────────────
  const [showSelfImprove, setShowSelfImprove] = useState(initialPanel === "improve");
  const [selfImproveFiles, setSelfImproveFiles] = useState<string[]>([]);
  const [selectedSelfFile, setSelectedSelfFile] = useState("");
  const [selfImproveArea, setSelfImproveArea] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selfProposals, setSelfProposals] = useState<any[]>([]);
  const [activeProposal, setActiveProposal] = useState<any>(null);

  // ─── v5.5: ReAct Agent state ──────────────────────────────────────────────
  const [showSidebar, setShowSidebar] = useState(false);
  const [sidebarCategory, setSidebarCategory] = useState<"agent" | "tools" | "memory" | "system" | null>(null);
  const [showReactAgent, setShowReactAgent] = useState(false);
  const [reactEvents, setReactEvents] = useState<Array<{ type: string; step?: number; content?: string; toolName?: string; toolArgs?: any; toolResult?: any; plan?: any[]; error?: string; summary?: string; totalSteps?: number; tokenUsage?: any; filesModified?: string[]; workingDir?: string }>>([]);
  const [isReactRunning, setIsReactRunning] = useState(false);
  const [reactInput, setReactInput] = useState("");
  const [reactSessionId, setReactSessionId] = useState<string | null>(null);
  const [reactHumanQuestion, setReactHumanQuestion] = useState<string | null>(null);
  const [reactHumanAnswer, setReactHumanAnswer] = useState("");

  // ─── v5.5: LLM Provider state ─────────────────────────────────────────────
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [llmProviders, setLlmProviders] = useState<any[]>([]);
  const [activeProvider, setActiveProviderState] = useState<any>(null);

  // ─── v5.5: MCP state ──────────────────────────────────────────────────────
  const [showMcpPanel, setShowMcpPanel] = useState(false);
  const [mcpServers, setMcpServers] = useState<any[]>([]);
  const [mcpConnections, setMcpConnections] = useState<any[]>([]);

  // ─── v5.5: Tool Registry state ────────────────────────────────────────────
  const [showToolsPanel, setShowToolsPanel] = useState(false);
  const [registeredTools, setRegisteredTools] = useState<Array<{ name: string; description: string; category: string; safety: string }>>([]);

  // ─── v5.5 Tier 2: Scheduler state ─────────────────────────────────────────
  const [showSchedulerPanel, setShowSchedulerPanel] = useState(false);
  const [schedulerTasks, setSchedulerTasks] = useState<any[]>([]);
  const [schedulerStats, setSchedulerStats] = useState<any>(null);

  // ─── v5.5 Tier 2: Orchestrator state ──────────────────────────────────────
  const [showOrchestratorPanel, setShowOrchestratorPanel] = useState(false);
  const [orchestratorEvents, setOrchestratorEvents] = useState<any[]>([]);
  const [orchestratorRunning, setOrchestratorRunning] = useState(false);
  const [orchestratorTask, setOrchestratorTask] = useState("");

  // ─── v5.5 Tier 2: Self-Improve Guard state ────────────────────────────────
  const [showGuardPanel, setShowGuardPanel] = useState(false);
  const [guardConfig, setGuardConfigState] = useState<any>(null);
  const [guardBackups, setGuardBackups] = useState<any[]>([]);
  const [guardAudit, setGuardAuditState] = useState<any[]>([]);

  // ─── v5.5 Tier 3: Security state ──────────────────────────────────────────
  const [showSecurityPanel, setShowSecurityPanel] = useState(false);
  const [securityKeys, setSecurityKeys] = useState<any[]>([]);
  const [securityConfig, setSecurityConfigState] = useState<any>(null);
  const [securityStats, setSecurityStatsState] = useState<any>(null);
  const [securityAudit, setSecurityAuditState] = useState<any[]>([]);

  // ─── v5.5 Autonomy ─────────────────────────────────────────────────────────
  const [showGoalPanel, setShowGoalPanel] = useState(false);
  const [goals, setGoals] = useState<any[]>([]);
  const [goalStats, setGoalStats] = useState<any>(null);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [showMonitorPanel, setShowMonitorPanel] = useState(false);
  const [healthReport, setHealthReport] = useState<any>(null);
  const [monitorAlerts, setMonitorAlerts] = useState<any[]>([]);
  const [showConsolidationPanel, setShowConsolidationPanel] = useState(false);
  const [consolidationStats, setConsolidationStats] = useState<any>(null);
  const [scoredMemories, setScoredMemories] = useState<any[]>([]);
  const [showDecomposerPanel, setShowDecomposerPanel] = useState(false);

  // v5.7: New panel states
  const [showDepsPanel, setShowDepsPanel] = useState(false);
  const [showReviewPanel, setShowReviewPanel] = useState(false);
  const [showTestPanel, setShowTestPanel] = useState(false);
  const [showBusPanel, setShowBusPanel] = useState(false);
  const [depsStats, setDepsStats] = useState<any>(null);
  const [reviewStats, setReviewStats] = useState<any>(null);
  const [testStats, setTestStats] = useState<any>(null);
  const [busStats, setBusStats] = useState<any>(null);
  const [busChannels, setBusChannels] = useState<any[]>([]);
  const [decomposerStats, setDecomposerStats] = useState<any>(null);
  const [testQuery, setTestQuery] = useState("");
  const [complexityResult, setComplexityResult] = useState<any>(null);

  // ─── v5.9: New UI state ─────────────────────────────────────────────────────
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelCategory, setRightPanelCategory] = useState<"agent" | "tools" | "memory" | "system" | null>(null);

  // ─── Conversation thread ───────────────────────────────────────────────────
  const [thread, setThread] = useState<ThreadTurn[]>([]);
  const [followUpInput, setFollowUpInput] = useState("");
  const [enginePhase, setEnginePhase] = useState<{ phase: string; message: string; details?: any } | null>(null);
  const followUpInputRef = useRef<HTMLTextAreaElement>(null);
  const threadBottomRef = useRef<HTMLDivElement>(null);

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const bottomInputRef = useRef<HTMLTextAreaElement>(null);

  const saveToHistory = trpc.search.saveToHistory.useMutation({
    onSuccess: () => historyQuery.refetch(),
  });
  const followUpQuery = trpc.search.followUpSuggestions.useQuery(
    { query },
    { enabled: !!query && aiAnswer.length > 100 && !isStreaming, staleTime: 60000 }
  );

  // v5.10: History for sidebar — no auth required, uses sessionId fallback
  const [sessionId] = useState(() => {
    let sid = localStorage.getItem("andromeda_session_id");
    if (!sid) { sid = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`; localStorage.setItem("andromeda_session_id", sid); }
    return sid;
  });
  const historyQuery = trpc.history.list.useQuery(
    { limit: 30, sessionId },
    { staleTime: 30000 }
  );

  useEffect(() => {
    if (followUpQuery.data?.suggestions) setFollowUps(followUpQuery.data.suggestions);
  }, [followUpQuery.data]);

  // ─── File handling ────────────────────────────────────────────────────────
  const processFile = useCallback(async (file: File) => {
    const mimeType = file.type || "application/octet-stream";
    const isImage = mimeType.startsWith("image/");
    const isZip = mimeType === "application/zip" || mimeType === "application/x-zip-compressed" || file.name.toLowerCase().endsWith(".zip");

    if (isZip) {
      toast.loading(`Reading ZIP: ${file.name}…`, { id: "zip-load" });
      try {
        // v5.18: Read as ArrayBuffer first for maximum browser compatibility
        // Retry up to 3 times with exponential backoff (handles transient failures)
        // The raw base64 ZIP is sent to the server-side multi-pass engine which handles
        // extraction, compression, and analysis at full resolution — zero data loss.
        let zipArrayBuf: ArrayBuffer | null = null;
        let zip: JSZip | null = null;
        let lastZipErr: any;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (attempt > 0) await new Promise(r => setTimeout(r, 200 * attempt));
            zipArrayBuf = await file.arrayBuffer();
            zip = await JSZip.loadAsync(zipArrayBuf);
            break;
          } catch (e) {
            lastZipErr = e;
          }
        }
        if (!zip || !zipArrayBuf) throw lastZipErr;
        const entries: string[] = [];
        let fileCount = 0;
        let textFileCount = 0;
        zip.forEach((relativePath, zipEntry) => {
          fileCount++;
          entries.push(relativePath);
          if (!zipEntry.dir) {
            const lower = relativePath.toLowerCase();
            const isText = /\.(ts|tsx|js|jsx|py|json|yaml|yml|md|txt|csv|html|css|sh|sql|xml|env|toml|ini|cfg|conf|log|gitignore|prettierrc|eslintrc)$/.test(lower);
            const skip = /node_modules|dist\/|pnpm-lock|package-lock|\.min\.|snapshot\.json|\.gitkeep/.test(lower);
            if (isText && !skip) textFileCount++;
          }
        });

        // Lightweight summary for UI display only — NOT used for analysis
        const summary = `ZIP Archive: ${file.name}\nTotal files: ${fileCount} (${textFileCount} text files — ALL included, no truncation)\n\nFile tree:\n${entries.slice(0, 200).join("\n")}${entries.length > 200 ? `\n... and ${entries.length - 200} more files` : ""}\n\n[Full analysis handled server-side by multi-pass engine — no file size limits]`;

        // v5.34: Convert to base64 for server-side processing
        // Fixed: String.fromCharCode.apply fails for chunks > ~8KB due to
        // Function.prototype.apply argument length limits. Use TextDecoder-free
        // approach with individual character conversion for safety.
        const rawBytes = new Uint8Array(zipArrayBuf!);
        const chunks: string[] = [];
        const CHUNK_SIZE = 4096; // Safe size well under call stack limits
        for (let i = 0; i < rawBytes.length; i += CHUNK_SIZE) {
          const end = Math.min(i + CHUNK_SIZE, rawBytes.length);
          let chunk = "";
          for (let j = i; j < end; j++) {
            chunk += String.fromCharCode(rawBytes[j]);
          }
          chunks.push(chunk);
        }
        const rawBase64 = btoa(chunks.join(""));

        setAttachedFile({ name: file.name, content: summary, mimeType: "application/zip", size: file.size, rawBase64 });
        setIsFileMode(true);
        toast.dismiss("zip-load");
        toast.success(`ZIP attached: ${file.name} (${fileCount} files, ${textFileCount} source files — no limits)`);
      } catch (err: any) {
        toast.dismiss("zip-load");
        console.error("[ZIP Load Error]", err);
        toast.error(`Could not read ZIP: ${file.name} — ${err?.message || "unknown error"}`);
      }
      return;
    }

    if (isImage) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setAttachedFile({ name: file.name, content: dataUrl, mimeType, size: file.size, preview: dataUrl });
        setIsFileMode(true);
        toast.success(`Image attached: ${file.name}`);
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setAttachedFile({ name: file.name, content, mimeType, size: file.size });
        setIsFileMode(true);
        toast.success(`File attached: ${file.name}`);
      };
      reader.readAsText(file);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // v5.37: Multi-file support — first file becomes primary, rest go to extraFiles
    processFile(files[0]);
    if (files.length > 1) {
      const extras: AttachedFile[] = [];
      const processExtra = async (f: File) => {
        const text = await f.text().catch(() => "");
        extras.push({ name: f.name, mimeType: f.type || "text/plain", content: text, size: f.size });
        if (extras.length === files.length - 1) setExtraFiles(prev => [...prev, ...extras]);
      };
      for (let i = 1; i < files.length; i++) processExtra(files[i]);
    }
    e.target.value = "";
  };

  // Drag and drop
  useEffect(() => {
    const zone = dropZoneRef.current;
    if (!zone) return;
    const onDragOver = (e: DragEvent) => { e.preventDefault(); zone.classList.add("drag-over"); };
    const onDragLeave = () => zone.classList.remove("drag-over");
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const file = e.dataTransfer?.files[0];
      if (file) processFile(file);
    };
    zone.addEventListener("dragover", onDragOver);
    zone.addEventListener("dragleave", onDragLeave);
    zone.addEventListener("drop", onDrop);
    return () => {
      zone.removeEventListener("dragover", onDragOver);
      zone.removeEventListener("dragleave", onDragLeave);
      zone.removeEventListener("drop", onDrop);
    };
  }, [processFile]);

  // v5.24: Smart paste detection — auto-routes pasted context to file attachment
  // Lowered threshold from 2000 to 500 chars to prevent cluttering the query box
  const LARGE_PASTE_THRESHOLD = 500; // chars
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Skip if user is typing in the image gen panel or other sub-components
      const target = e.target as HTMLElement;
      if (target.closest(".image-gen-panel")) return;

      const pastedText = e.clipboardData?.getData("text/plain") || "";
      if (pastedText.length > LARGE_PASTE_THRESHOLD) {
        e.preventDefault();
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const fileName = `pasted_context_${timestamp}.txt`;
        // v5.37: If primary file already attached, add paste as extra file
        if (attachedFile) {
          setExtraFiles(prev => [...prev, { name: fileName, mimeType: "text/plain", content: pastedText, size: pastedText.length }]);
          toast.success(`Additional context added (${(pastedText.length / 1024).toFixed(1)}KB) — ${extraFiles.length + 1} extra file(s)`, { duration: 4000 });
        } else {
          const blob = new Blob([pastedText], { type: "text/plain" });
          const virtualFile = new File([blob], fileName, { type: "text/plain" });
          processFile(virtualFile);
          toast.success(`Context attached (${(pastedText.length / 1024).toFixed(1)}KB) — type your question in the input box`, { duration: 4000 });
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [processFile]);

  // ─── Search execution ───────────────────────────────────────────────────────────────────────
  const runFileAnalysis = useCallback(async (message: string, file: AttachedFile) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    // v6.00: Preserve conversation history before clearing — save current answer to thread
    setThread(prev => {
      if (aiAnswer && query) {
        return [...prev, { query, answer: aiAnswer, sources, filter, expanded: false }];
      }
      return prev;
    });
    setAiAnswer("");
    setError(null);
    setSources([]);
    setIsStreaming(true);
    setIsLoadingSources(false);
    setIsTruncated(false);
    setContinueMessages([]);
    try {
      // v5.13: For ZIP files, send rawBase64 so the backend multi-pass engine
      // can extract files at full resolution (no frontend truncation)
      const isZipFile = file.mimeType === "application/zip" || file.mimeType === "application/x-zip-compressed" || file.name.toLowerCase().endsWith(".zip");
      const payload: Record<string, any> = {
        message,
        fileName: extraFiles.length > 0 ? `${file.name} (+${extraFiles.length} more)` : file.name,
        mimeType: file.mimeType,
        model,
      };
      // v5.19 fix: Check zipStore for rawBase64 when file.rawBase64 is undefined
      // (happens when navigating from Home page — rawBase64 is stripped from sessionStorage due to 5MB limit)
      const storeEntry = getRawZip();
      const resolvedRawBase64 = file.rawBase64 ?? (storeEntry?.fileName === file.name ? storeEntry.rawBase64 : undefined);
      if (isZipFile && resolvedRawBase64) {
        // Send raw base64 ZIP — backend fileEngine handles extraction + compression
        payload.fileContent = resolvedRawBase64;
        payload.isRawZip = true;
      } else {
        // Non-ZIP files: send text content as before
        payload.fileContent = extraFiles.length > 0
          ? file.content + extraFiles.map(f => `\n\n--- Additional file: ${f.name} ---\n${f.content}`).join("")
          : file.content;
      }
      const response = await fetch("/api/analyze/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: abortRef.current.signal,
      });
      if (!response.ok) throw new Error(`Analysis failed: ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let fullAnswer = "";
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.type === "delta") { fullAnswer += parsed.content; setAiAnswer(fullAnswer); }
            else if (parsed.type === "engine_phase") {
              setEnginePhase({ phase: parsed.phase, message: parsed.message });
            }
            else if (parsed.type === "index_built") {
              setEnginePhase({ phase: "indexed", message: `Indexed ${parsed.fileCount} files (${parsed.totalSize})`, details: parsed });
            }
            else if (parsed.type === "files_selected") {
              setEnginePhase({ phase: "selected", message: `Selected ${parsed.count} files for analysis`, details: parsed });
            }
            else if (parsed.type === "compression_applied") {
              setEnginePhase({ phase: "compressed", message: `Loaded ${parsed.filesLoaded} files (~${parsed.tokenEstimate} tokens)`, details: parsed });
            }
            else if (parsed.type === "truncated") {
              // v5.15: Auto-continue for file analysis too
              setIsTruncated(true);
              setContinueMessages([
                { role: "user", content: `${file.content}\n\n---\n\nUser request: ${message}` },
                { role: "assistant", content: fullAnswer },
              ]);
              setTimeout(() => {
                const continueBtn = document.querySelector('[data-auto-continue]') as HTMLButtonElement;
                if (continueBtn) continueBtn.click();
              }, 500);
            }
            else if (parsed.type === "done") {
              setIsStreaming(false);
              setEnginePhase(null);
              if (fullAnswer.trim()) {
                saveToHistory.mutate({
                  query: `[File: ${file.name}] ${message}`.slice(0, 500),
                  aiAnswer: fullAnswer,
                  sources: [],
                  filter: "all",
                  sessionId,
                });
              }
            }
            else if (parsed.type === "error") { setError(parsed.message); setIsStreaming(false); setEnginePhase(null); }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message || "Analysis failed");
        setIsStreaming(false);
      }
    }
  }, [saveToHistory, extraFiles, model]);

  const runDeepResearch = useCallback(async (q: string) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setSources([]);
    setAiAnswer("");
    setError(null);
    setFollowUps([]);
    setDeepProgress([]);
    setIsLoadingSources(true);
    setIsStreaming(false);
    try {
      const response = await fetch("/api/search/deep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.trim(), model }),
        signal: abortRef.current.signal,
      });
      if (!response.ok) throw new Error(`Deep research failed: ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let fullAnswer = "";
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.type === "progress") {
              setDeepProgress((prev) => [...prev, { step: parsed.step, message: parsed.message, queries: parsed.queries, sources: parsed.sources }]);
              if (parsed.sources) { setSources(parsed.sources); setIsLoadingSources(false); setIsStreaming(true); }
            } else if (parsed.type === "delta") {
              fullAnswer += parsed.content;
              setAiAnswer(fullAnswer);
            } else if (parsed.type === "done") {
              setIsStreaming(false);
              if (parsed.sources) setSources(parsed.sources);
              saveToHistory.mutate({ query: q.trim(), aiAnswer: fullAnswer, sources: parsed.sources, filter: "all", sessionId });
            } else if (parsed.type === "error") {
              setError(parsed.message);
              setIsStreaming(false);
              setIsLoadingSources(false);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message || "Deep research failed");
        setIsStreaming(false);
        setIsLoadingSources(false);
      }
    }
  }, [saveToHistory]);

  const runStandardSearch = useCallback(async (
    q: string,
    f: FilterType,
    priorContext?: Array<{ query: string; answer: string }>
  ) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setSources([]);
    setAiAnswer("");
    setError(null);
    setFollowUps([]);
    setDeepProgress([]);
    setIsLoadingSources(true);
    setIsStreaming(false);
    setIsTruncated(false);
    setContinueMessages([]);
    try {
      const response = await fetch("/api/search/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q.trim(),
          filter: f,
          model,
          ...(priorContext && priorContext.length > 0 ? { context: priorContext } : {}),
        }),
        signal: abortRef.current.signal,
      });
      if (!response.ok) throw new Error(`Search failed: ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let fullAnswer = "";
      let searchSources: SearchSource[] = [];
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.type === "sources") {
              searchSources = parsed.sources;
              setSources(parsed.sources);
              setIsLoadingSources(false);
              setIsStreaming(true);
              setGroundingConfidence(null);
              setGroundingWarnings([]);
              setUnverifiedCount(0);
            } else if (parsed.type === "delta") {
              fullAnswer += parsed.content;
              setAiAnswer(fullAnswer);
            } else if (parsed.type === "grounding") {
              setGroundingConfidence(parsed.confidence ?? null);
              setGroundingWarnings(parsed.warnings ?? []);
              setUnverifiedCount(parsed.unverifiedCount ?? 0);
            } else if (parsed.type === "truncated") {
              // v5.15: Auto-continue instead of showing manual button
              // Set messages for continuation, then auto-trigger after stream ends
              setIsTruncated(true);
              setContinueMessages([
                { role: "user", content: q.trim() },
                { role: "assistant", content: fullAnswer },
              ]);
              // Auto-trigger continuation after a brief delay
              setTimeout(() => {
                const continueBtn = document.querySelector('[data-auto-continue]') as HTMLButtonElement;
                if (continueBtn) continueBtn.click();
              }, 500);
            } else if (parsed.type === "done") {
              setIsStreaming(false);
              saveToHistory.mutate({ query: q.trim(), aiAnswer: fullAnswer, sources: searchSources as any, filter: f, sessionId });
            } else if (parsed.type === "error") {
              setError(parsed.message);
              setIsStreaming(false);
              setIsLoadingSources(false);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message || "Search failed");
        setIsStreaming(false);
        setIsLoadingSources(false);
      }
    }
  }, [saveToHistory, model]);

  const runAgentPlan = useCallback(async (q: string) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setAiAnswer("");
    setError(null);
    setSources([]);
    setFollowUps([]);
    setDeepProgress([]);
    setAgentSteps([]);
    setAgentResults([]);
    setAgentCurrentStep(-1);
    setIsAgentRunning(true);
    setIsLoadingSources(false);
    setIsStreaming(false);
    try {
      const response = await fetch("/api/agent/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.trim(), model }),
        signal: abortRef.current.signal,
      });
      if (!response.ok) throw new Error(`Agent plan failed: ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let fullAnswer = "";
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.type === "plan") {
              setAgentSteps(parsed.steps ?? []);
              setAgentCurrentStep(0);
              setIsStreaming(true);
            } else if (parsed.type === "step_start") {
              setAgentCurrentStep(parsed.stepIndex ?? 0);
            } else if (parsed.type === "step_result") {
              setAgentResults((prev) => [...prev, { stepIndex: parsed.stepIndex, result: parsed.result, sources: parsed.sources, exitCode: parsed.exitCode }]);
              if (parsed.sources?.length) setSources(parsed.sources);
            } else if (parsed.type === "step_error") {
              setAgentResults((prev) => [...prev, { stepIndex: parsed.stepIndex, message: parsed.message }]);
            } else if (parsed.type === "delta") {
              fullAnswer += parsed.content;
              setAiAnswer(fullAnswer);
            } else if (parsed.type === "done") {
              setIsAgentRunning(false);
              setIsStreaming(false);
              if (fullAnswer) saveToHistory.mutate({ query: q.trim(), aiAnswer: fullAnswer, sources: [], filter: "all", sessionId });
            } else if (parsed.type === "error") {
              setError(parsed.message);
              setIsAgentRunning(false);
              setIsStreaming(false);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message || "Agent plan failed");
        setIsAgentRunning(false);
        setIsStreaming(false);
      }
    }
  }, [saveToHistory, model]);

  const runSearch = useCallback((q: string, f: FilterType = filter, m: SearchMode = mode) => {
    if (!q.trim()) return;
    if (isFileMode && attachedFile) {
      runFileAnalysis(q, attachedFile);
    } else if (m === "deep") {
      runDeepResearch(q);
    } else {
      runStandardSearch(q, f);
    }
  }, [filter, mode, isFileMode, attachedFile, runFileAnalysis, runDeepResearch, runStandardSearch]);

  // v5.10: True sandbox ZIP editing — upload → LLM edits → download (no panel needed)
  const runZipEdit = useCallback(async (instructions: string, file: AttachedFile) => {
    // v5.19 fix: Also check zipStore when file.rawBase64 is undefined (Home page navigation)
    const zipStoreEntry = getRawZip();
    const zipRawBase64 = file.rawBase64 ?? (zipStoreEntry?.fileName === file.name ? zipStoreEntry.rawBase64 : undefined);
    if (!zipRawBase64) {
      toast.error("ZIP bytes not available — please re-attach the file.");
      return;
    }
    // v6.00: Preserve conversation history before clearing — save current answer to thread
    setThread(prev => {
      if (aiAnswer && query) {
        return [...prev, { query, answer: aiAnswer, sources, filter, expanded: false }];
      }
      return prev;
    });
    setIsZipEditing(true);
    setZipEditResult(null);
    setAiAnswer("");
    setIsStreaming(true);
    // Show a streaming-style status message while editing
    const statusMessages = [
      "Extracting ZIP archive…",
      "Reading source files…",
      "Analyzing codebase…",
      "Planning edits…",
      "Applying changes…",
      "Repacking archive…",
    ];
    let msgIdx = 0;
    setAiAnswer(statusMessages[0]);
    const interval = setInterval(() => {
      msgIdx = Math.min(msgIdx + 1, statusMessages.length - 1);
      setAiAnswer(statusMessages[msgIdx]);
    }, 2000);
    try {
      const response = await fetch("/api/edit/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileContent: zipRawBase64, fileName: file.name, instructions: instructions.trim(), model }),
      });
      clearInterval(interval);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Edit failed");
      }
      const data = await response.json();
      setZipEditResult({ ...data, fileName: file.name });
      setAiAnswer(`**${data.editsApplied} edit${data.editsApplied !== 1 ? "s" : ""} applied** to \`${file.name}\`\n\n${data.summary}\n\n**Changes:**\n${data.log.slice(0, 10).map((l: string) => `- ${l}`).join("\n")}`);
      setIsStreaming(false);
      saveToHistory.mutate({ query: `[ZIP Edit] ${instructions}`.slice(0, 500), aiAnswer: data.summary, sources: [], filter: "all", sessionId });
      toast.success(`${data.editsApplied} edit${data.editsApplied !== 1 ? "s" : ""} applied — ready to download`);
    } catch (err) {
      clearInterval(interval);
      setError((err as Error).message || "ZIP edit failed");
      setAiAnswer("");
      setIsStreaming(false);
      toast.error("ZIP edit failed: " + (err as Error).message);
    } finally {
      setIsZipEditing(false);
    }
  }, [model, saveToHistory, sessionId]);

  // v5.10: Plan Mode — generate plan before executing (Claude Code EnterPlanMode)
  const runWithPlanMode = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setIsGeneratingPlan(true);
    try {
      const response = await fetch("/api/plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: q.trim(), model }),
      });
      if (!response.ok) throw new Error("Plan generation failed");
      const plan = await response.json();
      setPendingPlan({ ...plan, goalQuery: q.trim() });
    } catch (err) {
      toast.error("Plan generation failed: " + (err as Error).message);
      // Fall through to direct execution
      handleNewSearch(q);
    } finally {
      setIsGeneratingPlan(false);
    }
  }, [model]);

  const approvePlan = useCallback(() => {
    if (!pendingPlan) return;
    const q = pendingPlan.goalQuery;
    setPendingPlan(null);
    handleNewSearch(q);
  }, [pendingPlan]);

  const rejectPlan = useCallback(() => {
    setPendingPlan(null);
    toast.info("Plan cancelled");
  }, []);

  // v5.10: /compact — compress conversation thread to free context window
  const handleCompact = useCallback(async () => {
    const allTurns = [...thread];
    if (aiAnswer) allTurns.push({ query, answer: aiAnswer, sources, filter, expanded: false });
    if (allTurns.length === 0) { toast.info("No conversation to compact"); return; }
    setIsCompacting(true);
    try {
      const response = await fetch("/api/compact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread: allTurns.map(t => ({ query: t.query, answer: t.answer })) }),
      });
      if (!response.ok) throw new Error("Compact failed");
      const result = await response.json();
      // Replace thread with a single summary turn
      setThread([]);
      setAiAnswer(result.summary);
      setQuery("/compact summary");
      toast.success(`Compacted ${result.turnCount} turns (${Math.round(result.originalChars/1000)}K → ${Math.round(result.compressedChars/1000)}K chars)`);
    } catch (err) {
      toast.error("Compact failed: " + (err as Error).message);
    } finally {
      setIsCompacting(false);
    }
  }, [thread, aiAnswer, query, sources, filter]);

  const initialAttachedFileRef = useRef<AttachedFile | null>(attachedFile);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === "e") || (e.key === "`" && !e.ctrlKey && !e.metaKey && !(document.activeElement instanceof HTMLInputElement) && !(document.activeElement instanceof HTMLTextAreaElement))) {
        e.preventDefault();
        setShowCodeExecutor((v) => !v);
      }
      if (e.ctrlKey && e.key === "i" && !(document.activeElement instanceof HTMLInputElement) && !(document.activeElement instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setShowImageGen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // v5.61: Reset textarea height when input is cleared programmatically
  useEffect(() => {
    if (!inputValue && bottomInputRef.current) {
      bottomInputRef.current.style.height = "auto";
    }
  }, [inputValue]);

  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
      setInputValue("");  // v5.55: keep input clear so user can type next question
      const file = initialAttachedFileRef.current;
      if (initialFileMode && file) {
        runFileAnalysis(initialQuery, file);
      } else if (initialMode === "deep") {
        setMode("deep");
        runDeepResearch(initialQuery);
      } else {
        runStandardSearch(initialQuery, "all");
      }
    }
    return () => abortRef.current?.abort();
  }, [initialQuery]); // eslint-disable-line

  const handleNewSearch = (q: string) => {
    if (!q.trim()) return;
    // v5.10: /compact command shortcut
    if (q.trim() === "/compact") {
      handleCompact();
      setInputValue("");
      return;
    }
    // v5.10: Plan Mode — show plan before executing (non-file, non-agent queries)
    if (isPlanMode && !isFileMode && !isAgentMode) {
      setInputValue("");
      runWithPlanMode(q);
      return;
    }
    // v5.38: AGENT MODE TAKES PRIORITY — when agent mode is active, always use ReAct engine
    // even if files are attached. Files become context for the agent, not ZIP edit targets.
    if (isAgentMode) {
      setQuery(q.trim());
      setInputValue("");
      setThread([]);
      setReactEvents([]);
      let agentQuery = q.trim();
      // Include all attached files as context for the agent
      if (attachedFile) {
        const fileContext = attachedFile.mimeType === "application/zip"
          ? `[Attached ZIP: ${attachedFile.name} — ${attachedFile.content}]`
          : `[Attached file: ${attachedFile.name}]\n\n${attachedFile.content?.slice(0, 50000) ?? ""}`;
        agentQuery = `${agentQuery}\n\n${fileContext}`;
      }
      if (extraFiles.length > 0) {
        agentQuery += extraFiles.map(f => `\n\n[Additional file: ${f.name}]\n${f.content?.slice(0, 20000) ?? ""}`).join("");
      }
      runReactAgent(agentQuery);
      return;
    }
    if (isFileMode && attachedFile) {
      setQuery(q.trim());
      setInputValue("");
      setZipEditResult(null);
      // v5.10: ZIP files with edit-intent keywords go to sandbox editor; others go to analysis
      const isZip = attachedFile.name.toLowerCase().endsWith(".zip");
      // v6.03 fix: Only match imperative edit commands, not incidental use of words like
      // "improvements", "improved", "we made changes" etc. Require the keyword to appear
      // as a clear action verb: at start of sentence, after "please"/"can you"/"could you",
      // or as a standalone imperative. Exclude noun/adjective forms.
      const isEditCommand = (text: string): boolean => {
        const t = text.trim();
        // Explicit imperative patterns: starts with action verb or "please <verb>"
        const imperativePattern = /^(please\s+)?(fix|edit|change|update|add|remove|refactor|improve|rename|replace|delete|create|implement|rewrite|modify|apply|convert)\b/i;
        // "can you / could you / would you <verb>" patterns
        const requestPattern = /\b(can you|could you|would you|i want you to|i need you to|please)\s+(fix|edit|change|update|add|remove|refactor|improve|rename|replace|delete|create|implement|rewrite|modify|apply|convert)\b/i;
        // "make it", "make the", "make a" patterns (not just "make" in passing)
        const makePattern = /\bmake\s+(it|the|a|an|this|these|those|all)\b/i;
        return imperativePattern.test(t) || requestPattern.test(t) || makePattern.test(t);
      };
      // v5.19 fix: Also check zipStore for rawBase64 availability
      const zipEntry = getRawZip();
      const hasZipBytes = !!(attachedFile.rawBase64 || (zipEntry?.fileName === attachedFile.name && zipEntry.rawBase64));
      if (isZip && hasZipBytes && isEditCommand(q)) {
        runZipEdit(q.trim(), attachedFile);
      } else {
        runFileAnalysis(q.trim(), attachedFile);
      }
    } else {
      setThread([]);
      navigate(`/search?q=${encodeURIComponent(q.trim())}`);
    }
  };

  const handleFollowUp = (q: string) => {
    if (!q.trim() || isStreaming || isLoadingSources || isZipEditing) return;
    if (isFileMode && attachedFile) {
      setQuery(q.trim());
      setFollowUpInput("");
      setZipEditResult(null);
      const isZip = attachedFile.name.toLowerCase().endsWith(".zip");
      // v6.03 fix: Reuse isEditCommand helper (defined in handleSubmit scope above)
      const isEditCommand2 = (text: string): boolean => {
        const t = text.trim();
        const imperativePattern = /^(please\s+)?(fix|edit|change|update|add|remove|refactor|improve|rename|replace|delete|create|implement|rewrite|modify|apply|convert)\b/i;
        const requestPattern = /\b(can you|could you|would you|i want you to|i need you to|please)\s+(fix|edit|change|update|add|remove|refactor|improve|rename|replace|delete|create|implement|rewrite|modify|apply|convert)\b/i;
        const makePattern = /\bmake\s+(it|the|a|an|this|these|those|all)\b/i;
        return imperativePattern.test(t) || requestPattern.test(t) || makePattern.test(t);
      };
      // v5.19 fix: Also check zipStore for rawBase64 availability
      const zipEntry2 = getRawZip();
      const hasZipBytes2 = !!(attachedFile.rawBase64 || (zipEntry2?.fileName === attachedFile.name && zipEntry2.rawBase64));
      if (isZip && hasZipBytes2 && isEditCommand2(q)) {
        runZipEdit(q.trim(), attachedFile);
      } else if (aiAnswer) {
        // v6.02: Non-edit follow-up in file mode — treat as conversational chat
        // Don't re-analyze the file or trigger zip edit, just answer the question
        const completedTurn: ThreadTurn = { query, answer: aiAnswer, sources, filter, expanded: false };
        setThread((prev) => [...prev, completedTurn]);
        setAiAnswer("");
        setSources([]);
        const priorContext = [
          ...thread.map((t) => ({ query: t.query, answer: t.answer })),
          { query, answer: aiAnswer },
        ];
        runStandardSearch(q.trim(), filter, priorContext);
      } else {
        runFileAnalysis(q.trim(), attachedFile);
      }
      return;
    }
    if (aiAnswer) {
      const completedTurn: ThreadTurn = { query, answer: aiAnswer, sources, filter, expanded: false };
      setThread((prev) => [...prev, completedTurn]);
    }
    const priorContext = [
      ...thread.map((t) => ({ query: t.query, answer: t.answer })),
      ...(aiAnswer ? [{ query, answer: aiAnswer }] : []),
    ];
    setQuery(q.trim());
    setInputValue("");  // v5.55: clear input box after submit
    setFollowUpInput("");
    runStandardSearch(q.trim(), filter, priorContext);
    setTimeout(() => threadBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  const handleFilterChange = (f: FilterType) => {
    setFilter(f);
    if (query && !isFileMode) runStandardSearch(query, f);
  };

  const handleModeToggle = () => {
    const newMode = mode === "standard" ? "deep" : "standard";
    setMode(newMode);
    if (query && !isFileMode) runSearch(query, filter, newMode);
  };

  const copyAnswer = () => { navigator.clipboard.writeText(aiAnswer); toast.success("Copied to clipboard"); };
  const shareSearch = () => { navigator.clipboard.writeText(window.location.href); toast.success("URL copied"); };
  const exportMarkdown = () => {
    const md = `# ${query}\n\n${aiAnswer}\n\n---\n\n## Sources\n\n${sources.map((s, i) => `${i + 1}. [${s.title}](${s.url}) — ${s.domain}`).join("\n")}`;
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `andromeda-${query.slice(0, 30).replace(/\s+/g, "-")}.md`;
    a.click();
    toast.success("Exported as Markdown");
  };

  const handleContinue = useCallback(async () => {
    if (!continueMessages.length || isStreaming) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setIsTruncated(false);
    setIsStreaming(true);
    setError(null);
    try {
      const response = await fetch("/api/continue/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: continueMessages, model }),
        signal: abortRef.current.signal,
      });
      if (!response.ok) throw new Error(`Continue failed: ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let continuation = "";
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.type === "delta") {
              continuation += parsed.content;
              setAiAnswer(prev => prev + parsed.content);
            } else if (parsed.type === "truncated") {
              setIsTruncated(true);
              setContinueMessages(prev => [
                ...prev.slice(0, -1),
                { role: "assistant", content: (prev[prev.length - 1]?.content ?? "") + continuation },
              ]);
            } else if (parsed.type === "done") {
              setIsStreaming(false);
              setContinueMessages(prev => [
                ...prev.slice(0, -1),
                { role: "assistant", content: (prev[prev.length - 1]?.content ?? "") + continuation },
              ]);
            } else if (parsed.type === "error") {
              setError(parsed.message);
              setIsStreaming(false);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message || "Continue failed");
        setIsStreaming(false);
      }
    }
  }, [continueMessages, isStreaming, model]);

  // ─── v5.5: ReAct Agent runner ──────────────────────────────────────────────
  const runReactAgent = useCallback(async (task: string) => {
    if (!task.trim() || isReactRunning) return;
    setIsReactRunning(true);
    setReactEvents([]);
    setReactHumanQuestion(null);
    setReactHumanAnswer("");
    const sid = `react-${Date.now()}`;
    setReactSessionId(sid);
    try {
      // v5.49: Apply tier before starting agent (ensures correct provider is active)
      try {
        await fetch("/api/llm/tier", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier: modelTier }),
        });
      } catch { /* non-fatal */ }
      const resp = await fetch("/api/agent/react/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: task.trim() }),
      });
      if (!resp.ok) throw new Error(`Agent failed: ${resp.status}`);
      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;
          try {
            const evt = JSON.parse(raw);
            setReactEvents(prev => [...prev, evt]);
            if (evt.type === "ask_human") setReactHumanQuestion(evt.content ?? "I need your input.");
            if (evt.type === "done" || evt.type === "error" || evt.type === "interrupted") setIsReactRunning(false);
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      setReactEvents(prev => [...prev, { type: "error", error: (err as Error).message }]);
    } finally {
      setIsReactRunning(false);
    }
  }, [isReactRunning]);

  const respondToReactAgent = useCallback(async () => {
    if (!reactSessionId || !reactHumanAnswer.trim()) return;
    try {
      await fetch("/api/agent/react/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: reactSessionId, answer: reactHumanAnswer.trim() }),
      });
      setReactHumanQuestion(null);
      setReactHumanAnswer("");
    } catch { /* ignore */ }
  }, [reactSessionId, reactHumanAnswer]);

  const fetchLlmProviders = useCallback(async () => {
    try {
      const r = await fetch("/api/llm/providers");
      const d = await r.json();
      setLlmProviders(d.providers ?? []);
      setActiveProviderState(d.active ?? null);
    } catch { /* ignore */ }
  }, []);

  const fetchMcpServers = useCallback(async () => {
    try {
      const r = await fetch("/api/mcp/servers");
      const d = await r.json();
      setMcpServers(d.servers ?? []);
      setMcpConnections(d.connections ?? []);
    } catch { /* ignore */ }
  }, []);

  const fetchRegisteredTools = useCallback(async () => {
    try {
      const r = await fetch("/api/tools");
      const d = await r.json();
      setRegisteredTools(d.tools ?? []);
    } catch { /* ignore */ }
  }, []);

  const fetchSchedulerTasks = useCallback(async () => {
    try {
      const [tasksRes, statsRes] = await Promise.all([fetch("/api/scheduler/tasks"), fetch("/api/scheduler/stats")]);
      if (tasksRes.ok) setSchedulerTasks((await tasksRes.json()).tasks ?? []);
      if (statsRes.ok) setSchedulerStats(await statsRes.json());
    } catch { /* ignore */ }
  }, []);

  const runOrchestration = useCallback(async (task: string) => {
    setOrchestratorRunning(true);
    setOrchestratorEvents([]);
    try {
      const resp = await fetch("/api/agent/orchestrate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, enableDebate: true, enableMerge: true }),
      });
      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const event = JSON.parse(line.slice(6));
              setOrchestratorEvents(prev => [...prev, event]);
            } catch { /* skip */ }
          }
        }
      }
    } catch (err) {
      setOrchestratorEvents(prev => [...prev, { type: "agent_error", data: { error: String(err) }, timestamp: Date.now() }]);
    } finally {
      setOrchestratorRunning(false);
    }
  }, []);

  const fetchGuardData = useCallback(async () => {
    try {
      const [configRes, backupsRes, auditRes] = await Promise.all([
        fetch("/api/guard/config"), fetch("/api/guard/backups"), fetch("/api/guard/audit?limit=30"),
      ]);
      if (configRes.ok) setGuardConfigState(await configRes.json());
      if (backupsRes.ok) setGuardBackups((await backupsRes.json()).backups ?? []);
      if (auditRes.ok) setGuardAuditState((await auditRes.json()).entries ?? []);
    } catch { /* ignore */ }
  }, []);

  const fetchSecurityData = useCallback(async () => {
    try {
      const [keysRes, configRes, statsRes, auditRes] = await Promise.all([
        fetch("/api/security/keys"), fetch("/api/security/config"),
        fetch("/api/security/stats"), fetch("/api/security/audit?limit=30"),
      ]);
      if (keysRes.ok) setSecurityKeys((await keysRes.json()).keys ?? []);
      if (configRes.ok) setSecurityConfigState(await configRes.json());
      if (statsRes.ok) setSecurityStatsState(await statsRes.json());
      if (auditRes.ok) setSecurityAuditState((await auditRes.json()).entries ?? []);
    } catch { /* ignore */ }
  }, []);

  const fetchGoals = async () => {
    try {
      const [goalsRes, statsRes] = await Promise.all([fetch("/api/goals"), fetch("/api/goals/stats")]);
      if (goalsRes.ok) setGoals(await goalsRes.json());
      if (statsRes.ok) setGoalStats(await statsRes.json());
    } catch {}
  };

  const handleCreateGoal = async () => {
    if (!newGoalTitle.trim()) return;
    try {
      const res = await fetch("/api/goals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newGoalTitle.trim(), description: "" }),
      });
      if (res.ok) { setNewGoalTitle(""); fetchGoals(); }
    } catch {}
  };

  const handleStartGoal = async (id: string) => {
    await fetch(`/api/goals/${id}/start`, { method: "POST" }); fetchGoals();
  };

  const handleCompleteGoal = async (id: string) => {
    await fetch(`/api/goals/${id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outcome: "Completed" }) }); fetchGoals();
  };

  const handleDecomposeGoal = async (id: string) => {
    await fetch(`/api/goals/${id}/decompose`, { method: "POST" }); fetchGoals();
  };

  const fetchHealthReport = async () => {
    try {
      const [healthRes, alertsRes] = await Promise.all([fetch("/api/monitor/health"), fetch("/api/monitor/alerts")]);
      if (healthRes.ok) setHealthReport(await healthRes.json());
      if (alertsRes.ok) setMonitorAlerts(await alertsRes.json());
    } catch {}
  };

  const handleStartMonitor = async () => { await fetch("/api/monitor/start", { method: "POST" }); fetchHealthReport(); };
  const handleStopMonitor = async () => { await fetch("/api/monitor/stop", { method: "POST" }); fetchHealthReport(); };

  const fetchConsolidationData = async () => {
    try {
      const [statsRes, memRes] = await Promise.all([
        fetch("/api/memory/consolidation/stats"), fetch("/api/memory/consolidation/scored?limit=20")
      ]);
      if (statsRes.ok) setConsolidationStats(await statsRes.json());
      if (memRes.ok) setScoredMemories(await memRes.json());
    } catch {}
  };

  const handleRunConsolidation = async () => { await fetch("/api/memory/consolidation/run", { method: "POST" }); fetchConsolidationData(); };

  const fetchDecomposerData = async () => {
    try {
      const res = await fetch("/api/decompose/stats/overview");
      if (res.ok) setDecomposerStats(await res.json());
    } catch {}
  };

  const handleAnalyzeComplexity = async () => {
    if (!testQuery.trim()) return;
    try {
      const res = await fetch("/api/decompose/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: testQuery.trim() }),
      });
      if (res.ok) setComplexityResult(await res.json());
    } catch {}
  };

  const fetchDepsStats = async () => { try { const r = await fetch("/api/deps/stats"); setDepsStats(await r.json()); } catch {} };
  const fetchReviewStats = async () => { try { const r = await fetch("/api/review/stats"); setReviewStats(await r.json()); } catch {} };
  const fetchTestStats = async () => { try { const r = await fetch("/api/tests/stats"); setTestStats(await r.json()); } catch {} };
  const fetchBusStats = async () => { try { const r = await fetch("/api/bus/stats"); setBusStats(await r.json()); } catch {} };
  const fetchBusChannels = async () => { try { const r = await fetch("/api/bus/channels"); setBusChannels(await r.json()); } catch {} };
  const triggerDedup = async () => { try { await fetch("/api/memory/dedup/run", { method: "POST" }); } catch {} };
  const triggerReprioritize = async () => { try { await fetch("/api/goals/reprioritize", { method: "POST" }); } catch {} };
  const triggerRecalcBaselines = async () => { try { await fetch("/api/monitor/recalculate-baselines", { method: "POST" }); } catch {} };

  const FILTERS: { label: string; value: FilterType }[] = [
    { label: "All", value: "all" },
    { label: "Web", value: "web" },
    { label: "Academic", value: "academic" },
  ];

  const isDeepMode = mode === "deep" && !isFileMode;
  const showProgress = isDeepMode && deepProgress.length > 0 && (isLoadingSources || isStreaming);
  const historyItems = historyQuery.data?.items ?? [];

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex"
      style={{ background: "#0d0d0d", color: "#e4e4e7" }}
      ref={dropZoneRef}
    >
      {/* Cinematic background canvas */}
      <ThemeCanvas skin={currentSkin} />
      {/* Skin picker */}
      <SkinSelector currentSkin={currentSkin} onSkinChange={setCurrentSkin} />

      {/* Drag overlay */}
      <div className="drag-overlay hidden fixed inset-0 z-[100] bg-violet-500/10 border-2 border-dashed border-violet-500/50 flex items-center justify-center pointer-events-none">
        <div className="text-center">
          <Paperclip className="w-12 h-12 text-violet-400 mx-auto mb-3" />
          <p className="text-lg font-medium text-violet-300">Drop file to analyze</p>
          <p className="text-sm text-zinc-500">XML, JSON, code, images, text files, ZIPs</p>
        </div>
      </div>

      {/* ─── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
      <aside
        className={`fixed left-0 top-0 bottom-0 z-40 flex flex-col transition-all duration-300 border-r border-zinc-800/60`}
        style={{
          width: leftSidebarOpen ? "260px" : "56px",
          background: "#111111",
        }}
      >
        {/* Logo + collapse button */}
        <div className="flex items-center justify-between px-3 py-4 border-b border-zinc-800/60 flex-shrink-0">
          {leftSidebarOpen ? (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4 text-violet-400" />
              </div>
              <span className="font-semibold text-sm text-white truncate">Andromeda</span>
            </div>
          ) : (
            <div className="w-7 h-7 rounded-lg bg-violet-500/20 flex items-center justify-center mx-auto">
              <Sparkles className="w-4 h-4 text-violet-400" />
            </div>
          )}
          <button
            onClick={() => setLeftSidebarOpen(v => !v)}
            className="p-1 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors flex-shrink-0"
          >
            {leftSidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>

        {/* New Chat button */}
        <div className="px-2 py-2 flex-shrink-0">
          <button
            onClick={() => navigate("/")}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all
              bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/50`}
            title="New Chat"
          >
            <Plus className="w-4 h-4 flex-shrink-0" />
            {leftSidebarOpen && <span>New Chat</span>}
          </button>
        </div>

        {/* History list */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5 min-h-0">
          {leftSidebarOpen && (
            <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider px-2 py-1.5">
              Recent
            </p>
          )}
          {/* v5.10: History always visible, no auth required */}
          {historyItems.length > 0 ? (
            historyItems.map((item: any) => (
              <button
                key={item.id}
                onClick={() => {
                  // Load the full saved thread turn instead of re-running the query
                  if (item.aiAnswer) {
                    setThread([]);
                    setQuery(item.query);
                    setInputValue("");
                    setAiAnswer(item.aiAnswer);
                    setSources(item.sources ?? []);
                    setIsStreaming(false);
                    setIsLoadingSources(false);
                    setError(null);
                    setFollowUps([]);
                    setTimeout(() => threadBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
                  } else {
                    navigate(`/search?q=${encodeURIComponent(item.query)}`);
                  }
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all hover:bg-zinc-800 group ${
                  query === item.query ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
                title={item.query}
              >
                <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 text-zinc-600 group-hover:text-zinc-400" />
                {leftSidebarOpen && (
                  <span className="text-xs truncate">{item.query}</span>
                )}
              </button>
            ))
          ) : (
            leftSidebarOpen && (
              <p className="text-xs text-zinc-600 px-2 py-2">No conversations yet</p>
            )
          )}
        </div>

        {/* Bottom nav: feature categories */}
        <div className="border-t border-zinc-800/60 px-2 py-2 space-y-0.5 flex-shrink-0">
          {[
            { cat: "agent" as const, icon: <Zap className="w-4 h-4" />, label: "Agent Tools", color: "text-cyan-400" },
            { cat: "tools" as const, icon: <Wrench className="w-4 h-4" />, label: "Dev Tools", color: "text-amber-400" },
            { cat: "memory" as const, icon: <Database className="w-4 h-4" />, label: "Memory", color: "text-emerald-400" },
            { cat: "system" as const, icon: <Shield className="w-4 h-4" />, label: "System", color: "text-red-400" },
          ].map(({ cat, icon, label, color }) => (
            <button
              key={cat}
              onClick={() => {
                if (rightPanelCategory === cat && rightPanelOpen) {
                  setRightPanelOpen(false);
                  setRightPanelCategory(null);
                } else {
                  setRightPanelCategory(cat);
                  setRightPanelOpen(true);
                }
              }}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all ${
                rightPanelCategory === cat && rightPanelOpen
                  ? `bg-zinc-800 ${color}`
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              }`}
              title={label}
            >
              <span className="flex-shrink-0">{icon}</span>
              {leftSidebarOpen && <span className="text-xs">{label}</span>}
            </button>
          ))}

          {/* v5.10: version indicator — no auth required */}
          <div className="pt-1 border-t border-zinc-800/40">
            <div className={`flex items-center gap-2.5 px-2.5 py-2 ${leftSidebarOpen ? "" : "justify-center"}`}>
              <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-3 h-3 text-violet-400" />
              </div>
              {leftSidebarOpen && <span className="text-[10px] text-zinc-600">Andromeda v5.61</span>}
            </div>
          </div>
        </div>
      </aside>

      {/* ─── RIGHT PANEL (feature panels) ─────────────────────────────────── */}
      {rightPanelOpen && rightPanelCategory && (
        <aside
          className="fixed right-0 top-0 bottom-0 z-40 w-72 border-l border-zinc-800/60 overflow-y-auto"
          style={{ background: "#111111" }}
        >
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-800/60">
            <span className="text-sm font-semibold text-white">
              {rightPanelCategory === "agent" ? "Agent Tools"
                : rightPanelCategory === "tools" ? "Dev Tools"
                : rightPanelCategory === "memory" ? "Memory & Knowledge"
                : "System & Security"}
            </span>
            <button onClick={() => { setRightPanelOpen(false); setRightPanelCategory(null); }}
              className="p-1 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3 space-y-1">
            {rightPanelCategory === "agent" && (
              <>
                <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-2 px-2">Agent Tools</p>
                {[
                  { label: "ReAct Engine", icon: <Zap className="w-3.5 h-3.5" />, active: showReactAgent, onClick: () => { setShowReactAgent(v => !v); if (!showReactAgent) fetchRegisteredTools(); }, color: "text-cyan-300" },
                  { label: "MCP Servers", icon: <Globe className="w-3.5 h-3.5" />, active: showMcpPanel, onClick: () => { setShowMcpPanel(v => !v); if (!showMcpPanel) fetchMcpServers(); }, color: "text-indigo-300" },
                  { label: "LLM Providers", icon: <Bot className="w-3.5 h-3.5" />, active: showProviderSettings, onClick: () => { setShowProviderSettings(v => !v); if (!showProviderSettings) fetchLlmProviders(); }, color: "text-pink-300" },
                  { label: "Team Agent", icon: <Users className="w-3.5 h-3.5" />, active: showTeamAgent, onClick: () => setShowTeamAgent(v => !v), color: "text-violet-300" },
                  { label: "Orchestrator", icon: <Users className="w-3.5 h-3.5" />, active: showOrchestratorPanel, onClick: () => setShowOrchestratorPanel(v => !v), color: "text-violet-300" },
                  { label: "Task Decomposer", icon: <GitBranch className="w-3.5 h-3.5" />, active: showDecomposerPanel, onClick: () => { setShowDecomposerPanel(v => !v); if (!showDecomposerPanel) fetchDecomposerData(); }, color: "text-teal-300" },
                  { label: "Self-Improve", icon: <Sparkles className="w-3.5 h-3.5" />, active: showSelfImprove, onClick: () => { setShowSelfImprove(v => !v); if (!showSelfImprove) { fetch("/api/self/files").then(r => r.json()).then(d => { setSelfImproveFiles(d.files ?? []); if (d.files?.[0]) setSelectedSelfFile(d.files[0]); }); fetch("/api/self/proposals?status=pending").then(r => r.json()).then(d => setSelfProposals(d.proposals ?? [])); } }, color: "text-orange-300" },
                ].map(item => (
                  <button key={item.label} onClick={item.onClick}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${
                      item.active ? `bg-zinc-800 ${item.color}` : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                    }`}>
                    {item.icon}{item.label}
                  </button>
                ))}
              </>
            )}
            {rightPanelCategory === "tools" && (
              <>
                <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-2 px-2">Development</p>
                {[
                  { label: "Workspace Files", icon: <FolderOpen className="w-3.5 h-3.5" />, active: showWorkspace, onClick: () => { setShowWorkspace(v => !v); if (!showWorkspace) { setIsLoadingWorkspace(true); fetch("/api/workspace/files").then(r => r.json()).then(data => { setWorkspaceFiles(data.files ?? []); setIsLoadingWorkspace(false); }).catch(() => setIsLoadingWorkspace(false)); } }, color: "text-cyan-300" },
                  { label: "Dependencies", icon: <Download className="w-3.5 h-3.5" />, active: showDepsPanel, onClick: () => { setShowDepsPanel(v => !v); if (!showDepsPanel) fetchDepsStats(); }, color: "text-lime-300" },
                  { label: "Self-Review", icon: <Eye className="w-3.5 h-3.5" />, active: showReviewPanel, onClick: () => { setShowReviewPanel(v => !v); if (!showReviewPanel) fetchReviewStats(); }, color: "text-violet-300" },
                  { label: "Test Generator", icon: <CheckCircle2 className="w-3.5 h-3.5" />, active: showTestPanel, onClick: () => { setShowTestPanel(v => !v); if (!showTestPanel) fetchTestStats(); }, color: "text-emerald-300" },
                  { label: "Improve Guard", icon: <Shield className="w-3.5 h-3.5" />, active: showGuardPanel, onClick: () => { setShowGuardPanel(v => !v); if (!showGuardPanel) fetchGuardData(); }, color: "text-emerald-300" },
                  { label: "Self-Improve", icon: <Sparkles className="w-3.5 h-3.5" />, active: showSelfImprove, onClick: () => { setShowSelfImprove(v => !v); if (!showSelfImprove) { fetch("/api/self/files").then(r => r.json()).then(d => { setSelfImproveFiles(d.files ?? []); if (d.files?.[0]) setSelectedSelfFile(d.files[0]); }); fetch("/api/self/proposals?status=pending").then(r => r.json()).then(d => setSelfProposals(d.proposals ?? [])); } }, color: "text-orange-300" },
                  { label: "Scheduler", icon: <Clock className="w-3.5 h-3.5" />, active: showSchedulerPanel, onClick: () => { setShowSchedulerPanel(v => !v); if (!showSchedulerPanel) fetchSchedulerTasks(); }, color: "text-orange-300" },
                  { label: "Code Executor", icon: <Code2 className="w-3.5 h-3.5" />, active: showCodeExecutor, onClick: () => setShowCodeExecutor(v => !v), color: "text-amber-300" },
                  { label: "Image Generator", icon: <ImageIcon className="w-3.5 h-3.5" />, active: showImageGen, onClick: () => setShowImageGen(v => !v), color: "text-pink-300" },
                ].map(item => (
                  <button key={item.label} onClick={item.onClick}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${
                      item.active ? `bg-zinc-800 ${item.color}` : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                    }`}>
                    {item.icon}{item.label}
                  </button>
                ))}
              </>
            )}
            {rightPanelCategory === "memory" && (
              <>
                <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-2 px-2">Memory & Knowledge</p>
                {[
                  { label: "Long-Term Memory", icon: <Database className="w-3.5 h-3.5" />, active: showMemory, onClick: () => { setShowMemory(v => !v); if (!showMemory) { setIsLoadingMemory(true); Promise.all([fetch("/api/memory/list").then(r => r.json()), fetch("/api/memory/stats").then(r => r.json())]).then(([listData, statsData]) => { setMemoryEntries(listData.entries ?? []); setMemoryStats(statsData); setIsLoadingMemory(false); }).catch(() => setIsLoadingMemory(false)); } }, color: "text-emerald-300" },
                  { label: "Consolidation", icon: <Database className="w-3.5 h-3.5" />, active: showConsolidationPanel, onClick: () => { setShowConsolidationPanel(v => !v); if (!showConsolidationPanel) fetchConsolidationData(); }, color: "text-amber-300" },
                  { label: "Goals", icon: <Target className="w-3.5 h-3.5" />, active: showGoalPanel, onClick: () => { setShowGoalPanel(v => !v); if (!showGoalPanel) fetchGoals(); }, color: "text-sky-300" },
                  { label: "Context Bus", icon: <Radio className="w-3.5 h-3.5" />, active: showBusPanel, onClick: () => { setShowBusPanel(v => !v); if (!showBusPanel) { fetchBusStats(); fetchBusChannels(); } }, color: "text-sky-300" },
                ].map(item => (
                  <button key={item.label} onClick={item.onClick}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${
                      item.active ? `bg-zinc-800 ${item.color}` : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                    }`}>
                    {item.icon}{item.label}
                  </button>
                ))}
              </>
            )}
            {rightPanelCategory === "system" && (
              <>
                <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-2 px-2">System & Security</p>
                {[
                  { label: "Security", icon: <Lock className="w-3.5 h-3.5" />, active: showSecurityPanel, onClick: () => { setShowSecurityPanel(v => !v); if (!showSecurityPanel) fetchSecurityData(); }, color: "text-red-300" },
                  { label: "Health Monitor", icon: <Activity className="w-3.5 h-3.5" />, active: showMonitorPanel, onClick: () => { setShowMonitorPanel(v => !v); if (!showMonitorPanel) fetchHealthReport(); }, color: "text-red-300" },
                ].map(item => (
                  <button key={item.label} onClick={item.onClick}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${
                      item.active ? `bg-zinc-800 ${item.color}` : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                    }`}>
                    {item.icon}{item.label}
                  </button>
                ))}
              </>
            )}
          </div>

          {/* Inline panels rendered inside right panel */}
          <div className="px-3 pb-4 space-y-4">
            {/* ReAct Agent Panel */}
            {showReactAgent && (
              <div className="space-y-3 mt-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-cyan-500/15 flex items-center justify-center">
                    <Zap className="w-3.5 h-3.5 text-cyan-400" />
                  </div>
                  <p className="text-xs font-semibold text-zinc-200">ReAct Agent</p>
                  {isReactRunning && <Loader2 className="w-3 h-3 animate-spin text-cyan-400 ml-auto" />}
                </div>
                <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 overflow-hidden">
                  <textarea
                    value={reactInput}
                    onChange={e => setReactInput(e.target.value)}
                    placeholder="Assign a task..."
                    rows={2}
                    className="w-full bg-transparent px-3 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none resize-none"
                    onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runReactAgent(reactInput); } }}
                  />
                  <div className="flex items-center justify-end px-2 py-1.5 border-t border-zinc-700/50">
                    <button disabled={isReactRunning || !reactInput.trim()} onClick={() => runReactAgent(reactInput)}
                      className="px-3 py-1 rounded-lg text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-30 transition-all flex items-center gap-1">
                      {isReactRunning ? <><Loader2 className="w-3 h-3 animate-spin" /> Running...</> : <><SendHorizonal className="w-3 h-3" /> Run</>}
                    </button>
                  </div>
                </div>
                {reactHumanQuestion && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                    <p className="text-xs font-semibold text-amber-400">Agent needs input</p>
                    <p className="text-xs text-zinc-300">{reactHumanQuestion}</p>
                    <div className="flex gap-2">
                      <input value={reactHumanAnswer} onChange={e => setReactHumanAnswer(e.target.value)}
                        placeholder="Your response..." className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500/50"
                        onKeyDown={e => { if (e.key === "Enter") respondToReactAgent(); }} />
                      <button onClick={respondToReactAgent} className="px-3 py-1.5 rounded-lg text-xs bg-amber-600 hover:bg-amber-500 text-white transition-colors">Send</button>
                    </div>
                  </div>
                )}
                {reactEvents.length > 0 && (
                  <div className="rounded-xl border border-zinc-700 bg-zinc-900/30 overflow-hidden">
                    <div className="px-3 py-2 border-b border-zinc-700/50 flex items-center justify-between">
                      <p className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5"><ListChecks className="w-3 h-3 text-cyan-400" /> Progress</p>
                      <span className="text-[10px] text-zinc-600">{reactEvents.length} events</span>
                    </div>
                    <div className="max-h-64 overflow-y-auto px-3 py-2 space-y-1.5">
                      {reactEvents.map((evt, i) => {
                        const isTool = evt.type === "tool_call";
                        const isResult = evt.type === "tool_result";
                        const isThinking = evt.type === "thinking";
                        const isText = evt.type === "text";
                        const isDone = evt.type === "done";
                        const isError = evt.type === "error";
                        const dotColor = isDone ? "bg-green-400" : isError ? "bg-red-400" : isTool ? "bg-blue-400" : isResult ? "bg-emerald-400" : isThinking ? "bg-yellow-400 animate-pulse" : isText ? "bg-cyan-400" : "bg-zinc-500";
                        return (
                          <div key={i} className="flex items-start gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${dotColor}`} />
                            <div className="flex-1 min-w-0">
                              <span className={`text-[11px] ${isDone ? "text-green-400" : isError ? "text-red-400" : isTool ? "text-blue-400" : isResult ? "text-emerald-400" : isThinking ? "text-yellow-400" : isText ? "text-cyan-400" : "text-zinc-500"}`}>
                                {isTool ? `Using: ${evt.toolName}` : isResult ? `Result: ${evt.toolName}` : isDone ? `Done (${evt.totalSteps} steps)` : isThinking ? "Thinking..." : isText ? "Response" : isError ? "Error" : evt.type}
                              </span>
                              {evt.content && <p className="text-[10px] text-zinc-600 truncate mt-0.5">{evt.content}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* MCP Servers */}
            {showMcpPanel && (
              <div className="space-y-2 mt-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5 text-indigo-400" />MCP Servers</p>
                  <button onClick={fetchMcpServers} className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20">Refresh</button>
                </div>
                {mcpServers.length === 0 ? (
                  <p className="text-xs text-zinc-600 px-1">No MCP servers configured</p>
                ) : (
                  <div className="space-y-1.5">
                    {mcpServers.map((srv: any) => (
                      <div key={srv.id} className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-zinc-200">{srv.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${srv.status === "connected" ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-700 text-zinc-500"}`}>{srv.status}</span>
                        </div>
                        <p className="text-[10px] text-zinc-600 mt-0.5">{srv.toolCount ?? 0} tools</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* LLM Providers */}
            {showProviderSettings && (
              <div className="space-y-2 mt-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5"><Bot className="w-3.5 h-3.5 text-pink-400" />LLM Providers</p>
                  <button onClick={fetchLlmProviders} className="text-[10px] px-2 py-0.5 rounded bg-pink-500/10 text-pink-300 hover:bg-pink-500/20">Refresh</button>
                </div>
                {activeProvider && (
                  <div className="rounded-lg bg-pink-500/5 border border-pink-500/20 px-3 py-2">
                    <p className="text-xs font-medium text-pink-300">Active: {activeProvider.name}</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">{activeProvider.model}</p>
                  </div>
                )}
                {llmProviders.map((p: any) => (
                  <div key={p.id} className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 px-3 py-2 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-zinc-200">{p.name}</p>
                      <p className="text-[10px] text-zinc-600">{p.model}</p>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${p.isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-700 text-zinc-500"}`}>{p.isActive ? "Active" : "Idle"}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Team Agent */}
            {showTeamAgent && (
              <div className="space-y-2 mt-2">
                <p className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-violet-400" />Team Agent</p>
                <textarea value={teamTask} onChange={e => setTeamTask(e.target.value)}
                  placeholder="Describe a complex coding task..."
                  className="w-full bg-zinc-800/50 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-violet-500/50"
                  rows={3} />
                <button disabled={isTeamRunning || !teamTask.trim()}
                  onClick={async () => {
                    if (!teamTask.trim()) return;
                    setIsTeamRunning(true); setTeamAgents([]); setTeamSummary(null);
                    const res = await fetch("/api/agent/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: teamTask }) });
                    const reader = res.body!.getReader(); const decoder = new TextDecoder(); let buf = "";
                    while (true) {
                      const { done, value } = await reader.read(); if (done) break;
                      buf += decoder.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() ?? "";
                      for (const line of lines) {
                        if (!line.startsWith("data: ")) continue;
                        try {
                          const ev = JSON.parse(line.slice(6));
                          if (ev.type === "agent_start") setTeamAgents(prev => [...prev, { role: ev.role, name: ev.name, emoji: ev.emoji, status: "thinking" }]);
                          if (ev.type === "agent_done") setTeamAgents(prev => prev.map(a => a.role === ev.role ? { ...a, status: "done", output: ev.output, artifacts: ev.artifacts, issues: ev.issues } : a));
                          if (ev.type === "agent_error") setTeamAgents(prev => prev.map(a => a.role === ev.role ? { ...a, status: "error" } : a));
                          if (ev.type === "team_done") { setTeamSummary(ev.summary); setIsTeamRunning(false); }
                        } catch {}
                      }
                    }
                    setIsTeamRunning(false);
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-violet-600/20 text-violet-300 border border-violet-500/30 text-xs font-medium hover:bg-violet-600/30 transition-all disabled:opacity-50">
                  {isTeamRunning ? <><Loader2 className="w-3 h-3 animate-spin" />Running...</> : <><Users className="w-3 h-3" />Launch Team</>}
                </button>
                {teamAgents.length > 0 && (
                  <div className="space-y-1.5">
                    {teamAgents.map((agent, i) => (
                      <div key={i} className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span>{agent.emoji}</span>
                          <span className="text-xs font-medium text-zinc-200">{agent.name}</span>
                          {agent.status === "thinking" && <Loader2 className="w-3 h-3 animate-spin text-violet-400 ml-auto" />}
                          {agent.status === "done" && <CheckCircle2 className="w-3 h-3 text-emerald-400 ml-auto" />}
                          {agent.status === "error" && <AlertTriangle className="w-3 h-3 text-red-400 ml-auto" />}
                        </div>
                        {agent.output && <p className="text-[10px] text-zinc-500 mt-1 line-clamp-2">{agent.output}</p>}
                      </div>
                    ))}
                  </div>
                )}
                {teamSummary && (
                  <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2 space-y-1">
                    <p className="text-xs font-medium text-emerald-300">Team Complete</p>
                    <div className="grid grid-cols-2 gap-1 text-[10px]">
                      <span className="text-zinc-500">Files: <span className="text-zinc-300">{teamSummary.filesCreated}</span></span>
                      <span className="text-zinc-500">Issues: <span className="text-zinc-300">{teamSummary.totalIssues}</span></span>
                    </div>
                    <button onClick={async () => {
                      try {
                        const res = await fetch("/api/agent/team/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ artifacts: teamSummary.artifacts }) });
                        if (!res.ok) { toast.error("Download failed"); return; }
                        const data = await res.json();
                        for (const f of data.files ?? []) {
                          const blob = new Blob([f.content], { type: "text/plain" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url; a.download = f.name; a.click();
                          URL.revokeObjectURL(url);
                          await new Promise(r => setTimeout(r, 200));
                        }
                        toast.success(`Downloaded ${data.files?.length ?? 0} file(s)`);
                      } catch { toast.error("Download failed"); }
                    }} className="w-full mt-1 py-1 rounded-lg bg-emerald-600/20 text-emerald-300 text-[10px] font-medium border border-emerald-500/20 flex items-center justify-center gap-1">
                      <Download className="w-3 h-3" />Download Files
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Memory Panel */}
            {showMemory && (
              <div className="space-y-2 mt-2">
                <p className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-emerald-400" />Long-Term Memory
                  {memoryStats && <span className="text-emerald-400 text-[10px]">({memoryStats.total})</span>}
                </p>
                <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 overflow-hidden">
                  <textarea value={newMemoryContent} onChange={e => setNewMemoryContent(e.target.value)}
                    placeholder="Add a memory..." rows={2}
                    className="w-full bg-transparent px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none resize-none" />
                  <div className="flex items-center gap-2 px-2 py-1.5 border-t border-zinc-700/50">
                    <select value={newMemoryType} onChange={e => setNewMemoryType(e.target.value)}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-[10px] text-zinc-300 focus:outline-none">
                      <option value="preference">Preference</option>
                      <option value="project">Project</option>
                      <option value="error">Error/Fix</option>
                      <option value="feedback">Feedback</option>
                      <option value="fact">Fact</option>
                    </select>
                    <button disabled={!newMemoryContent.trim()} onClick={() => {
                      fetch("/api/memory/store", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: newMemoryContent.trim(), type: newMemoryType }) })
                        .then(r => r.json()).then(data => { if (data.success) { setMemoryEntries(prev => [data.entry, ...prev]); setNewMemoryContent(""); toast.success("Memory saved"); } });
                    }} className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[10px] font-medium transition-all">Save</button>
                  </div>
                </div>
                {isLoadingMemory && <div className="flex items-center gap-1.5 text-xs text-zinc-500"><Loader2 className="w-3 h-3 animate-spin" />Loading...</div>}
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {memoryEntries.map((entry: any) => (
                    <div key={entry.id} className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 px-3 py-2 flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          entry.type === "preference" ? "bg-blue-500/10 text-blue-400" :
                          entry.type === "error" ? "bg-red-500/10 text-red-400" :
                          entry.type === "project" ? "bg-violet-500/10 text-violet-400" :
                          entry.type === "feedback" ? "bg-amber-500/10 text-amber-400" :
                          "bg-emerald-500/10 text-emerald-400"
                        }`}>{entry.type}</span>
                        <p className="text-[10px] text-zinc-400 mt-1 leading-relaxed">{entry.content}</p>
                      </div>
                      <button onClick={() => { fetch(`/api/memory/${entry.id}`, { method: "DELETE" }).then(() => { setMemoryEntries(prev => prev.filter(e => e.id !== entry.id)); toast.success("Deleted"); }); }}
                        className="text-zinc-700 hover:text-red-400 transition-colors flex-shrink-0"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Goals Panel */}
            {showGoalPanel && (
              <div className="space-y-2 mt-2">
                <p className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5"><Target className="w-3.5 h-3.5 text-sky-400" />Goals</p>
                <div className="flex gap-2">
                  <input value={newGoalTitle} onChange={e => setNewGoalTitle(e.target.value)}
                    placeholder="New goal title..." onKeyDown={e => { if (e.key === "Enter") handleCreateGoal(); }}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-sky-500/50" />
                  <button onClick={handleCreateGoal} disabled={!newGoalTitle.trim()}
                    className="px-2 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium disabled:opacity-50 transition-all">Add</button>
                </div>
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {goals.map((goal: any) => (
                    <div key={goal.id} className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 px-3 py-2 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs text-zinc-200 font-medium leading-snug">{goal.title}</p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                          goal.status === "completed" ? "bg-emerald-500/10 text-emerald-400" :
                          goal.status === "in_progress" ? "bg-blue-500/10 text-blue-400" :
                          "bg-zinc-700 text-zinc-500"
                        }`}>{goal.status}</span>
                      </div>
                      <div className="flex gap-1">
                        {goal.status === "pending" && <button onClick={() => handleStartGoal(goal.id)} className="text-[10px] px-2 py-0.5 rounded bg-blue-600/20 text-blue-300 hover:bg-blue-600/30">Start</button>}
                        {goal.status === "in_progress" && <button onClick={() => handleCompleteGoal(goal.id)} className="text-[10px] px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30">Complete</button>}
                        <button onClick={() => handleDecomposeGoal(goal.id)} className="text-[10px] px-2 py-0.5 rounded bg-violet-600/20 text-violet-300 hover:bg-violet-600/30">Decompose</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Health Monitor */}
            {showMonitorPanel && (
              <div className="space-y-2 mt-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-red-400" />Health Monitor</p>
                  <div className="flex gap-1">
                    <button onClick={handleStartMonitor} className="text-[10px] px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30">Start</button>
                    <button onClick={handleStopMonitor} className="text-[10px] px-2 py-0.5 rounded bg-red-600/20 text-red-300 hover:bg-red-600/30">Stop</button>
                  </div>
                </div>
                {healthReport && (
                  <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 px-3 py-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${healthReport.status === "healthy" ? "bg-emerald-400" : healthReport.status === "degraded" ? "bg-amber-400" : "bg-red-400"}`} />
                      <span className="text-xs font-medium text-zinc-200 capitalize">{healthReport.status}</span>
                    </div>
                    {healthReport.metrics && (
                      <div className="grid grid-cols-2 gap-1 text-[10px]">
                        {Object.entries(healthReport.metrics).slice(0, 6).map(([k, v]: [string, any]) => (
                          <span key={k} className="text-zinc-500">{k}: <span className="text-zinc-300">{typeof v === "number" ? v.toFixed(1) : String(v)}</span></span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {monitorAlerts.length > 0 && (
                  <div className="space-y-1">
                    {monitorAlerts.slice(0, 3).map((alert: any, i: number) => (
                      <div key={i} className="rounded-lg bg-red-500/5 border border-red-500/20 px-2 py-1.5">
                        <p className="text-[10px] text-red-300">{alert.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Self-Improve Panel */}
            {showSelfImprove && (
              <div className="space-y-2 mt-2">
                <p className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-orange-400" />Self-Improve</p>
                <select value={selectedSelfFile} onChange={e => setSelectedSelfFile(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300 focus:outline-none">
                  {selfImproveFiles.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <input value={selfImproveArea} onChange={e => setSelfImproveArea(e.target.value)}
                  placeholder="Focus area (optional)"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/50" />
                <button disabled={isAnalyzing || !selectedSelfFile} onClick={async () => {
                  setIsAnalyzing(true); setActiveProposal(null);
                  try {
                    const res = await fetch("/api/self/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: selectedSelfFile, area: selfImproveArea || undefined }) });
                    const data = await res.json();
                    if (data.proposal) { setActiveProposal(data.proposal); setSelfProposals(prev => [data.proposal, ...prev]); toast.success("Proposal ready"); }
                    else toast.error(data.error ?? "Analysis failed");
                  } catch { toast.error("Analysis failed"); } finally { setIsAnalyzing(false); }
                }} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-orange-600/20 text-orange-300 border border-orange-500/30 text-xs font-medium hover:bg-orange-600/30 transition-all disabled:opacity-50">
                  {isAnalyzing ? <><Loader2 className="w-3 h-3 animate-spin" />Analyzing...</> : <><Sparkles className="w-3 h-3" />Analyze & Propose</>}
                </button>
                {activeProposal && (
                  <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 px-3 py-2.5 space-y-2">
                    <p className="text-xs font-medium text-zinc-200">{activeProposal.title}</p>
                    <div className="flex gap-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeProposal.impact === "high" ? "bg-red-500/10 text-red-400" : activeProposal.impact === "medium" ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"}`}>{activeProposal.impact}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-400">{activeProposal.category}</span>
                    </div>
                    <p className="text-[10px] text-zinc-500 leading-relaxed">{activeProposal.rationale}</p>
                    <details><summary className="text-[10px] text-orange-400 cursor-pointer">View diff</summary>
                      <pre className="mt-1 text-[9px] text-zinc-500 overflow-x-auto max-h-32 overflow-y-auto bg-zinc-900 rounded p-2 whitespace-pre-wrap">{activeProposal.diff}</pre>
                    </details>
                    <div className="flex gap-1.5">
                      <button onClick={async () => {
                        try {
                          const res = await fetch("/api/self/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposalId: activeProposal.id }) });
                          const data = await res.json();
                          if (data.success) { toast.success("Improvement applied"); setActiveProposal(null); }
                          else toast.error(data.error ?? "Apply failed");
                        } catch { toast.error("Apply failed"); }
                      }} className="flex-1 py-1 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-[10px] font-medium transition-all">Apply</button>
                      <button onClick={() => setActiveProposal(null)} className="flex-1 py-1 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-[10px] font-medium transition-all">Dismiss</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Workspace Panel */}
            {showWorkspace && (
              <div className="space-y-2 mt-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5"><FolderOpen className="w-3.5 h-3.5 text-cyan-400" />Workspace</p>
                  <button onClick={() => { setIsLoadingWorkspace(true); fetch("/api/workspace/files").then(r => r.json()).then(data => { setWorkspaceFiles(data.files ?? []); setIsLoadingWorkspace(false); }).catch(() => setIsLoadingWorkspace(false)); }}
                    className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20">Refresh</button>
                </div>
                {isLoadingWorkspace ? (
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500"><Loader2 className="w-3 h-3 animate-spin" />Loading...</div>
                ) : workspaceFiles.length === 0 ? (
                  <p className="text-xs text-zinc-600">No files in workspace</p>
                ) : (
                  <div className="space-y-1 max-h-56 overflow-y-auto">
                    {workspaceFiles.map((f: any) => (
                      <div key={f.name} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-800 group cursor-pointer"
                        onClick={() => {
                          if (!f.isDirectory) {
                            fetch(`/api/workspace/file?name=${encodeURIComponent(f.name)}`).then(r => r.json()).then(data => setWorkspaceViewFile({ name: f.name, content: data.content ?? "" }));
                          }
                        }}>
                        {f.isDirectory ? <FolderOpen className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" /> : <FileText className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />}
                        <span className="text-xs text-zinc-400 truncate flex-1">{f.name}</span>
                        {!f.isDirectory && (
                          <button onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await fetch(`/api/workspace/file?name=${encodeURIComponent(f.name)}`, { method: "DELETE" });
                              setWorkspaceFiles(prev => prev.filter(wf => wf.name !== f.name));
                              toast.success("File deleted");
                            } catch { toast.error("Delete failed"); }
                          }} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all">
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {workspaceViewFile && (
                  <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/50">
                      <span className="text-[10px] font-medium text-zinc-300 truncate">{workspaceViewFile.name}</span>
                      <button onClick={() => setWorkspaceViewFile(null)} className="text-zinc-600 hover:text-zinc-300"><X className="w-3 h-3" /></button>
                    </div>
                    <pre className="p-3 text-[10px] text-zinc-400 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-words">{workspaceViewFile.content}</pre>
                  </div>
                )}
              </div>
            )}

            {/* Code Executor in right panel */}
            {showCodeExecutor && <PanelErrorBoundary panelName="Code Executor"><CodeExecutorPanel /></PanelErrorBoundary>}

            {/* Image Generator in right panel */}
            {showImageGen && <PanelErrorBoundary panelName="Image Generator"><ImageGenPanel initialPrompt={query} /></PanelErrorBoundary>}
          </div>
        </aside>
      )}

      {/* ─── MAIN CONTENT ──────────────────────────────────────────────────── */}
      <main
        className="flex-1 flex flex-col min-h-screen transition-all duration-300"
        style={{
          marginLeft: leftSidebarOpen ? "260px" : "56px",
          marginRight: rightPanelOpen ? "288px" : "0px",
          position: "relative",
          zIndex: 1,  // v8.6.0: must be above ThemeCanvas (z-index:0) so answer text is visible
        }}
      >
        {/* ─── CHAT AREA ────────────────────────────────────────────────────── */}
        {/* v8.6.0: semi-transparent backdrop so text is readable over the video background */}
        <div className="flex-1 overflow-y-auto pb-56" style={{ background: "rgba(13,13,13,0.55)" }}>
          {/* v5.38: Agent Mode active banner */}
          {isAgentMode && (
            <div className="sticky top-0 z-20 px-4 py-2 border-b border-cyan-500/20" style={{ background: 'linear-gradient(to right, rgba(6,182,212,0.05), rgba(6,182,212,0.02))' }}>
              <div className="max-w-3xl mx-auto flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-xs font-semibold text-cyan-300">Agent Mode Active</span>
                </div>
                <span className="text-[10px] text-zinc-600">ReAct tool-calling engine · Full filesystem access</span>
                {isReactRunning && (
                  <span className="ml-auto flex items-center gap-1.5 text-[10px] text-cyan-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Working...
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Empty state / welcome */}
          {!query && !isStreaming && !aiAnswer && (
            <div className="flex flex-col items-center justify-center min-h-[70vh] px-6">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${isAgentMode ? 'bg-cyan-500/20' : 'bg-violet-500/20'}`}>
                {isAgentMode ? <Bot className="w-6 h-6 text-cyan-400" /> : <Sparkles className="w-6 h-6 text-violet-400" />}
              </div>
              <h1 className="text-2xl font-semibold text-white mb-2">
                {isAgentMode ? 'Agent Ready' : 'How can Andromeda help?'}
              </h1>
              <p className="text-sm text-zinc-500 text-center max-w-md">
                {isAgentMode
                  ? 'Assign a coding task — I\'ll read files, write code, run commands, and iterate until it\'s done.'
                  : 'Ask anything — search the web, analyze files, run code, generate images, or use agent tools.'
                }
              </p>
              {isAgentMode && (
                <div className="mt-4 grid grid-cols-2 gap-2 max-w-sm w-full">
                  {['Create a React component', 'Fix bugs in my code', 'Refactor this project', 'Write unit tests'].map(suggestion => (
                    <button key={suggestion} onClick={() => { setInputValue(suggestion); bottomInputRef.current?.focus(); }}
                      className="px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-xs text-zinc-400 hover:text-cyan-300 hover:border-cyan-500/30 transition-all text-left">
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
              {attachedFile && (
                <div className="mt-6 w-full max-w-md">
                  <FileAttachmentPreview file={attachedFile} onRemove={() => { setAttachedFile(null); setIsFileMode(false); }} />
                </div>
              )}
            </div>
          )}

          {/* Thread of prior turns */}
          {thread.map((turn, i) => (
            <div key={i} className="border-b border-zinc-800/40">
              {/* User message */}
              <div className="max-w-3xl mx-auto px-6 py-5">
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-semibold text-zinc-300 flex-shrink-0 mt-0.5">
                    {user?.name?.[0]?.toUpperCase() ?? "U"}
                  </div>
                  <p className="text-sm text-zinc-200 leading-relaxed pt-1">{turn.query}</p>
                </div>
                {/* AI answer */}
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="prose prose-sm prose-invert max-w-none text-zinc-300 leading-relaxed">
                      <Streamdown>{turn.answer}</Streamdown>
                    </div>
                    {turn.sources.length > 0 && (
                      <details className="mt-3 group">
                        <summary className="text-xs text-zinc-600 cursor-pointer hover:text-zinc-400 flex items-center gap-1.5">
                          <Globe className="w-3 h-3" />{turn.sources.length} sources
                        </summary>
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {turn.sources.slice(0, 4).map((s, si) => <SourceCard key={si} source={s} index={si} />)}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Current query + response */}
          {query && (
            <div className="max-w-3xl mx-auto px-6 py-5">
              {/* User message bubble */}
              <div className="flex items-start gap-3 mb-6">
                <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-semibold text-zinc-300 flex-shrink-0 mt-0.5">
                  {user?.name?.[0]?.toUpperCase() ?? "U"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 leading-relaxed pt-1">{query}</p>
                  {attachedFile && (
                    <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-400">
                      <Paperclip className="w-3 h-3" />{attachedFile.name}
                    </div>
                  )}
                </div>
              </div>

              {/* AI response area */}
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  {(isStreaming || isLoadingSources) ? (
                    <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {/* Loading sources */}
                  {isLoadingSources && !isStreaming && !showProgress && (
                    <div className="flex items-center gap-2 text-sm text-zinc-500">
                      <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                      {isDeepMode ? "Running deep research…" : (filter === "web" || filter === "news" || filter === "academic") ? "Searching the web…" : "Thinking…"}
                    </div>
                  )}

                  {/* Multi-pass file engine progress (v5.12) */}
                  {enginePhase && (
                    <div className="mb-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                        <span className="text-xs font-medium text-violet-300 uppercase tracking-wider">
                          {enginePhase.phase === "indexing" && "Indexing"}
                          {enginePhase.phase === "indexed" && "Indexed"}
                          {enginePhase.phase === "selecting" && "Selecting"}
                          {enginePhase.phase === "selected" && "Selected"}
                          {enginePhase.phase === "loading" && "Loading"}
                          {enginePhase.phase === "compressed" && "Compressed"}
                          {enginePhase.phase === "analyzing" && "Analyzing"}
                          {enginePhase.phase === "editing" && "Editing"}
                          {enginePhase.phase === "applying" && "Applying"}
                          {enginePhase.phase === "repacking" && "Repacking"}
                        </span>
                      </div>
                      <p className="text-sm text-zinc-400">{enginePhase.message}</p>
                      {enginePhase.details?.paths && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {(enginePhase.details.paths as string[]).slice(0, 6).map((p: string, i: number) => (
                            <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-500 font-mono">
                              {p.split("/").pop()}
                            </span>
                          ))}
                          {(enginePhase.details.paths as string[]).length > 6 && (
                            <span className="text-xs text-zinc-600">+{(enginePhase.details.paths as string[]).length - 6} more</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Deep research tracker */}
                  {showProgress && <PanelErrorBoundary panelName="Deep Research"><DeepResearchTracker progress={deepProgress} /></PanelErrorBoundary>}

                  {/* v5.38: ReAct Agent live display — shows tool calls, results, and thinking in main content */}
                  {isAgentMode && reactEvents.length > 0 && (
                    <div className="mb-4 space-y-2">
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-4 h-4 text-cyan-400" />
                        <span className="text-sm font-semibold text-zinc-200">Agent</span>
                        {isReactRunning && <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />}
                        <div className="ml-auto flex items-center gap-3">
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            {reactEvents.filter(e => e.type === 'tool_call').length} actions
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
                            {reactEvents.filter(e => e.type === 'tool_call').length > 0 ? `Step ${reactEvents.filter(e => e.type === 'tool_call').slice(-1)[0]?.step ?? '?'}` : '...'}
                          </span>
                          {/* v6.15: Token usage badge from done event */}
                          {(() => { const doneEvt = reactEvents.find(e => e.type === 'done'); return doneEvt?.tokenUsage ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              {(doneEvt.tokenUsage.total ?? 0).toLocaleString()} tokens
                            </span>
                          ) : null; })()}
                          {/* v5.39: Agent control buttons */}
                          {isReactRunning && reactSessionId && (
                            <div className="flex items-center gap-1.5 ml-2">
                              <button
                                onClick={async () => {
                                  try {
                                    await fetch('/api/agent/react/pause', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ sessionId: reactSessionId }),
                                    });
                                  } catch {}
                                }}
                                className="text-[10px] px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 transition-colors"
                                title="Pause agent after current step"
                              >
                                ⏸ Pause
                              </button>
                              <button
                                onClick={async () => {
                                  try {
                                    await fetch('/api/agent/react/resume', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ sessionId: reactSessionId }),
                                    });
                                  } catch {}
                                }}
                                className="text-[10px] px-2 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors"
                                title="Resume paused agent"
                              >
                                ▶ Resume
                              </button>
                              <button
                                onClick={async () => {
                                  const instructions = prompt('Enter new instructions for the agent:');
                                  if (!instructions) return;
                                  try {
                                    await fetch('/api/agent/react/steer', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ sessionId: reactSessionId, instructions }),
                                    });
                                  } catch {}
                                }}
                                className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
                                title="Redirect agent with new instructions"
                              >
                                ↪ Redirect
                              </button>
                              <button
                                onClick={async () => {
                                  try {
                                    await fetch('/api/agent/react/interrupt', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ sessionId: reactSessionId, reason: 'User stopped the agent' }),
                                    });
                                  } catch {}
                                }}
                                className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                                title="Stop agent immediately"
                              >
                                ■ Stop
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="rounded-xl border border-cyan-500/20 bg-zinc-900/50 divide-y divide-zinc-800/50 max-h-[600px] overflow-y-auto">
                        {reactEvents.map((evt, i) => {
                          if (evt.type === 'thinking') {
                            const isLast = i === reactEvents.length - 1;
                            const hasContent = evt.content && evt.content !== 'Reasoning about next action...';
                            return (
                            <div key={i} className="px-4 py-2.5 animate-fadeIn">
                              <div
                                className="flex items-center gap-3 cursor-pointer group"
                                onClick={(e) => { const det = (e.currentTarget.nextElementSibling as HTMLElement); if (det) det.classList.toggle('hidden'); }}
                              >
                                <div className="relative flex items-center justify-center w-5 h-5 flex-shrink-0">
                                  {isLast && isReactRunning ? (
                                    <>
                                      <div className="absolute inset-0 rounded-full bg-violet-500/20 animate-ping" />
                                      <div className="relative w-2.5 h-2.5 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 animate-pulse" />
                                    </>
                                  ) : (
                                    <div className="w-2.5 h-2.5 rounded-full bg-violet-400/40" />
                                  )}
                                </div>
                                <span className="text-xs text-zinc-400 font-medium flex-1 truncate">
                                  {hasContent ? evt.content!.slice(0, 120) : 'Reasoning...'}
                                </span>
                                {hasContent && (
                                  <span className="text-[10px] text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">expand</span>
                                )}
                              </div>
                              {hasContent && (
                                <div className="hidden mt-1.5 ml-8 text-[11px] text-zinc-500 bg-zinc-800/40 rounded-lg px-3 py-2 border border-zinc-700/30 whitespace-pre-wrap max-h-40 overflow-y-auto">
                                  {evt.content}
                                </div>
                              )}
                            </div>
                          );}
                          if (evt.type === 'step_start') return (
                            <div key={i} className="px-4 py-1 animate-fadeIn">
                              <div className="flex items-center gap-2">
                                <div className="h-px flex-1 bg-zinc-800/60" />
                                <span className="text-[10px] text-zinc-600 px-2 font-mono">Step {evt.step ?? i}</span>
                                <div className="h-px flex-1 bg-zinc-800/60" />
                              </div>
                            </div>
                          );
                          if (evt.type === 'tool_call') {
                            const toolSummary = (() => {
                              const name = evt.toolName || '';
                              const args = evt.toolArgs || {};
                              if (name === 'read_file' || name === 'read_file_lines') return `Reading ${args.path || 'file'}`;
                              if (name === 'write_file' || name === 'edit_file') return `Writing ${args.path || 'file'}`;
                              if (name === 'bash_execute') return `Running command`;
                              if (name === 'web_search') return `Searching: ${args.query || ''}`;
                              if (name === 'browser_navigate') return `Browsing: ${args.url || ''}`;
                              if (name === 'tree_view') return `Viewing directory structure`;
                              if (name === 'project_context') return `Loading project context`;
                              if (name === 'search_files') return `Searching files for: ${args.pattern || args.query || ''}`;
                              if (name === 'move_file') return `Moving ${args.source || 'file'}`;
                              if (name === 'delete_file') return `Deleting ${args.path || 'file'}`;
                              if (name === 'list_directory') return `Listing directory`;
                              if (name === 'append_file') return `Appending to ${args.path || 'file'}`;
                              return name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
                            })();
                            return (
                            <div key={i} className="px-4 py-2 animate-fadeIn group">
                              <div className="flex items-center gap-2.5 cursor-pointer" onClick={(e) => { const det = (e.currentTarget.nextElementSibling as HTMLElement); if (det) det.classList.toggle('hidden'); }}>
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                                <span className="text-xs text-zinc-300">{toolSummary}</span>
                                <span className="text-[10px] text-zinc-600 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">Step {evt.step} · click for details</span>
                              </div>
                              <pre className="hidden mt-1.5 text-[10px] text-zinc-500 bg-zinc-800/50 rounded-lg px-3 py-1.5 overflow-x-auto max-h-32 overflow-y-auto border border-zinc-700/30">{JSON.stringify(evt.toolArgs, null, 2)}</pre>
                            </div>
                          );
                          }
                          if (evt.type === 'tool_result') {
                            const isSuccess = evt.toolResult?.success !== false;
                            const isBrowser = (evt.toolName || '').includes('browser');
                            if (isBrowser && evt.toolName === 'browser_navigate' && isSuccess) {
                              const output = evt.toolResult?.output || '';
                              const urlMatch = output.match(/Navigated to: (.+)/);
                              const titleMatch = output.match(/Title: (.+)/);
                              const browserUrl = urlMatch ? urlMatch[1] : '';
                              const browserTitle = titleMatch ? titleMatch[1] : '';
                              return (
                              <div key={i} className="px-4 py-2.5 animate-fadeIn">
                                <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/80 overflow-hidden shadow-lg">
                                  {/* Browser chrome */}
                                  <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/80 border-b border-zinc-700/30">
                                    <div className="flex gap-1.5">
                                      <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                                      <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                                      <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                                    </div>
                                    <div className="flex-1 flex items-center gap-2 px-3 py-1 rounded-md bg-zinc-900/60 border border-zinc-700/30">
                                      <Globe className="w-3 h-3 text-zinc-500" />
                                      <span className="text-[11px] text-zinc-400 truncate">{browserUrl}</span>
                                    </div>
                                  </div>
                                  {/* Page content preview */}
                                  <div className="px-3 py-2.5">
                                    <p className="text-xs font-medium text-zinc-300 mb-1">{browserTitle}</p>
                                    <p className="text-[10px] text-zinc-500 line-clamp-2">{output.split('--- Page Content ---')[1]?.slice(0, 200) || ''}</p>
                                  </div>
                                </div>
                              </div>
                              );
                            }
                            return (
                            <div key={i} className="px-4 py-1.5 animate-fadeIn group">
                              <div className="flex items-center gap-2.5 cursor-pointer" onClick={(e) => { const det = (e.currentTarget.nextElementSibling as HTMLElement); if (det) det.classList.toggle('hidden'); }}>
                                <div className={`w-1.5 h-1.5 rounded-full ${isSuccess ? 'bg-emerald-400' : 'bg-red-400'}`} />
                                <span className={`text-xs ${isSuccess ? 'text-emerald-400/70' : 'text-red-400/70'}`}>{isSuccess ? '✓' : '✗'} {evt.toolName?.replace(/_/g, ' ')}</span>
                                <span className="text-[10px] text-zinc-600 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">click to expand</span>
                              </div>
                              <pre className="hidden mt-1.5 text-[10px] text-zinc-500 bg-zinc-800/30 rounded-lg px-3 py-1.5 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap border border-zinc-700/30">{typeof evt.toolResult === 'object' ? (evt.toolResult.output || evt.toolResult.error || JSON.stringify(evt.toolResult, null, 2)).slice(0, 3000) : String(evt.toolResult).slice(0, 3000)}</pre>
                            </div>
                          );
                          }
                          if (evt.type === 'text' || evt.type === 'response') return (
                            <div key={i} className="px-4 py-3">
                              <div className="text-sm text-zinc-200 prose prose-invert prose-sm max-w-none leading-relaxed">
                                <Streamdown>{evt.content || ''}</Streamdown>
                              </div>
                            </div>
                          );
                          if (evt.type === 'plan') return (
                            <div key={i} className="px-4 py-2.5">
                              <div className="flex items-center gap-2 mb-1">
                                <div className="w-2 h-2 rounded-full bg-violet-400" />
                                <span className="text-xs font-semibold text-violet-400">Plan</span>
                              </div>
                              {evt.plan && evt.plan.map((p: any, j: number) => (
                                <div key={j} className="text-[11px] text-zinc-400 ml-4">{p.id}. {p.title}</div>
                              ))}
                            </div>
                          );
                          if (evt.type === 'ask_human') return (
                            <div key={i} className="px-4 py-3 bg-amber-500/5">
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-2 h-2 rounded-full bg-amber-400" />
                                <span className="text-xs font-semibold text-amber-400">Agent needs your input</span>
                              </div>
                              <p className="text-sm text-zinc-300 mb-2">{evt.content}</p>
                              {reactHumanQuestion && (
                                <div className="flex gap-2">
                                  <input value={reactHumanAnswer} onChange={e => setReactHumanAnswer(e.target.value)}
                                    placeholder="Your response..." className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500/50"
                                    onKeyDown={e => { if (e.key === 'Enter') respondToReactAgent(); }} />
                                  <button onClick={respondToReactAgent} className="px-4 py-2 rounded-lg text-sm bg-amber-600 hover:bg-amber-500 text-white transition-colors">Send</button>
                                </div>
                              )}
                            </div>
                          );
                          if (evt.type === 'done') return (
                            <div key={i} className="px-4 py-3 bg-emerald-500/5 border-t border-emerald-500/20">
                              <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                                <span className="text-xs font-semibold text-emerald-400">Task Complete</span>
                                <span className="text-[10px] text-zinc-600">{evt.totalSteps} steps · {evt.tokenUsage ? `${evt.tokenUsage.total} tokens` : ''}</span>
                              </div>
                              {evt.summary && <p className="text-sm text-zinc-300 mt-2 leading-relaxed">{evt.summary}</p>}
                              {evt.filesModified && evt.filesModified.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {evt.filesModified.map((f: string, fi: number) => (
                                    <span key={fi} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">{f}</span>
                                  ))}
                                </div>
                              )}
                              {/* v5.38: Download workspace/directory as ZIP — like Manus */}
                              <div className="mt-3 flex gap-2">
                                <button
                                  onClick={async () => {
                                    try {
                                      // Use workingDir from the done event (detected by the engine)
                                      const dir = (evt as any).workingDir || '';
                                      const url = dir ? `/api/workspace/download-zip?dir=${encodeURIComponent(dir)}` : '/api/workspace/download-zip';
                                      const res = await fetch(url);
                                      if (!res.ok) {
                                        const err = await res.json().catch(() => ({ error: 'Download failed' }));
                                        toast.error(err.error || 'Download failed');
                                        return;
                                      }
                                      const blob = await res.blob();
                                      const a = document.createElement('a');
                                      a.href = URL.createObjectURL(blob);
                                      const disposition = res.headers.get('content-disposition') || '';
                                      const match = disposition.match(/filename="(.+?)"/);
                                      a.download = match ? match[1] : 'workspace.zip';
                                      document.body.appendChild(a);
                                      a.click();
                                      document.body.removeChild(a);
                                      URL.revokeObjectURL(a.href);
                                      toast.success('ZIP downloaded!');
                                    } catch { toast.error('Download failed'); }
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  Download as ZIP
                                </button>
                              </div>
                            </div>
                          );
                          if (evt.type === 'error') return (
                            <div key={i} className="px-4 py-2 bg-red-500/5">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-red-400" />
                                <span className="text-xs text-red-400">{evt.error || 'Unknown error'}</span>
                              </div>
                            </div>
                          );
                          {/* v5.39: Interrupt/Steer/Pause/Resume events */}
                          if (evt.type === 'interrupted') return (
                            <div key={i} className="px-4 py-3 bg-red-500/5">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-red-400" />
                                <span className="text-xs font-semibold text-red-400">■ Agent Interrupted</span>
                              </div>
                              <p className="text-xs text-zinc-400 mt-1 ml-4">{evt.content || 'Stopped by user.'}</p>
                            </div>
                          );
                          if (evt.type === 'redirected') return (
                            <div key={i} className="px-4 py-3 bg-cyan-500/5">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-cyan-400" />
                                <span className="text-xs font-semibold text-cyan-400">↪ Redirected</span>
                              </div>
                              <p className="text-xs text-zinc-400 mt-1 ml-4">New instructions: {evt.content}</p>
                            </div>
                          );
                          if (evt.type === 'paused') return (
                            <div key={i} className="px-4 py-2 bg-yellow-500/5">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-yellow-400" />
                                <span className="text-xs text-yellow-400">⏸ Agent Paused</span>
                              </div>
                            </div>
                          );
                          if (evt.type === 'resumed') return (
                            <div key={i} className="px-4 py-2 bg-green-500/5">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-green-400" />
                                <span className="text-xs text-green-400">▶ Agent Resumed</span>
                              </div>
                            </div>
                          );
                          return null;
                        })}
                      </div>
                    </div>
                  )}

                  {/* Legacy agent plan tracker (fallback) */}
                  {isAgentMode && agentSteps.length > 0 && reactEvents.length === 0 && (
                    <div className="mb-4">
                      <PanelErrorBoundary panelName="Agent Planner"><AgentPlanTracker steps={agentSteps} currentStep={agentCurrentStep} results={agentResults} isRunning={isAgentRunning} /></PanelErrorBoundary>
                    </div>
                  )}

                  {/* Error */}
                  {error && (
                    <div className="rounded-xl p-4 bg-red-500/5 border border-red-500/20 text-sm text-red-400">
                      {error}
                      <button onClick={() => runSearch(query)} className="ml-3 text-xs text-red-300 underline">Retry</button>
                    </div>
                  )}

                  {/* Sources row */}
                  {sources.length > 0 && (
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Globe className="w-3.5 h-3.5 text-zinc-600" />
                        <span className="text-xs text-zinc-600">{sources.length} sources</span>
                        {/* Filter buttons */}
                        <div className="ml-auto flex gap-1">
                          {FILTERS.map(f => (
                            <button key={f.value} onClick={() => handleFilterChange(f.value)}
                              className={`text-[10px] px-2 py-0.5 rounded-full transition-all ${
                                filter === f.value ? "bg-violet-500/20 text-violet-300 border border-violet-500/30" : "text-zinc-600 hover:text-zinc-400"
                              }`}>{f.label}</button>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {sources.slice(0, 4).map((s, i) => <SourceCard key={i} source={s} index={i} />)}
                      </div>
                      {sources.length > 4 && (
                        <details className="mt-2">
                          <summary className="text-xs text-zinc-600 cursor-pointer hover:text-zinc-400">+{sources.length - 4} more sources</summary>
                          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {sources.slice(4).map((s, i) => <SourceCard key={i + 4} source={s} index={i + 4} />)}
                          </div>
                        </details>
                      )}
                    </div>
                  )}

                  {/* AI answer */}
                  {(aiAnswer || isStreaming) && (
                    <div className="space-y-4">
                      {/* Grounding badge */}
                      {groundingConfidence !== null && !isStreaming && (
                        <div className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
                          groundingConfidence >= 0.7 ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                          : groundingConfidence >= 0.4 ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                          : "bg-red-500/10 border-red-500/20 text-red-400"
                        }`}>
                          <ShieldCheck className="w-3 h-3" />
                          {Math.round(groundingConfidence * 100)}% grounded
                          {unverifiedCount > 0 && <span className="text-zinc-500">· {unverifiedCount} unverified</span>}
                        </div>
                      )}

                      <div className="prose prose-sm prose-invert max-w-none text-zinc-300 leading-relaxed">
                        <Streamdown>{aiAnswer}</Streamdown>
                        {isStreaming && (
                          <span className="inline-block w-0.5 h-4 bg-violet-400 animate-pulse ml-0.5 align-text-bottom" />
                        )}
                      </div>

                      {/* Truncation continue */}
                      {isTruncated && !isStreaming && (
                        <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
                          <p className="text-xs text-amber-300 flex-1">Response was truncated due to length.</p>
                          <button data-auto-continue onClick={handleContinue} disabled={isStreaming}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-medium transition-all disabled:opacity-40">
                            <ChevronRight className="w-3.5 h-3.5" />Continue
                          </button>
                        </div>
                      )}

                      {/* Action buttons */}
                      {!isStreaming && aiAnswer && (
                        <div className="flex items-center gap-2 pt-1">
                          <button onClick={copyAnswer} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-all border border-transparent hover:border-zinc-700">
                            <Copy className="w-3.5 h-3.5" />Copy
                          </button>
                          <button onClick={exportMarkdown} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-all border border-transparent hover:border-zinc-700">
                            <Download className="w-3.5 h-3.5" />Export
                          </button>
                          <button onClick={shareSearch} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-all border border-transparent hover:border-zinc-700">
                            <Share2 className="w-3.5 h-3.5" />Share
                          </button>
                          <button onClick={handleModeToggle}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all border ${
                              isDeepMode ? "bg-purple-500/15 text-purple-300 border-purple-500/30 hover:bg-purple-500/25" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 border-transparent hover:border-zinc-700"
                            }`}>
                            <FlaskConical className="w-3.5 h-3.5" />{isDeepMode ? "Deep On" : "Deep Research"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Follow-up suggestions */}
                  {followUps.length > 0 && !isStreaming && !isFileMode && (
                    <div className="mt-4 space-y-2">
                      <p className="text-xs text-zinc-600">Suggested follow-ups</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {followUps.map((q) => (
                          <button key={q} onClick={() => handleFollowUp(q)}
                            className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/80 text-xs text-left text-zinc-400 hover:text-zinc-200 transition-all group">
                            <span className="line-clamp-1">{q}</span>
                            <CornerDownRight className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-violet-400" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* v5.10: Inline ZIP edit result card — replaces EditFilePanel */}
                  {zipEditResult && (
                    <div className="mt-4 rounded-xl border border-emerald-700/40 bg-emerald-950/20 overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-3 border-b border-emerald-700/30">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span className="text-sm font-medium text-emerald-300">{zipEditResult.editsApplied} edit{zipEditResult.editsApplied !== 1 ? "s" : ""} applied to {zipEditResult.fileName}</span>
                      </div>
                      <div className="p-4 space-y-3">
                        <p className="text-sm text-zinc-300">{zipEditResult.summary}</p>
                        {zipEditResult.log.slice(0, 8).map((l: string, i: number) => (
                          <p key={i} className={`text-xs font-mono ${
                            l.startsWith("EDIT:") ? "text-green-400" : l.startsWith("NEW:") ? "text-blue-400" : "text-zinc-500"
                          }`}>{l}</p>
                        ))}
                        <button
                          onClick={() => {
                            const binaryStr = atob(zipEditResult.editedZip);
                            const bytes = new Uint8Array(binaryStr.length);
                            for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                            const blob = new Blob([bytes], { type: "application/zip" });
                            const a = document.createElement("a");
                            a.href = URL.createObjectURL(blob);
                            a.download = `${zipEditResult.fileName.replace(/\.zip$/i, "")}_edited.zip`;
                            a.click();
                            toast.success("Edited ZIP downloaded");
                          }}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-all shadow-lg shadow-emerald-500/20"
                        >
                          <Download className="w-4 h-4" /> Download Edited ZIP
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div ref={threadBottomRef} />
        </div>

        {/* ─── BOTTOM INPUT BAR ─────────────────────────────────────────────── */}
        <div
          className="fixed bottom-0 z-30 px-2 sm:px-4 pb-safe-bottom pb-4 pt-6"
          style={{
            left: window.innerWidth < 640 ? 0 : leftSidebarOpen ? "260px" : "56px",
            right: window.innerWidth < 640 ? 0 : rightPanelOpen ? "288px" : "0px",
            paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 1rem)`,
            background: "linear-gradient(to bottom, transparent 0%, #0d0d0d 24%)",
          }}
        >
          {/* v5.10: Plan Mode preview card */}
          {(pendingPlan || isGeneratingPlan) && (
            <div className="max-w-3xl mx-auto mb-2">
              <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-amber-700/30">
                  <div className="flex items-center gap-2">
                    <ListChecks className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-medium text-amber-300">
                      {isGeneratingPlan ? "Generating plan…" : `Plan: ${pendingPlan?.title}`}
                    </span>
                  </div>
                  {pendingPlan && (
                    <span className="text-xs text-amber-500">{pendingPlan.estimatedDuration}</span>
                  )}
                </div>
                {pendingPlan && (
                  <div className="p-3 space-y-2">
                    {pendingPlan.steps.map((step) => (
                      <div key={step.id} className="flex items-start gap-2">
                        <span className="text-xs text-amber-600 font-mono w-4 flex-shrink-0">{step.id}.</span>
                        <div className="flex-1">
                          <span className="text-xs text-zinc-300">{step.description}</span>
                          <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            step.risk === "high" ? "bg-red-500/20 text-red-400" :
                            step.risk === "medium" ? "bg-amber-500/20 text-amber-400" :
                            "bg-emerald-500/20 text-emerald-400"
                          }`}>{step.risk}</span>
                          {!step.reversible && <span className="ml-1 text-[10px] text-zinc-600">⚠ irreversible</span>}
                        </div>
                      </div>
                    ))}
                    {pendingPlan.warnings.length > 0 && (
                      <div className="mt-2 p-2 rounded-lg bg-red-950/30 border border-red-700/30">
                        {pendingPlan.warnings.map((w, i) => (
                          <p key={i} className="text-xs text-red-400">⚠ {w}</p>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2 mt-3">
                      <button onClick={approvePlan}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium transition-all">
                        <Play className="w-3 h-3" /> Approve & Run
                      </button>
                      <button onClick={rejectPlan}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-all">
                        <X className="w-3 h-3" /> Cancel
                      </button>
                    </div>
                  </div>
                )}
                {isGeneratingPlan && (
                  <div className="p-3 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                    <span className="text-xs text-zinc-400">Analyzing task and generating execution plan…</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Attached file pill */}
          {attachedFile && (
            <div className="max-w-3xl mx-auto mb-2">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-300">
                <Paperclip className="w-3.5 h-3.5 text-zinc-500" />
                <span className="truncate max-w-xs">{attachedFile.name}</span>
                <span className="text-zinc-600">({(attachedFile.size / 1024).toFixed(1)} KB)</span>
                {extraFiles.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 text-[10px] font-medium">+{extraFiles.length} more</span>
                )}
                <button onClick={() => { setAttachedFile(null); setIsFileMode(false); setExtraFiles([]); }} className="text-zinc-600 hover:text-red-400 transition-colors ml-1">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          <div className="max-w-3xl mx-auto">
            <div
              className="rounded-2xl border border-zinc-700/60 overflow-hidden shadow-2xl"
              style={{ background: "#1a1a1a" }}
            >
              {/* Textarea */}
              <textarea
                ref={bottomInputRef}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (aiAnswer && !isFileMode && !isAgentMode) {
                      handleFollowUp(inputValue);
                    } else {
                      handleNewSearch(inputValue);
                    }
                  }
                }}
                placeholder={
                  isFileMode && attachedFile
                    ? `Ask about ${attachedFile.name}…`
                    : isAgentMode
                    ? "Assign a task to the agent…"
                    : isDeepMode
                    ? "Deep research query…"
                    : "Ask anything…"
                }
                rows={1}
                className="w-full bg-transparent px-4 pt-3.5 pb-1 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none resize-none leading-relaxed"
                style={{ minHeight: "52px", maxHeight: "200px" }}
              />

              {/* Bottom toolbar */}
              <div className="flex items-center justify-between px-3 pb-2.5 pt-1 gap-2">
                <div className="flex items-center gap-1">
                  {/* File attach */}
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} multiple />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-all"
                    title="Attach file (XML, JSON, code, image, ZIP)"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>

                  {/* Mode toggle: Deep Research */}
                  <button
                    onClick={handleModeToggle}
                    className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isDeepMode
                        ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                        : "text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800"
                    }`}
                    title="Toggle deep research mode"
                  >
                    <FlaskConical className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{isDeepMode ? "Deep" : "Deep"}</span>
                  </button>

                  {/* Agent mode toggle */}
                  <button
                    onClick={() => setIsAgentMode(v => !v)}
                    className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isAgentMode
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                        : "text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800"
                    }`}
                    title="Toggle agent mode"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Agent</span>
                  </button>

                  {/* Plan Mode toggle — hidden on mobile */}
                  <button
                    onClick={() => setIsPlanMode(v => !v)}
                    className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isPlanMode
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        : "text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800"
                    }`}
                    title="Plan Mode: show execution plan before running"
                  >
                    <ListChecks className="w-3.5 h-3.5" />
                    Plan
                  </button>

                  {/* v5.49: Manus-style model tier selector */}
                  {/* v5.99: Show warning when Auto is selected and input looks like self-improvement */}
                  {modelTier === "auto" && /self.?improv|self.?modif|self.?enhanc|look at your code|your code|your source|SOTA|autonomous|truncat/i.test(reactInput) && (
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      <span>⚠</span>
                      <span>Auto uses DeepSeek — switch to Code or Max for self-improvement</span>
                    </div>
                  )}
                  <div className="flex items-center gap-0.5 bg-zinc-800/60 border border-zinc-700/50 rounded-lg p-0.5">
                    {(["auto", "fast", "coding", "max"] as const).map((tier) => {
                      const labels: Record<string, { label: string; title: string }> = {
                        auto:   { label: "Auto",   title: "DeepSeek V3 — NOT recommended for self-improvement (hallucinates tool calls)" },
                        fast:   { label: "Fast",   title: "Gemini 2.5 Flash — fastest responses" },
                        coding: { label: "Code",   title: "Kimi k2.6 — best for coding & self-improvement (recommended)" },
                        max:    { label: "Max",    title: "Claude Opus 4.6 — highest quality" },
                      };
                      const isActive = modelTier === tier;
                      return (
                        <button
                          key={tier}
                          title={labels[tier].title}
                          onClick={async () => {
                            setModelTierState(tier);
                            localStorage.setItem("andromeda_tier", tier);
                            try {
                              await fetch("/api/llm/tier", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ tier }),
                              });
                            } catch { /* non-fatal */ }
                          }}
                          className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
                            isActive
                              ? tier === "auto"   ? "bg-zinc-600 text-zinc-100"
                              : tier === "fast"   ? "bg-emerald-500/20 text-emerald-300"
                              : tier === "coding" ? "bg-cyan-500/20 text-cyan-300"
                              :                    "bg-violet-500/20 text-violet-300"
                              : "text-zinc-600 hover:text-zinc-400"
                          }`}
                        >
                          {labels[tier].label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Stop button */}
                  {(isStreaming || isLoadingSources) && (
                    <button
                      onClick={() => { abortRef.current?.abort(); setIsStreaming(false); setIsLoadingSources(false); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-all"
                    >
                      <Pause className="w-3.5 h-3.5" />Stop
                    </button>
                  )}

                  {/* Send button */}
                  <button
                    onClick={() => {
                      if (aiAnswer && !isFileMode && !isAgentMode) {
                        handleFollowUp(inputValue);
                      } else {
                        handleNewSearch(inputValue);
                      }
                    }}
                    disabled={!inputValue.trim() || isStreaming || isLoadingSources}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-violet-500/20"
                  >
                    <SendHorizonal className="w-4 h-4" />
                    {aiAnswer && !isFileMode && !isAgentMode ? "Follow-up" : "Send"}
                  </button>
                </div>
              </div>
            </div>
            <p className="text-center text-[10px] text-zinc-700 mt-2">
              Andromeda v5.61 · Enter to send · Shift+Enter for new line · Ctrl+E for code executor · /compact to compress thread
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
