// v7.1.8 — SOTA UI rewrite
// Changes:
//   • History sidebar moved to LEFT (Manus/Claude pattern)
//   • Hero subtitle uses typewriter animation
//   • 4 primary feature cards + collapsible "More capabilities" grid
//   • Model selector moved to settings gear dropdown (clean search bar)
//   • Deep Research toggle moved into settings dropdown
//   • Nav: Chat link, RSI Dashboard link, settings gear
//   • Auto-clear search box after submit
//   • ManusDialog renamed to AndromedaDialog (no leftover Manus branding)
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  Search,
  Zap,
  Globe,
  History,
  ArrowRight,
  LogIn,
  FlaskConical,
  Paperclip,
  FileCode,
  X,
  MessageSquare,
  ImageIcon,
  Clock,
  Trash2,
  PanelLeftOpen,
  PanelLeftClose,
  Users,
  Brain,
  Wand2,
  Bot,
  ShieldCheck,
  Settings,
  ChevronDown,
  ChevronUp,
  Activity,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AmbientStatusBar } from "@/components/AmbientStatusBar";
import { ThemeCanvas } from "@/components/ThemeCanvas";
import { SkinSelector } from "@/components/SkinSelector";
import { getSavedSkin } from "@/lib/themeEngine";
import type { SkinId } from "@/lib/themeEngine";
import { skipToken } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { toast } from "sonner";
import JSZip from "jszip";
import { setRawZip } from "@/lib/zipStore";

const ENGINEER_LOGO = "https://d2xsxph8kpxj0f.cloudfront.net/114320538/CXRX5bpbYnFQmGG8voUpbs/andromeda_engineer_d67b9e19.png";
const LINE_DIVIDER  = "https://d2xsxph8kpxj0f.cloudfront.net/114320538/CXRX5bpbYnFQmGG8voUpbs/andromeda_divider_b14018b2.png";

const EXAMPLE_QUERIES = [
  "What are the latest breakthroughs in quantum computing?",
  "How does CRISPR gene editing work?",
  "Best practices for building scalable microservices",
  "Explain the James Webb Space Telescope discoveries",
  "What is the current state of AI regulation globally?",
];

// Typewriter phrases for the hero subtitle
const TYPEWRITER_PHRASES = [
  "Intelligence without limits.",
  "Search, research, and analyze.",
  "Powered by AI. Built to improve itself.",
  "Your always-on coding agent.",
];

const HISTORY_KEY = "andromeda_recent_searches";
const MAX_HISTORY  = 30;

interface RecentSearch {
  id: string;
  query: string;
  ts: number;
}

