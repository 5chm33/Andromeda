/**
 * Workspace.tsx — Unified Andromeda Workspace
 * Andromeda v11.0.0 — Phase 11: UI Overhaul
 *
 * The single-page, no-navigation workspace that merges the old Home + Chat pages.
 * Layout:
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  LEFT SIDEBAR (conversation history + nav)               │
 *   │  ┌──────────────────────────┬─────────────────────────┐  │
 *   │  │  MAIN CHAT AREA          │  ARTIFACT PANEL (right) │  │
 *   │  │  (messages scroll)       │  (code/html/rsi preview)│  │
 *   │  │                          │                         │  │
 *   │  ├──────────────────────────┴─────────────────────────┤  │
 *   │  │  BOTTOM PROMPT BAR (floating, auto-clear, auto-focus)│  │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Features:
 *   - Left sidebar: conversation history, nav links, agent status
 *   - Ambient orb: pulsing orb that reflects agent state
 *   - Artifact panel: auto-opens when code/HTML is generated
 *   - Bottom prompt bar: always visible, auto-clear, Enter to send
 *   - OLED dark mode: #09090B blacks with neon glow accents
 *   - RSI widget: inline ProposalTreeGraph when RSI cycle fires
 *   - Model selector: compact toggle in header
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import {
  Send,
  Trash2,
  Zap,
  MessageSquare,
  Square,
  Loader2,
  Plus,
  History,
  Clock,
  X,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Brain,
  Settings,
  LogIn,
  Paperclip,
  ImageIcon,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AmbientOrb, useOrbState } from "@/components/AmbientOrb";
import { ArtifactPanel, extractArtifact, type Artifact } from "@/components/ArtifactPanel";
import { ThemeCanvas } from "@/components/ThemeCanvas";
import { SkinSelector } from "@/components/SkinSelector";
import { getSavedSkin } from "@/lib/themeEngine";
import type { SkinId } from "@/lib/themeEngine";

const ENGINEER_LOGO =
  "https://d2xsxph8kpxj0f.cloudfront.net/114320538/CXRX5bpbYnFQmGG8voUpbs/andromeda_engineer_d67b9e19.png";

const SYSTEM_PROMPT = `You are Andromeda, an elite AI assistant and autonomous agent. You are helpful, knowledgeable, and direct. You give thorough, substantive answers. Use markdown formatting — headers, bold, code blocks — where appropriate. When writing substantial code (>20 lines), wrap it in a fenced code block with the language tag. Today's date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.`;

const EXAMPLE_PROMPTS = [
  "Explain quantum entanglement simply",
  "Write a Python script to sort a CSV by date",
  "Generate an image of a futuristic city at night",
  "What are the best practices for REST APIs?",
  "Show me the RSI dashboard",
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
  isStreaming?: boolean;
  artifact?: Artifact;
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CONV_STORAGE_KEY = "andromeda_conversations_v2";
const ACTIVE_CONV_KEY = "andromeda_active_conv";

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONV_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Conversation[]) : [];
  } catch { return []; }
}

function saveConversations(convs: Conversation[]): void {
  try {
    localStorage.setItem(CONV_STORAGE_KEY, JSON.stringify(convs.slice(0, 50)));
  } catch { /* ignore */ }
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// v12.3.3: Broad video detection — any phrasing that asks for a video/animation/clip
function isVideoRequest(text: string): boolean {
  const t = text.toLowerCase().trim();
  const videoWords = /\b(video|clip|animation|animated|movie|film|reel|footage|cinematic|motion|moving image|gif|short film|timelapse|time-lapse|slow motion|slo-mo|flythrough|fly-through|walkthrough|walk-through|pan shot|dolly shot)\b/;
  const actionWords = /\b(generate|create|make|produce|render|animate|film|shoot|record|show|give me|get me|can you|could you|please|i want|i need|i'd like|build|compose|craft)\b/;
  const durationPattern = /\b\d+\s*(?:second|sec|s|minute|min)\b/;
  return videoWords.test(t) && (actionWords.test(t) || durationPattern.test(t));
}

// v12.3.3: Broad image detection — any phrasing that asks for a picture/image/visual
function isImageRequest(text: string): boolean {
  const t = text.toLowerCase().trim();
  const imageWords = /\b(image|picture|photo|photograph|illustration|artwork|drawing|painting|portrait|landscape|wallpaper|poster|thumbnail|logo|icon|banner|graphic|visual|render|scene|sketch|cartoon|anime|realistic|digital art|concept art|3d render)\b/;
  const actionWords = /\b(generate|create|make|draw|paint|design|produce|render|show|give me|get me|can you|could you|please|i want|i need|i'd like|imagine|visualize|depict|illustrate|craft|build|compose)\b/;
  // Video takes priority — if it mentions video, don't treat as image
  if (isVideoRequest(t)) return false;
  return imageWords.test(t) && actionWords.test(t);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ImageMessage({ url }: { url: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="mt-2 rounded-xl overflow-hidden border border-border/40 max-w-md">
      {!loaded && (
        <div className="w-full h-48 bg-muted/30 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
        </div>
      )}
      <img
        src={url}
        alt="Generated"
        className={`w-full object-cover transition-opacity ${loaded ? "opacity-100" : "opacity-0 h-0"}`}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Workspace() {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  // ── Conversation state ──────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [activeConvId, setActiveConvId] = useState<string | null>(() => {
    const saved = localStorage.getItem(ACTIVE_CONV_KEY);
    const convs = loadConversations();
    return saved && convs.find(c => c.id === saved) ? saved : (convs[0]?.id ?? null);
  });

  const activeConv = conversations.find(c => c.id === activeConvId) ?? null;
  const messages = activeConv?.messages ?? [];

  // ── UI state ────────────────────────────────────────────────────────────────
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastError, setLastError] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [showRsiWidget, setShowRsiWidget] = useState(false);
  const [model, setModel] = useState<"deepseek-chat" | "deepseek-reasoner">(() => {
    return (localStorage.getItem("andromeda_model") as "deepseek-chat" | "deepseek-reasoner") || "deepseek-chat";
  });
  const [currentSkin, setCurrentSkin] = useState<SkinId>(() => getSavedSkin());

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const orbState = useOrbState(isLoading, isStreaming, false, lastError);

  // ── Persist conversations ───────────────────────────────────────────────────
  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    if (activeConvId) localStorage.setItem(ACTIVE_CONV_KEY, activeConvId);
  }, [activeConvId]);

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Auto-focus input ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isLoading, activeConvId]);

  // ── "/" shortcut ────────────────────────────────────────────────────────────
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

  // ── Conversation management ─────────────────────────────────────────────────

  const createNewConversation = useCallback((): string => {
    const id = `conv_${Date.now()}`;
    const conv: Conversation = {
      id,
      title: "New conversation",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations(prev => [conv, ...prev]);
    setActiveConvId(id);
    setActiveArtifact(null);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 100);
    return id;
  }, []);

  const deleteConversation = useCallback((convId: string) => {
    setConversations(prev => prev.filter(c => c.id !== convId));
    if (activeConvId === convId) {
      const remaining = conversations.filter(c => c.id !== convId);
      setActiveConvId(remaining[0]?.id ?? null);
    }
  }, [activeConvId, conversations]);

  const updateConversation = useCallback((convId: string, updater: (conv: Conversation) => Conversation) => {
    setConversations(prev => prev.map(c => c.id === convId ? updater(c) : c));
  }, []);

  // ── Send message ────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    // Ensure we have an active conversation
    let convId = activeConvId;
    if (!convId) {
      convId = createNewConversation();
    }

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: text,
    };

    // Auto-title the conversation from first message
    const isFirstMessage = (conversations.find(c => c.id === convId)?.messages.length ?? 0) === 0;
    const title = isFirstMessage ? text.slice(0, 50) + (text.length > 50 ? "…" : "") : undefined;

    updateConversation(convId, conv => ({
      ...conv,
      messages: [...conv.messages, userMsg],
      title: title ?? conv.title,
      updatedAt: Date.now(),
    }));

    setInput("");
    setIsLoading(true);
    setLastError(false);

    // Auto-resize textarea
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    // ── Video generation path — auto-routes to fal.ai Kling ──────────────────
    if (isVideoRequest(text)) {
      const assistantId = (Date.now() + 1).toString();
      updateConversation(convId, conv => ({
        ...conv,
        messages: [...conv.messages, { id: assistantId, role: "assistant", content: "Generating video with fal.ai Kling… this takes 30–90 seconds.", isStreaming: true }],
      }));
      try {
        const res = await fetch("/api/video/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text, duration: "5", aspectRatio: "16:9" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Video generation failed");
        const videoUrl = data.videoUrl || data.url;
        updateConversation(convId, conv => ({
          ...conv,
          messages: conv.messages.map(m =>
            m.id === assistantId
              ? { ...m, content: `Here's your generated video:\n\n[Download/View Video](${videoUrl})\n\n*Generated with fal.ai Kling v2.1*`, isStreaming: false }
              : m
          ),
          updatedAt: Date.now(),
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Video generation failed";
        updateConversation(convId, conv => ({
          ...conv,
          messages: conv.messages.map(m =>
            m.id === assistantId ? { ...m, content: `Error: ${msg}\n\nNote: Video generation requires FAL_KEY in .env.local`, isStreaming: false } : m
          ),
        }));
        toast.error(msg);
        setLastError(true);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // ── Image generation path ───────────────────────────────────────────────
    if (isImageRequest(text)) {
      const assistantId = (Date.now() + 1).toString();
      updateConversation(convId, conv => ({
        ...conv,
        messages: [...conv.messages, { id: assistantId, role: "assistant", content: "Generating image…", isStreaming: true }],
      }));

      try {
        const res = await fetch("/api/image/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Image generation failed");

        const imageArtifact: Artifact = {
          id: `artifact_${assistantId}`,
          type: "image",
          title: "Generated Image",
          content: data.url,
          createdAt: Date.now(),
        };

        updateConversation(convId, conv => ({
          ...conv,
          messages: conv.messages.map(m =>
            m.id === assistantId
              ? { ...m, content: `Here's your generated image for: *${text}*`, imageUrl: data.url, isStreaming: false, artifact: imageArtifact }
              : m
          ),
          updatedAt: Date.now(),
        }));

        setActiveArtifact(imageArtifact);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Image generation failed";
        updateConversation(convId, conv => ({
          ...conv,
          messages: conv.messages.map(m =>
            m.id === assistantId ? { ...m, content: `Error: ${msg}`, isStreaming: false } : m
          ),
        }));
        toast.error(msg);
        setLastError(true);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // ── Chat streaming path ─────────────────────────────────────────────────
    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreaming(true);

    const assistantId = (Date.now() + 1).toString();
    updateConversation(convId, conv => ({
      ...conv,
      messages: [...conv.messages, { id: assistantId, role: "assistant", content: "", isStreaming: true }],
    }));

    const currentMessages = conversations.find(c => c.id === convId)?.messages ?? [];
    const history = [...currentMessages, userMsg]
      .filter(m => !m.isStreaming)
      .map(m => ({ role: m.role, content: m.content }));

    const apiMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
    ];

    try {
      let res: Response | null = null;
      for (let attempt = 0; attempt <= 1; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
        try {
          res = await fetch("/api/chat/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: apiMessages, model }),
            signal: controller.signal,
          });
          if (!res.ok && [429, 500, 502, 503].includes(res.status) && attempt === 0) {
            res = null;
            continue;
          }
          break;
        } catch (fetchErr: any) {
          if (fetchErr.name === "AbortError") throw fetchErr;
          if (attempt >= 1) throw fetchErr;
        }
      }
      if (!res) throw new Error("Chat request failed");

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "delta" && parsed.content) {
              fullContent += parsed.content;
              updateConversation(convId!, conv => ({
                ...conv,
                messages: conv.messages.map(m =>
                  m.id === assistantId ? { ...m, content: fullContent } : m
                ),
              }));
            } else if (parsed.type === "error") {
              throw new Error(parsed.message);
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      // Extract artifact from final content
      const artifact = extractArtifact(fullContent, assistantId);

      updateConversation(convId!, conv => ({
        ...conv,
        messages: conv.messages.map(m =>
          m.id === assistantId ? { ...m, isStreaming: false, artifact: artifact ?? undefined } : m
        ),
        updatedAt: Date.now(),
      }));

      if (artifact) {
        setActiveArtifact(artifact);
      }

      // Check if the message mentions RSI
      if (fullContent.toLowerCase().includes("rsi") || fullContent.toLowerCase().includes("self-improvement")) {
        setShowRsiWidget(true);
      }

    } catch (err: any) {
      if (err.name === "AbortError") {
        updateConversation(convId!, conv => ({
          ...conv,
          messages: conv.messages.map(m =>
            m.id === assistantId ? { ...m, isStreaming: false } : m
          ),
        }));
      } else {
        const msg = err instanceof Error ? err.message : "Chat failed";
        updateConversation(convId!, conv => ({
          ...conv,
          messages: conv.messages.map(m =>
            m.id === assistantId ? { ...m, content: `Error: ${msg}`, isStreaming: false } : m
          ),
        }));
        toast.error(msg);
        setLastError(true);
      }
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, isLoading, messages, model, activeConvId, conversations, createNewConversation, updateConversation]);

  const stopStreaming = () => abortRef.current?.abort();

  const toggleModel = () => {
    const next = model === "deepseek-chat" ? "deepseek-reasoner" : "deepseek-chat";
    setModel(next);
    localStorage.setItem("andromeda_model", next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
    <TooltipProvider delayDuration={400}>
      <div className="flex h-screen overflow-hidden bg-[oklch(0.09_0.012_265)] text-foreground">
        <ThemeCanvas skinId={currentSkin} />
        <SkinSelector currentSkin={currentSkin} onSkinChange={setCurrentSkin} />

        {/* ── Left Sidebar ─────────────────────────────────────────────────── */}
        <aside
          className={`flex-shrink-0 flex flex-col border-r border-border/40 glass transition-all duration-300 z-20 ${
            sidebarOpen ? "w-64" : "w-0 overflow-hidden"
          }`}
        >
          {/* Sidebar header */}
          <div className="flex-shrink-0 flex items-center justify-between px-3 py-3 border-b border-[#1f1f23]" style={{ background: '#0a0a0c' }}>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg overflow-hidden border border-border/50 bg-card flex-shrink-0">
                <img src={ENGINEER_LOGO} alt="Andromeda" className="w-full h-full object-cover" style={{ filter: "invert(1) brightness(0.85)" }} />
              </div>
              <span className="font-semibold text-sm gradient-text-hero" style={{ letterSpacing: '-0.02em' }}>Andromeda</span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={createNewConversation}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>New conversation</TooltipContent>
            </Tooltip>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
            {conversations.length === 0 && (
              <div className="px-2 py-8 text-center">
                <MessageSquare className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground/50">No conversations yet</p>
              </div>
            )}
            {conversations.map(conv => (
              <div
                key={conv.id}
                onClick={() => { setActiveConvId(conv.id); setActiveArtifact(null); }}
                className={`group flex items-start gap-2 px-2 py-2 rounded-lg cursor-pointer transition-all ${
                  conv.id === activeConvId
                    ? "bg-primary/10 border border-primary/20"
                    : "hover:bg-accent/50 border border-transparent"
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5 text-muted-foreground/60 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground/90 truncate">{conv.title}</p>
                  <p className="text-xs text-muted-foreground/50 mt-0.5">{relativeTime(conv.updatedAt)}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground/50 hover:text-destructive transition-all"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Sidebar footer nav */}
          <div className="flex-shrink-0 border-t border-border/40 p-2 space-y-0.5">
            <button
              onClick={() => { setShowRsiWidget(true); setActiveArtifact(null); }}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors text-xs"
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>RSI Dashboard</span>
            </button>
            <button
              onClick={() => navigate("/search")}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors text-xs"
            >
              <Brain className="w-3.5 h-3.5" />
              <span>Deep Research</span>
            </button>
            <button
              onClick={() => navigate("/history")}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors text-xs"
            >
              <History className="w-3.5 h-3.5" />
              <span>Search History</span>
            </button>
            {isAuthenticated && user && (
              <div className="flex items-center gap-2 px-2 py-2 mt-1 border-t border-border/30">
                <div className="w-5 h-5 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-xs text-primary font-medium">
                  {(user as any).name?.[0]?.toUpperCase() ?? "U"}
                </div>
                <span className="text-xs text-muted-foreground truncate">{(user as any).name ?? "User"}</span>
              </div>
            )}
          </div>
        </aside>

        {/* ── Sidebar toggle ────────────────────────────────────────────────── */}
        <button
          onClick={() => setSidebarOpen(o => !o)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-30 p-1 rounded-r-lg glass border border-l-0 border-border/40 text-muted-foreground hover:text-foreground transition-all"
          style={{ left: sidebarOpen ? "256px" : "0px" }}
        >
          {sidebarOpen ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        {/* ── Main area ─────────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Header */}
          <header className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 topbar z-10">
            <div className="flex items-center gap-3">
              {/* Ambient orb */}
              <AmbientOrb state={orbState} size="sm" />
              <div>
                <span className="font-semibold text-sm font-display">
                  {activeConv?.title ?? "Andromeda"}
                </span>
                <p className="text-xs text-muted-foreground/60 leading-none mt-0.5">
                  {messages.length > 0
                    ? `${messages.filter(m => m.role === "user").length} messages`
                    : "Start a conversation"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* RSI toggle */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setShowRsiWidget(w => !w)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-all border ${
                      showRsiWidget
                        ? "bg-violet-500/15 text-violet-300 border-violet-500/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent border-transparent"
                    }`}
                  >
                    <GitBranch className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">RSI</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>Toggle RSI widget</TooltipContent>
              </Tooltip>

              {/* Model toggle */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleModel}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                      model === "deepseek-reasoner"
                        ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent border-transparent"
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{model === "deepseek-reasoner" ? "Reasoner" : "Chat"}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {model === "deepseek-chat" ? "Switch to Reasoner (deeper thinking)" : "Switch to Chat (faster)"}
                </TooltipContent>
              </Tooltip>

              {/* Clear */}
              {messages.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => {
                        if (activeConvId) {
                          updateConversation(activeConvId, conv => ({ ...conv, messages: [], title: "New conversation" }));
                          setActiveArtifact(null);
                        }
                      }}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Clear conversation</TooltipContent>
                </Tooltip>
              )}

              {/* New conversation */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={createNewConversation}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>New conversation</TooltipContent>
              </Tooltip>
            </div>
          </header>

          {/* ── Content area (messages + artifact panel) ─────────────────── */}
          <div className="flex-1 flex overflow-hidden">

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-6 min-w-0">
              <div className="max-w-3xl mx-auto space-y-6">

                {/* Empty state */}
                {messages.length === 0 && !showRsiWidget && (
                  <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
                    <div className="relative mb-6">
                      <div className="w-20 h-20 rounded-2xl overflow-hidden border border-border/50 bg-card opacity-80">
                        <img src={ENGINEER_LOGO} alt="Andromeda" className="w-full h-full object-cover" style={{ filter: "invert(1) brightness(0.85)" }} />
                      </div>
                      <div className="absolute -bottom-1 -right-1">
                        <AmbientOrb state={orbState} size="md" label="" />
                      </div>
                    </div>
                    <h2 className="text-2xl font-semibold font-display gradient-text mb-2">Andromeda</h2>
                    <p className="text-sm text-muted-foreground max-w-sm mb-8">
                      Your autonomous AI workspace. Chat, research, generate, and improve.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
                      {EXAMPLE_PROMPTS.map((s) => (
                        <button
                          key={s}
                          onClick={() => { setInput(s); inputRef.current?.focus(); }}
                          className="text-left px-3 py-2.5 glass rounded-xl text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* RSI Widget — full-screen modal rendered via portal below */}

                {/* Messages */}
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 animate-slide-up ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                  >
                    {/* Avatar */}
                    <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                      msg.role === "user"
                        ? "bg-primary/20 border border-primary/30 text-primary"
                        : "bg-card border border-border/50 overflow-hidden"
                    }`}>
                      {msg.role === "user" ? (
                        <span>{(user as any)?.name?.[0]?.toUpperCase() ?? "U"}</span>
                      ) : (
                        <img src={ENGINEER_LOGO} alt="AI" className="w-full h-full object-cover" style={{ filter: "invert(1) brightness(0.85)" }} />
                      )}
                    </div>

                    {/* Bubble */}
                    <div className={`max-w-[85%] ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col gap-1`}>
                      <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        msg.role === "user"
                          ? "bg-primary/15 border border-primary/20 text-foreground rounded-tr-sm"
                          : "glass text-foreground rounded-tl-sm"
                      }`}>
                        {msg.role === "assistant" ? (
                          msg.content ? (
                            <div className={msg.isStreaming ? "streaming-cursor" : ""}>
                              <Streamdown>{msg.content}</Streamdown>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span className="text-xs">Thinking…</span>
                            </div>
                          )
                        ) : (
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        )}
                        {msg.imageUrl && <ImageMessage url={msg.imageUrl} />}
                      </div>

                      {/* Artifact open button */}
                      {msg.artifact && (
                        <button
                          onClick={() => setActiveArtifact(msg.artifact!)}
                          className="flex items-center gap-1.5 text-xs text-primary/70 hover:text-primary transition-colors mt-1"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
                          Open {msg.artifact.title}
                        </button>
                      )}

                      {msg.isStreaming && (
                        <button
                          onClick={stopStreaming}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors mt-1"
                        >
                          <Square className="w-3 h-3" /> Stop
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            </div>

            {/* Artifact panel */}
            {activeArtifact && (
              <div className="w-[420px] flex-shrink-0 hidden lg:flex">
                <ArtifactPanel
                  artifact={activeArtifact}
                  onClose={() => setActiveArtifact(null)}
                  className="w-full"
                />
              </div>
            )}
          </div>

          {/* ── Bottom Prompt Bar ─────────────────────────────────────────── */}
          <div className="flex-shrink-0 px-4 pb-4 pt-2 border-t border-[#1f1f23]" style={{ background: 'rgba(9,9,11,0.97)', backdropFilter: 'blur(20px)' }}>
            <div className="max-w-3xl mx-auto">
              <div className="relative rounded-2xl border transition-all" style={{ background: '#111113', borderColor: '#27272a' }}
                onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(124,58,237,0.4)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(124,58,237,0.15)'; }}
                onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#27272a'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}>
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    !isAuthenticated
                      ? "Sign in to start chatting…"
                      : isLoading
                      ? "Generating…"
                      : "Ask anything… or 'generate an image of…' (/ to focus)"
                  }
                  disabled={!isAuthenticated || isLoading}
                  className="w-full bg-transparent px-4 py-3.5 pr-24 text-sm text-[#e4e4e7] placeholder:text-[#52525b] outline-none resize-none overflow-hidden"
                  style={{ minHeight: "3rem" }}
                />
                <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
                  {/* Orb indicator */}
                  <AmbientOrb state={orbState} size="sm" label="" />

                  {isLoading ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={stopStreaming}
                          className="p-2 rounded-xl transition-colors"
                          style={{ background: 'rgba(244,63,94,0.15)', color: '#fb7185' }}
                        >
                          <Square className="w-4 h-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Stop generation</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={isAuthenticated ? sendMessage : () => (window.location.href = getLoginUrl())}
                          disabled={isAuthenticated && !input.trim()}
                          className="p-2 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ background: 'linear-gradient(135deg, #7c3aed, #6366f1)', color: '#fff' }}
                        >
                          {isAuthenticated ? <Send className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isAuthenticated ? "Send (Enter)" : "Sign in to chat"}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between mt-1.5 px-1">
                <p className="text-[11px] text-[#3f3f46]">
                  Enter to send · Shift+Enter for new line · / to focus
                </p>
                <div className="flex items-center gap-2 text-[11px] text-[#3f3f46]">
                  <ImageIcon className="w-3 h-3" />
                  <span>Image gen</span>
                  <span>·</span>
                  <span className={model === "deepseek-reasoner" ? "text-amber-400/50" : ""}>
                    {model === "deepseek-reasoner" ? "Reasoner" : "Chat"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>

    {/* ── RSI Full-Screen Modal ── */}
    {showRsiWidget && (
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.75)",
          backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 24,
          animation: "fadeIn 0.2s ease",
        }}
        onClick={(e) => { if (e.target === e.currentTarget) setShowRsiWidget(false); }}
      >
        <div
          style={{
            width: "100%", maxWidth: 1200, height: "85vh",
            background: "#09090b",
            border: "1px solid #27272a",
            borderRadius: 16,
            overflow: "hidden",
            boxShadow: "0 24px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(124,58,237,0.15)",
            display: "flex", flexDirection: "column",
            position: "relative",
            animation: "slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)",
          }}
        >
          {/* Close button */}
          <button
            onClick={() => setShowRsiWidget(false)}
            style={{
              position: "absolute", top: 10, right: 12, zIndex: 10,
              width: 28, height: 28, borderRadius: 8,
              background: "rgba(39,39,42,0.8)",
              border: "1px solid #3f3f46",
              color: "#71717a", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, lineHeight: 1,
              transition: "all 0.15s ease",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#f4f4f5"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(63,63,70,0.9)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#71717a"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(39,39,42,0.8)"; }}
          >
            ×
          </button>
          <RSIWidgetLazy />
        </div>
      </div>
    )}
    </>
  );
}

// ── Lazy RSI widget ───────────────────────────────────────────────────────────

function RSIWidgetLazy() {
  const [ProposalTreeGraph, setComp] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    import("../components/rsi/ProposalTreeGraph").then(m => {
      setComp(() => m.ProposalTreeGraph);
    }).catch(() => {});
  }, []);

  if (!ProposalTreeGraph) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Loading RSI graph…
      </div>
    );
  }

  return <ProposalTreeGraph />;
}
