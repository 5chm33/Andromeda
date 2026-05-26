import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import {
  ArrowLeft,
  Send,
  Trash2,
  Zap,
  MessageSquare,
  Square,
  ImageIcon,
  Loader2,
  Plus,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Streamdown } from "streamdown";
import { toast } from "sonner";

const ENGINEER_LOGO =
  "https://d2xsxph8kpxj0f.cloudfront.net/114320538/CXRX5bpbYnFQmGG8voUpbs/andromeda_engineer_d67b9e19.png";

const SYSTEM_PROMPT = `You are Andromeda, an elite AI assistant. You are helpful, knowledgeable, and direct. You give thorough, substantive answers. Use markdown formatting — headers, bold, code blocks — where appropriate. Today's date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.`;

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
  isStreaming?: boolean;
}

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
        alt="Generated image"
        className={`w-full object-cover transition-opacity ${loaded ? "opacity-100" : "opacity-0 h-0"}`}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

export default function Chat() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem("andromeda_chat_history");
      if (saved) {
        const parsed = JSON.parse(saved) as ChatMessage[];
        // Strip incomplete streaming messages from previous session
        return parsed.filter(m => !m.isStreaming && m.content.trim().length > 0);
      }
    } catch { /* ignore */ }
    return [];
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [model, setModel] = useState<"deepseek-chat" | "deepseek-reasoner">(() => {
    return (localStorage.getItem("andromeda_model") as "deepseek-chat" | "deepseek-reasoner") || "deepseek-chat";
  });
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Persist conversation to localStorage whenever messages change (keep last 100)
  useEffect(() => {
    try {
      const toSave = messages.filter(m => !m.isStreaming);
      localStorage.setItem("andromeda_chat_history", JSON.stringify(toSave.slice(-100)));
    } catch { /* ignore */ }
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const isImageRequest = (text: string) =>
    /^(generate|create|draw|make|paint|show me|render|imagine|visualize)\s+(an?\s+)?(image|picture|photo|illustration|artwork|drawing|painting|portrait|landscape)/i.test(text.trim());

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    // Auto-resize textarea back to 1 row
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    // Image generation path
    if (isImageRequest(text)) {
      const assistantId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "Generating image…", isStreaming: true },
      ]);
      try {
        const res = await fetch("/api/image/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Image generation failed");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `Here's your generated image for: *${text}*`, imageUrl: data.url, isStreaming: false }
              : m
          )
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Image generation failed";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: `Error: ${msg}`, isStreaming: false } : m
          )
        );
        toast.error(msg);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Chat streaming path
    const controller = new AbortController();
    abortRef.current = controller;

    const assistantId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", isStreaming: true },
    ]);

    // Build messages array for API (exclude streaming placeholders, include history)
    const history = [...messages, userMsg]
      .filter((m) => !m.isStreaming)
      .map((m) => ({ role: m.role, content: m.content }));

    const apiMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
    ];

    // v5.11: Stream recovery — retry once on transient network errors (not on abort or 4xx)
    let res: Response | null = null;
    let lastFetchErr: Error | null = null;
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
          lastFetchErr = new Error(`HTTP ${res.status}`);
          res = null;
          continue;
        }
        break;
      } catch (fetchErr: any) {
        if (fetchErr.name === "AbortError") throw fetchErr;
        lastFetchErr = fetchErr;
        if (attempt >= 1) throw lastFetchErr;
      }
    }
    if (!res) throw lastFetchErr || new Error("Chat request failed");

    try {
      if (!res.ok) {
        const requestId = res.headers.get("X-Request-ID") || "";
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        const idSuffix = requestId ? ` (ref: ${requestId})` : "";
        throw new Error((err.error || `HTTP ${res.status}`) + idSuffix);
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
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: fullContent } : m
                )
              );
            } else if (parsed.type === "done") {
              // final
            } else if (parsed.type === "error") {
              throw new Error(parsed.message);
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, isStreaming: false } : m
        )
      );
    } catch (err: any) {
      if (err.name === "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, isStreaming: false } : m
          )
        );
      } else {
        const msg = err instanceof Error ? err.message : "Chat failed";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `Error: ${msg}`, isStreaming: false }
              : m
          )
        );
        toast.error(msg);
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [input, isLoading, messages, model]);

  const stopStreaming = () => {
    abortRef.current?.abort();
  };

  const clearChat = () => {
    setMessages([]);
    localStorage.removeItem("andromeda_chat_history");
  };

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

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-3 glass border-b border-border/40 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-7 h-7 rounded-lg overflow-hidden border border-border/50 bg-card flex-shrink-0">
            <img
              src={ENGINEER_LOGO}
              alt="Andromeda"
              className="w-full h-full object-cover"
              style={{ filter: "invert(1) brightness(0.85)" }}
            />
          </div>
          <div>
            <span className="font-semibold text-sm font-display">Andromeda Chat</span>
            <p className="text-xs text-muted-foreground leading-none mt-0.5">
              {messages.length > 0 ? `${messages.filter(m => m.role === "user").length} messages` : "New conversation"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleModel}
            title={model === "deepseek-chat" ? "Switch to Reasoner" : "Switch to Chat"}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
              model === "deepseek-reasoner"
                ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                : "text-muted-foreground hover:text-foreground hover:bg-accent border-transparent"
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{model === "deepseek-reasoner" ? "Reasoner" : "Chat"}</span>
          </button>
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Clear conversation"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => navigate("/")}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="New search"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
              <div className="w-16 h-16 rounded-2xl overflow-hidden border border-border/50 bg-card mb-4 opacity-60">
                <img
                  src={ENGINEER_LOGO}
                  alt="Andromeda"
                  className="w-full h-full object-cover"
                  style={{ filter: "invert(1) brightness(0.85)" }}
                />
              </div>
              <h2 className="text-xl font-semibold font-display mb-2">Start a conversation</h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                Ask anything — research questions, code help, analysis, or say "generate an image of…" to create visuals.
              </p>
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
                {[
                  "Explain quantum entanglement simply",
                  "Write a Python script to sort a CSV",
                  "Generate an image of a futuristic city",
                  "What are the best practices for REST APIs?",
                ].map((s) => (
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
                  "U"
                ) : (
                  <img
                    src={ENGINEER_LOGO}
                    alt="AI"
                    className="w-full h-full object-cover"
                    style={{ filter: "invert(1) brightness(0.85)" }}
                  />
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

      {/* Input */}
      <div className="flex-shrink-0 px-4 pb-4 pt-2 border-t border-border/30">
        <div className="max-w-3xl mx-auto">
          <div className="relative glass-strong rounded-2xl border border-border/50 focus-within:border-primary/40 transition-colors">
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
              placeholder={isAuthenticated ? "Ask anything… or 'generate an image of…'" : "Sign in to chat"}
              disabled={!isAuthenticated || isLoading}
              className="w-full bg-transparent px-4 py-3.5 pr-14 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none resize-none overflow-hidden"
              style={{ minHeight: "3rem" }}
            />
            <div className="absolute right-2 bottom-2 flex items-center gap-1">
              {isLoading ? (
                <button
                  onClick={stopStreaming}
                  className="p-2 rounded-xl bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors"
                  title="Stop generation"
                >
                  <Square className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={isAuthenticated ? sendMessage : () => (window.location.href = getLoginUrl())}
                  disabled={!input.trim() && isAuthenticated}
                  className="p-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Send message"
                >
                  {isAuthenticated ? <Send className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between mt-2 px-1">
            <p className="text-xs text-muted-foreground/40">
              Enter to send · Shift+Enter for new line · Say "generate an image of…" for visuals
            </p>
            <div className="flex items-center gap-1 text-xs text-muted-foreground/40">
              <ImageIcon className="w-3 h-3" />
              <span>Image gen enabled</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