function loadRecentSearches(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as RecentSearch[]) : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(query: string): void {
  try {
    const existing = loadRecentSearches().filter((r) => r.query !== query);
    const updated: RecentSearch[] = [
      { id: Date.now().toString(), query, ts: Date.now() },
      ...existing,
    ].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch { /* ignore */ }
}

function clearRecentSearches(): void {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

interface AttachedFile {
  name: string;
  content: string;
  mimeType: string;
  size: number;
  preview?: string;
  rawBase64?: string;
}

// ── Typewriter hook ────────────────────────────────────────────────────────────
function useTypewriter(phrases: string[], speed = 55, pause = 2200) {
  const [displayed, setDisplayed] = useState("");
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const phrase = phrases[phraseIdx];
    let timeout: ReturnType<typeof setTimeout>;

    if (!deleting && charIdx < phrase.length) {
      timeout = setTimeout(() => setCharIdx((c) => c + 1), speed);
    } else if (!deleting && charIdx === phrase.length) {
      timeout = setTimeout(() => setDeleting(true), pause);
    } else if (deleting && charIdx > 0) {
      timeout = setTimeout(() => setCharIdx((c) => c - 1), speed / 2);
    } else if (deleting && charIdx === 0) {
      setDeleting(false);
      setPhraseIdx((i) => (i + 1) % phrases.length);
    }

    setDisplayed(phrase.slice(0, charIdx));
    return () => clearTimeout(timeout);
  }, [charIdx, deleting, phraseIdx, phrases, speed, pause]);

  return displayed;
}

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [placeholder, setPlaceholder] = useState(EXAMPLE_QUERIES[0]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [deepMode, setDeepMode] = useState(false);
  const [model, setModel] = useState<"deepseek-chat" | "deepseek-reasoner">(() => {
    return (localStorage.getItem("andromeda_model") as "deepseek-chat" | "deepseek-reasoner") || "deepseek-chat";
  });
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showMoreCards, setShowMoreCards] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // LEFT sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>(() => loadRecentSearches());

  // Background skin
  const [currentSkin, setCurrentSkin] = useState<SkinId>(() => getSavedSkin());

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const typewriterText = useTypewriter(TYPEWRITER_PHRASES);

  // Close settings dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Debounced autocomplete
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const autocompleteInput = debouncedQuery.length >= 2 && attachedFiles.length === 0
    ? { prefix: debouncedQuery }
    : skipToken;
  const autocompleteQuery = trpc.search.autocomplete.useQuery(
    autocompleteInput,
    { staleTime: 5000 }
  );

  useEffect(() => {
    if (autocompleteQuery.data?.suggestions?.length) {
      setSuggestions(autocompleteQuery.data.suggestions);
      setShowSuggestions(true);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [autocompleteQuery.data]);

  // Rotate placeholder
  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % EXAMPLE_QUERIES.length;
      setPlaceholder(EXAMPLE_QUERIES[i]);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // "/" shortcut to focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Drag & drop
  useEffect(() => {
    const onDragOver = (e: DragEvent) => { e.preventDefault(); setIsDragging(true); };
    const onDragLeave = (e: DragEvent) => { if (!e.relatedTarget) setIsDragging(false); };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) processFile(file);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []); // eslint-disable-line

  const MAX_FILE_SIZE = 100 * 1024 * 1024;

  const processFile = useCallback(async (file: File) => {
    const mimeType = file.type || "application/octet-stream";
    const isImage = mimeType.startsWith("image/");
    const isZip = mimeType === "application/zip" || mimeType === "application/x-zip-compressed" || file.name.toLowerCase().endsWith(".zip");

    if (file.size > MAX_FILE_SIZE) {
      toast.error(`File too large: ${(file.size / (1024 * 1024)).toFixed(1)} MB exceeds the 100 MB limit.`);
      return;
    }

    if (isZip) {
      toast.loading(`Reading ZIP: ${file.name}…`, { id: "zip-load" });
      try {
        let arrayBuf: ArrayBuffer | null = null;
        let zip: JSZip | null = null;
        let lastErr: any;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (attempt > 0) await new Promise(r => setTimeout(r, 200 * attempt));
            arrayBuf = await file.arrayBuffer();
            zip = await JSZip.loadAsync(arrayBuf);
            break;
          } catch (e) {
            lastErr = e;
          }
        }
        if (!zip || !arrayBuf) throw lastErr;
        const entries: string[] = [];
        let fileCount = 0;
        const fileEntries: { path: string; content: string; priority: number }[] = [];
        const promises: Promise<void>[] = [];
        zip.forEach((relativePath, zipEntry) => {
          fileCount++;
          entries.push(relativePath);
          if (!zipEntry.dir) {
            const lower = relativePath.toLowerCase();
            const isText = /\.(ts|tsx|js|jsx|py|json|yaml|yml|md|txt|csv|html|css|sh|sql|xml|env|toml|ini|cfg|conf|log|gitignore|prettierrc|eslintrc)$/.test(lower);
            if (isText) {
              const skip = /node_modules|dist\/|pnpm-lock|package-lock|\.min\.|snapshot\.json|\.gitkeep/.test(lower);
              if (!skip) {
                const priority = /server\/(routers|db|ai|search|stream)|client\/src\/(pages|components\/(?!ui))/.test(lower) ? 1
                  : /server\/|client\/src\/(app|main|index|const)/.test(lower) ? 2
                  : /drizzle\/schema|package\.json|vite\.config|tsconfig/.test(lower) ? 3
                  : /\.test\.|spec\./.test(lower) ? 2
                  : 4;
                promises.push(
                  zipEntry.async("string").then((content) => {
                    const cap = priority <= 2 ? 80000 : priority === 3 ? 50000 : 30000;
                    const truncated = content.length > cap;
                    fileEntries.push({
                      path: relativePath,
                      content: truncated ? content.slice(0, cap) + `\n...[truncated ${((content.length - cap)/1024).toFixed(0)}KB more]` : content,
                      priority,
                    });
                  }).catch(() => {})
                );
              }
            }
          }
        });
        await Promise.all(promises);
        fileEntries.sort((a, b) => a.priority - b.priority);
        const TOTAL_CHAR_BUDGET = 3_500_000;
        let totalChars = 0;
        const textContents: string[] = [];
        let skippedCount = 0;
        for (const entry of fileEntries) {
          const block = `\n\n=== ${entry.path} ===\n${entry.content}`;
          if (totalChars + block.length > TOTAL_CHAR_BUDGET) {
            skippedCount++;
            continue;
          }
          textContents.push(block);
          totalChars += block.length;
        }
        const summary = `ZIP Archive: ${file.name}\nTotal files: ${fileCount} (${fileEntries.length} text files, ${skippedCount > 0 ? skippedCount + " skipped due to size limit" : "all included"})\n\nFile tree:\n${entries.slice(0, 120).join("\n")}${entries.length > 120 ? `\n... and ${entries.length - 120} more files` : ""}\n\nFile contents (${textContents.length} files, ~${(totalChars/1000).toFixed(0)}K chars):${textContents.join("")}`;
        const rawBytes = new Uint8Array(arrayBuf);
        let rawBinary = "";
        const CHUNK_SIZE = 8192;
        for (let i = 0; i < rawBytes.length; i += CHUNK_SIZE) {
          const slice = rawBytes.subarray(i, Math.min(i + CHUNK_SIZE, rawBytes.length));
          rawBinary += String.fromCharCode.apply(null, Array.from(slice));
        }
        const rawBase64 = btoa(rawBinary);
        setRawZip(file.name, rawBase64);
        setAttachedFiles((prev) => [...prev, { name: file.name, content: summary, mimeType: "application/zip", size: file.size, rawBase64 }]);
        toast.dismiss("zip-load");
        toast.success(`ZIP attached: ${file.name} (${fileCount} files)`);
        inputRef.current?.focus();
      } catch (err: any) {
        toast.dismiss("zip-load");
        console.error("[ZIP Load Error]", err);
        toast.error(`Could not read ZIP: ${file.name} — ${err?.message || "unknown error"}`);
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setAttachedFiles((prev) => [...prev, { name: file.name, content, mimeType, size: file.size, preview: isImage ? content : undefined }]);
      toast.success(`${isImage ? "Image" : "File"} attached: ${file.name}`);
      inputRef.current?.focus();
    };
    if (isImage) reader.readAsDataURL(file);
    else reader.readAsText(file);
  }, []);

  const IMAGE_INTENT_RE = /^(generate|create|draw|make|paint|render|show me|give me|design)\s+(an?\s+)?(image|picture|photo|illustration|artwork|art|drawing|painting|render|visualization)\s*(of|showing|depicting|with|:)?/i;

  const handleSearch = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setShowSuggestions(false);
    saveRecentSearch(trimmed);
    setRecentSearches(loadRecentSearches());
    // v7.1.8: Auto-clear search box after submit
    setQuery("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
    if (IMAGE_INTENT_RE.test(trimmed) && attachedFiles.length === 0) {
      navigate(`/search?q=${encodeURIComponent(trimmed)}&imageGen=1&model=${model}`);
      return;
    }
    if (attachedFiles.length > 0) {
      navigate(`/search?q=${encodeURIComponent(trimmed)}&fileMode=1`);
      const fileForStorage = { ...attachedFiles[0], rawBase64: undefined };
      try {
        sessionStorage.setItem("andromeda_attached_file", JSON.stringify(fileForStorage));
        if (attachedFiles.length > 1) {
          const extras = attachedFiles.slice(1).map(f => ({ ...f, rawBase64: undefined }));
          sessionStorage.setItem("andromeda_extra_files", JSON.stringify(extras));
        } else {
          sessionStorage.removeItem("andromeda_extra_files");
        }
        if (attachedFiles[0].rawBase64) {
          sessionStorage.setItem("andromeda_raw_zip_available", "1");
        }
      } catch {
        return;
      }
    } else if (deepMode) {
      navigate(`/search?q=${encodeURIComponent(trimmed)}&mode=deep&model=${model}`);
    } else {
      navigate(`/search?q=${encodeURIComponent(trimmed)}&model=${model}`);
    }
  }, [navigate, attachedFiles, deepMode, model]);

  const toggleModel = () => {
    const next = model === "deepseek-chat" ? "deepseek-reasoner" : "deepseek-chat";
    setModel(next);
    localStorage.setItem("andromeda_model", next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (activeSuggestion >= 0 && suggestions[activeSuggestion]) handleSearch(suggestions[activeSuggestion]);
      else handleSearch(query);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSuggestion((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestion((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files ?? []).forEach((f) => processFile(f));
    e.target.value = "";
  };

  const handleDeleteHistoryItem = (id: string) => {
    try {
      const updated = loadRecentSearches().filter((r) => r.id !== id);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      setRecentSearches(updated);
    } catch { /* ignore */ }
  };

  const handleClearHistory = () => {
    clearRecentSearches();
    setRecentSearches([]);
    toast.success("Search history cleared");
  };

  // ── Primary feature cards (4 shown by default) ────────────────────────────
  const PRIMARY_CARDS = [
    { icon: Globe,        title: "Web Search",    desc: "Real-time results via Brave API",          action: () => navigate("/search"),                color: "text-blue-400",   bg: "bg-blue-500/10",   hover: "hover:border-blue-500/40" },
    { icon: Bot,          title: "Agent Mode",    desc: "AI plans & executes multi-step tasks",     action: () => navigate("/search?panel=agent"),    color: "text-violet-400", bg: "bg-violet-500/10", hover: "hover:border-violet-500/40" },
    { icon: FlaskConical, title: "Deep Research", desc: "Parallel multi-query synthesis",           action: () => navigate("/search?deep=1"),          color: "text-purple-400", bg: "bg-purple-500/10", hover: "hover:border-purple-500/40" },
    { icon: Wand2,        title: "Self-Improve",  desc: "Andromeda proposes its own upgrades",      action: () => navigate("/search?panel=improve"),  color: "text-amber-400",  bg: "bg-amber-500/10",  hover: "hover:border-amber-500/40" },
  ];

  // ── Secondary cards (revealed via "More" button) ───────────────────────────
  const MORE_CARDS = [
    { icon: Users,      title: "Team Agent",    desc: "Architect → Coder → Debugger → Auditor",  action: () => navigate("/search?panel=team"),     color: "text-emerald-400", bg: "bg-emerald-500/10", hover: "hover:border-emerald-500/40" },
    { icon: Brain,      title: "Memory",        desc: "Remembers your style across sessions",     action: () => navigate("/search?panel=memory"),   color: "text-pink-400",    bg: "bg-pink-500/10",    hover: "hover:border-pink-500/40" },
    { icon: FileCode,   title: "File Analysis", desc: "Analyze code, images & ZIP archives",      action: () => navigate("/search"),                color: "text-green-400",   bg: "bg-green-500/10",   hover: "hover:border-green-500/40" },
    { icon: ShieldCheck,title: "Bias Detector", desc: "Source diversity & ownership labels",      action: () => navigate("/search"),                color: "text-cyan-400",    bg: "bg-cyan-500/10",    hover: "hover:border-cyan-500/40" },
    { icon: ImageIcon,  title: "Image Gen",     desc: "Generate images from text prompts",        action: () => navigate("/search?panel=image"),    color: "text-rose-400",    bg: "bg-rose-500/10",    hover: "hover:border-rose-500/40" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden">

      {/* ── Animated background canvas ─────────────────────────────────── */}
      <ThemeCanvas skin={currentSkin} />

      {/* ── Background skin selector (floating palette button) ─────────── */}
      <SkinSelector currentSkin={currentSkin} onSkinChange={setCurrentSkin} />

      {/* Drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-primary/10 border-2 border-dashed border-primary/50 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <Paperclip className="w-14 h-14 text-primary mx-auto mb-4" />
            <p className="text-xl font-semibold text-primary">Drop to analyze</p>
            <p className="text-sm text-muted-foreground mt-1">XML, JSON, code, images, text files</p>
          </div>
        </div>
      )}

      {/* ── LEFT History Sidebar ──────────────────────────────────────────── */}
      {/* Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {/* Sidebar panel — LEFT on desktop, bottom sheet on mobile */}
      <aside
        className={`fixed z-50 glass flex flex-col shadow-2xl transition-all duration-300
          sm:top-0 sm:left-0 sm:h-full sm:w-72 sm:border-r sm:border-border/50
          max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:h-[80vh] max-sm:rounded-t-2xl max-sm:border-t max-sm:border-border/50
          ${sidebarOpen
            ? "sm:translate-x-0 max-sm:translate-y-0"
            : "sm:-translate-x-full max-sm:translate-y-full"
          }`}
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-2 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-border/60" />
        </div>
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">Recent Searches</span>
          </div>
          <div className="flex items-center gap-2">
            {recentSearches.length > 0 && (
              <button
                onClick={handleClearHistory}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Clear all history"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Close sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sidebar body */}
        <div className="flex-1 overflow-y-auto py-2">
          {recentSearches.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
              <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center">
                <Search className="w-5 h-5 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">No searches yet.</p>
              <p className="text-xs text-muted-foreground/60">Your recent queries will appear here.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/30">
              {recentSearches.map((item) => (
                <li key={item.id} className="group flex items-start gap-2 px-4 py-3 hover:bg-accent/50 transition-colors">
                  <button
                    className="flex-1 text-left min-w-0"
                    onClick={() => {
                      setSidebarOpen(false);
                      handleSearch(item.query);
                    }}
                  >
                    <p className="text-sm text-foreground truncate leading-snug">{item.query}</p>
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5">{relativeTime(item.ts)}</p>
                  </button>
                  <button
                    onClick={() => handleDeleteHistoryItem(item.id)}
                    className="flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                    title="Remove"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Sidebar footer */}
        {isAuthenticated && (
          <div className="px-4 py-3 border-t border-border/40">
            <button
              onClick={() => { setSidebarOpen(false); navigate("/history"); }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-accent border border-border/40 hover:border-primary/30 transition-all"
            >
              <History className="w-3.5 h-3.5" />
              View full history
            </button>
          </div>
        )}
      </aside>

      {/* ── Navigation ──────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 glass border-b border-border/40">
        {/* Left: sidebar toggle + logo */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setSidebarOpen((o) => !o); setRecentSearches(loadRecentSearches()); }}
            className={`p-2 rounded-lg transition-colors relative ${
              sidebarOpen
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
            title="Recent searches"
          >
            <PanelLeftOpen className="w-4 h-4" />
            {recentSearches.length > 0 && !sidebarOpen && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary" />
            )}
          </button>
          <div className="w-7 h-7 rounded-lg overflow-hidden border border-border/50 bg-card flex-shrink-0">
            <img src={ENGINEER_LOGO} alt="Andromeda" className="w-full h-full object-cover" style={{ filter: "invert(1) brightness(0.85)" }} />
          </div>
          <span className="font-semibold text-base tracking-tight">Andromeda</span>
        </div>

        {/* Right: nav links + settings gear */}
        <div className="flex items-center gap-1 sm:gap-2">
          {isAuthenticated ? (
            <>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground px-2 sm:px-3" onClick={() => navigate("/chat")} title="Chat">
                <MessageSquare className="w-4 h-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Chat</span>
              </Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground px-2 sm:px-3" onClick={() => navigate("/rsi")} title="RSI Dashboard">
                <Activity className="w-4 h-4 sm:mr-1.5" />
                <span className="hidden sm:inline">RSI</span>
              </Button>
              <Button variant="ghost" size="sm" className="hidden sm:flex text-muted-foreground hover:text-foreground" onClick={() => navigate("/history")}>
                <History className="w-4 h-4 mr-1.5" />
                History
              </Button>
              <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-xs font-medium text-primary">
                {user?.name?.[0]?.toUpperCase() ?? "U"}
              </div>
            </>
          ) : (
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground px-2 sm:px-3" onClick={() => (window.location.href = getLoginUrl())} title="Sign in">
              <LogIn className="w-4 h-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Sign in</span>
            </Button>
          )}

          {/* Settings gear — contains model + deep mode toggles */}
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setShowSettings((s) => !s)}
              className={`p-2 rounded-lg transition-colors ${showSettings ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            {showSettings && (
              <div className="absolute right-0 top-full mt-2 w-56 glass rounded-xl border border-border/50 shadow-2xl z-50 p-2 animate-scale-in">
                <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-3 py-1.5">Model</p>
                {(["deepseek-chat", "deepseek-reasoner"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setModel(m); localStorage.setItem("andromeda_model", m); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${model === m ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
                  >
                    <Zap className="w-3.5 h-3.5 flex-shrink-0" />
                    {m === "deepseek-chat" ? "Chat (fast)" : "Reasoner (deep)"}
                    {model === m && <span className="ml-auto text-[10px] text-primary font-medium">active</span>}
                  </button>
                ))}
                <div className="h-px bg-border/40 my-1.5 mx-2" />
                <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-3 py-1.5">Search mode</p>
                <button
                  onClick={() => setDeepMode((d) => !d)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${deepMode ? "bg-purple-500/15 text-purple-300" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
                >
                  <FlaskConical className="w-3.5 h-3.5 flex-shrink-0" />
                  Deep Research
                  <span className={`ml-auto text-[10px] font-medium ${deepMode ? "text-purple-300" : "text-muted-foreground/50"}`}>
                    {deepMode ? "ON" : "OFF"}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <main className="flex flex-col items-center justify-center min-h-screen px-4 pt-16 relative">

        {/* Background handled by ThemeCanvas — see ThemeCanvas.tsx */}

        {/* Engineer bust logo */}
        <div className="relative mb-6 animate-slide-up">
          <div className="relative w-36 h-36 md:w-48 md:h-48">
            <div className="absolute inset-0 rounded-full opacity-20 animate-pulse-glow" style={{ background: "radial-gradient(circle, oklch(0.62 0.22 265) 0%, transparent 70%)" }} />
            <div className="absolute inset-2 rounded-full border border-primary/20" />
            <div className="absolute inset-4 rounded-full border border-border/30" />
            <div className="absolute inset-6 rounded-full overflow-hidden border border-border/40 bg-card/50 backdrop-blur-sm">
              <img src={ENGINEER_LOGO} alt="Andromeda — The Engineer" className="w-full h-full object-cover object-top" style={{ filter: "invert(1) brightness(0.9) contrast(1.1)" }} />
            </div>
            <div className="absolute top-3 right-3 w-4 h-4 rounded-full bg-primary/40 border border-primary/60 flex items-center justify-center">
              <Zap className="w-2 h-2 text-primary" />
            </div>
          </div>
        </div>

        {/* Title + typewriter subtitle */}
        <div className="text-center mb-8 animate-slide-up" style={{ animationDelay: "0.05s" }}>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-3">
            <span className="gradient-text">Andromeda</span>
          </h1>
          <div className="flex items-center justify-center gap-4 my-4">
            <div className="h-px flex-1 max-w-[80px] bg-gradient-to-r from-transparent to-border/60" />
            <img src={LINE_DIVIDER} alt="" className="h-5 w-40 object-contain opacity-30" style={{ filter: "invert(1)" }} />
            <div className="h-px flex-1 max-w-[80px] bg-gradient-to-l from-transparent to-border/60" />
          </div>
          {/* Typewriter subtitle */}
          <p className="text-base md:text-lg text-muted-foreground max-w-sm mx-auto leading-relaxed min-h-[1.75rem]">
            {typewriterText}
            <span className="inline-block w-0.5 h-4 bg-primary/70 ml-0.5 animate-pulse align-middle" />
          </p>
        </div>

        {/* ── Search Bar ──────────────────────────────────────────────────── */}
        <div className="relative w-full max-w-2xl animate-slide-up" style={{ animationDelay: "0.1s" }}>
          {/* Attached files preview */}
          {attachedFiles.length > 0 && (
            <div className="mb-3 flex flex-col gap-1.5">
              {attachedFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-2 px-4 py-2.5 glass rounded-xl border border-primary/20">
                  {f.preview ? (
                    <img src={f.preview} alt={f.name} className="w-8 h-8 rounded object-cover flex-shrink-0" />
                  ) : (
                    <FileCode className="w-5 h-5 text-green-400 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{f.name}</p>
                    <p className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="relative gradient-border rounded-2xl">
            <div className="relative flex items-center bg-card rounded-2xl overflow-visible">
              <Search className="absolute left-5 w-5 h-5 text-muted-foreground pointer-events-none z-10" />
              <textarea
                ref={inputRef}
                rows={1}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveSuggestion(-1);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
                }}
                onKeyDown={handleKeyDown}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder={attachedFiles.length > 0 ? `Ask about ${attachedFiles.map(f => f.name).join(", ")}…` : placeholder}
                className="w-full bg-transparent pl-14 pr-36 py-5 text-base text-foreground placeholder:text-muted-foreground/60 outline-none resize-none overflow-hidden"
                autoComplete="off"
                spellCheck={true}
                style={{ minHeight: "3.5rem" }}
              />
              {/* Attach button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className={`absolute right-[7.5rem] p-2 rounded-lg transition-colors ${attachedFiles.length > 0 ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
                title="Attach files (multiple supported, drag & drop also works)"
              >
                <Paperclip className="w-4 h-4" />
                {attachedFiles.length > 1 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                    {attachedFiles.length}
                  </span>
                )}
              </button>
              <Button
                onClick={() => handleSearch(query)}
                disabled={!query.trim()}
                className="absolute right-2.5 rounded-xl px-4 py-2 h-10 bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-sm disabled:opacity-40"
              >
                {attachedFiles.length > 0 ? "Analyze" : "Search"}
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </div>
          </div>

          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} accept="*" />

          {/* Autocomplete dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 glass rounded-xl overflow-hidden z-50 shadow-2xl border border-border/50">
              {suggestions.map((s, i) => (
                <button key={s}
                  className={`w-full text-left px-5 py-3 text-sm flex items-center gap-3 transition-colors ${i === activeSuggestion ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                  onMouseDown={() => handleSearch(s)}>
                  <Search className="w-3.5 h-3.5 flex-shrink-0 opacity-50" />
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Hint bar */}
          <div className="flex items-center justify-between mt-3 px-1">
            <p className="text-xs text-muted-foreground/50">
              Press <kbd className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-xs font-mono">/</kbd> to focus · drag & drop files
            </p>
            {(deepMode || model === "deepseek-reasoner") && (
              <div className="flex items-center gap-1.5">
                {model === "deepseek-reasoner" && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-amber-500/15 text-amber-300 border border-amber-500/25">
                    <Zap className="w-3 h-3" /> Reasoner
                  </span>
                )}
                {deepMode && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-purple-500/15 text-purple-300 border border-purple-500/25">
                    <FlaskConical className="w-3 h-3" /> Deep Research
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Example queries */}
        <div className="mt-6 flex flex-wrap gap-2 justify-center max-w-2xl animate-slide-up" style={{ animationDelay: "0.2s" }}>
          {EXAMPLE_QUERIES.slice(0, 3).map((q) => (
            <button key={q} onClick={() => handleSearch(q)}
              className="px-3 py-1.5 rounded-full text-xs text-muted-foreground border border-border/50 hover:border-primary/40 hover:text-foreground hover:bg-primary/5 transition-all">
              {q.length > 50 ? q.slice(0, 50) + "…" : q}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="mt-10 w-full max-w-3xl flex items-center gap-4 animate-slide-up" style={{ animationDelay: "0.25s" }}>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border/40 to-transparent" />
          <img src={LINE_DIVIDER} alt="" className="h-4 w-32 object-contain opacity-20" style={{ filter: "invert(1)" }} />
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border/40 to-transparent" />
        </div>

        {/* ── Primary feature cards (4) ───────────────────────────────────── */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl w-full animate-slide-up" style={{ animationDelay: "0.3s" }}>
          {PRIMARY_CARDS.map(({ icon: Icon, title, desc, action, color, bg, hover }) => (
            <button
              key={title}
              onClick={action}
              className={`glass rounded-xl p-4 flex flex-col gap-2 border border-border/40 ${hover} transition-all group text-left`}
            >
              <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
            </button>
          ))}
        </div>

        {/* ── More capabilities toggle ────────────────────────────────────── */}
        <div className="mt-3 w-full max-w-3xl animate-slide-up" style={{ animationDelay: "0.35s" }}>
          <button
            onClick={() => setShowMoreCards((s) => !s)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
          >
            {showMoreCards ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {showMoreCards ? "Show less" : "More capabilities"}
          </button>

          {showMoreCards && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3 animate-slide-up">
              {MORE_CARDS.map(({ icon: Icon, title, desc, action, color, bg, hover }) => (
                <button
                  key={title}
                  onClick={action}
                  className={`glass rounded-xl p-3.5 flex flex-col gap-1.5 border border-border/40 ${hover} transition-all group text-left`}
                >
                  <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                    <Icon className={`w-3.5 h-3.5 ${color}`} />
                  </div>
                  <p className="text-xs font-medium text-foreground">{title}</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer accent */}
        <div className="mt-10 mb-6 flex items-center justify-center gap-3 opacity-15 animate-slide-up" style={{ animationDelay: "0.4s" }}>
          <img src={LINE_DIVIDER} alt="" className="h-3 w-48 object-contain" style={{ filter: "invert(1)" }} />
        </div>

      </main>

      {/* Ambient intelligence status bar — Phase 3 */}
      <AmbientStatusBar />

    </div>
  );
}
