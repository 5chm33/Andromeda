/**
 * ArtifactPanel.tsx — Live Artifact Preview Panel
 * Andromeda v11.0.0 — Phase 11: UI Overhaul
 *
 * When Andromeda generates code, HTML, or UI artifacts, this panel opens
 * on the right side of the workspace to show a live preview — similar to
 * Claude Artifacts or Manus's right-side panel.
 *
 * Supported artifact types:
 *   - html    → sandboxed iframe preview
 *   - code    → syntax-highlighted code view with copy button
 *   - image   → full-size image viewer
 *   - rsi     → embedded ProposalTreeGraph (RSI widget)
 *   - text    → formatted markdown output
 */
import { useState, useRef, useEffect } from "react";
import { X, Copy, Check, Code2, Globe, ImageIcon, GitBranch, Maximize2, Minimize2 } from "lucide-react";
import { Streamdown } from "streamdown";

export type ArtifactType = "html" | "code" | "image" | "rsi" | "text";

export interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  content: string;      // HTML source, code string, image URL, or markdown
  language?: string;    // For code artifacts: "typescript", "python", etc.
  createdAt: number;
}

interface ArtifactPanelProps {
  artifact: Artifact | null;
  onClose: () => void;
  className?: string;
}

const TYPE_ICONS: Record<ArtifactType, React.ReactNode> = {
  html: <Globe className="w-3.5 h-3.5" />,
  code: <Code2 className="w-3.5 h-3.5" />,
  image: <ImageIcon className="w-3.5 h-3.5" />,
  rsi: <GitBranch className="w-3.5 h-3.5" />,
  text: <Code2 className="w-3.5 h-3.5" />,
};

function HTMLPreview({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
  }, [html]);

  return (
    <iframe
      ref={iframeRef}
      title="Artifact Preview"
      sandbox="allow-scripts"
      className="w-full h-full border-0 bg-white rounded-b-xl"
      style={{ minHeight: "400px" }}
    />
  );
}

function CodeView({ code, language = "typescript" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative h-full">
      <button
        onClick={handleCopy}
        className="absolute top-3 right-3 z-10 p-1.5 rounded-lg glass text-muted-foreground hover:text-foreground transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <pre className="h-full overflow-auto p-4 text-xs font-mono leading-relaxed text-foreground/90 bg-transparent">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function ImageView({ url }: { url: string }) {
  return (
    <div className="flex items-center justify-center h-full p-4">
      <img
        src={url}
        alt="Artifact"
        className="max-w-full max-h-full object-contain rounded-xl border border-border/30"
      />
    </div>
  );
}

function TextPreview({ content }: { content: string }) {
  return (
    <div className="h-full overflow-auto p-4 text-sm leading-relaxed">
      <Streamdown>{content}</Streamdown>
    </div>
  );
}

// Lazy-load RSI widget to avoid circular imports
function RSIWidget() {
  const [ProposalTreeGraph, setComp] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    import("./rsi/ProposalTreeGraph").then(m => {
      setComp(() => m.ProposalTreeGraph);
    }).catch(() => {});
  }, []);

  if (!ProposalTreeGraph) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading RSI graph…
      </div>
    );
  }

  return <ProposalTreeGraph />;
}

export function ArtifactPanel({ artifact, onClose, className = "" }: ArtifactPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!artifact) return null;

  return (
    <div
      className={`flex flex-col h-full border-l border-border/40 bg-[oklch(0.09_0.012_265)] transition-all duration-300 ${
        expanded ? "fixed inset-0 z-50" : ""
      } ${className}`}
    >
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2.5 border-b border-border/40 glass">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-primary/70">{TYPE_ICONS[artifact.type]}</span>
          <span className="text-xs font-medium text-foreground truncate">{artifact.title}</span>
          <span className="text-xs text-muted-foreground/50 px-1.5 py-0.5 rounded bg-muted/30 uppercase tracking-wide">
            {artifact.language ?? artifact.type}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {artifact.type === "html" && <HTMLPreview html={artifact.content} />}
        {artifact.type === "code" && <CodeView code={artifact.content} language={artifact.language} />}
        {artifact.type === "image" && <ImageView url={artifact.content} />}
        {artifact.type === "text" && <TextPreview content={artifact.content} />}
        {artifact.type === "rsi" && <RSIWidget />}
      </div>
    </div>
  );
}

/**
 * Detect if a message contains an artifact and extract it.
 */
export function extractArtifact(content: string, messageId: string): Artifact | null {
  // HTML artifact: ```html ... ```
  const htmlMatch = content.match(/```html\n([\s\S]*?)```/);
  if (htmlMatch) {
    return {
      id: `artifact_${messageId}`,
      type: "html",
      title: "HTML Preview",
      content: htmlMatch[1],
      language: "html",
      createdAt: Date.now(),
    };
  }

  // Code artifact: ```typescript/python/js/etc ... ```
  const codeMatch = content.match(/```(typescript|python|javascript|tsx|jsx|rust|go|java|cpp|c|sql|bash|sh)\n([\s\S]*?)```/);
  if (codeMatch) {
    const lang = codeMatch[1];
    const code = codeMatch[2];
    // Only promote to artifact if code is substantial (> 20 lines)
    if (code.split("\n").length > 20) {
      return {
        id: `artifact_${messageId}`,
        type: "code",
        title: `${lang.charAt(0).toUpperCase() + lang.slice(1)} Code`,
        content: code,
        language: lang,
        createdAt: Date.now(),
      };
    }
  }

  return null;
}
