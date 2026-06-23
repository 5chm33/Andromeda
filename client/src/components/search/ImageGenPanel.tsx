import React, { useEffect, useRef, useState } from "react";
import {
  Image as ImageIcon,
  Loader2,
  Download,
  X,
} from "lucide-react";

export function ImageGenPanel({ initialPrompt = "" }: { initialPrompt?: string }) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enhancedPrompt, setEnhancedPrompt] = useState<string | null>(null);
  const [usedReference, setUsedReference] = useState(false);
  const [referenceImageB64, setReferenceImageB64] = useState<string | null>(null);
  const [referenceMimeType, setReferenceMimeType] = useState<string>("image/jpeg");
  const [referenceName, setReferenceName] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [prompt]);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const reader = new FileReader();
          reader.onload = (ev) => {
            const dataUrl = ev.target?.result as string;
            setReferenceImageB64(dataUrl);
            setReferenceMimeType(item.type);
            setReferenceName("pasted image");
          };
          reader.readAsDataURL(file);
          return;
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  const loadReferenceFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setReferenceImageB64(dataUrl);
      setReferenceMimeType(file.type);
      setReferenceName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const generate = async () => {
    if (!prompt.trim()) return;
    setError(null);
    setImageUrl(null);
    setEnhancedPrompt(null);
    setUsedReference(false);
    setImageLoading(true);
    try {
      const body: Record<string, unknown> = { prompt: prompt.trim(), width: 1024, height: 1024 };
      if (referenceImageB64) {
        body.referenceImageB64 = referenceImageB64;
        body.referenceMimeType = referenceMimeType;
      }
      const res = await fetch("/api/image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errData.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.url) throw new Error("No image URL returned from server");
      setImageUrl(data.url);
      if (data.enhancedPrompt) setEnhancedPrompt(data.enhancedPrompt);
      if (data.usedReference) setUsedReference(data.usedReference);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Image generation failed: ${msg}`);
    } finally {
      setImageLoading(false);
    }
  };

  const download = () => {
    if (!imageUrl) return;
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = `andromeda-image-${Date.now()}.jpg`;
    a.click();
  };

  return (
    <div className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
        <div className="w-6 h-6 rounded-lg bg-pink-500/20 flex items-center justify-center">
          <ImageIcon className="w-3.5 h-3.5 text-pink-400" />
        </div>
        <span className="text-sm font-medium text-pink-300">Image Generator</span>
        {imageLoading && <Loader2 className="w-3.5 h-3.5 text-pink-400 animate-spin ml-auto" />}
      </div>
      <div className="p-4 space-y-3">
        <div
          className={`relative rounded-xl border-2 border-dashed transition-all cursor-pointer ${
            isDragOver ? "border-pink-400 bg-pink-500/10"
              : referenceImageB64 ? "border-pink-500/40 bg-pink-500/5"
              : "border-zinc-700 hover:border-pink-500/30 hover:bg-pink-500/5"
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) loadReferenceFile(file);
          }}
        >
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) loadReferenceFile(f); }} />
          {referenceImageB64 ? (
            <div className="p-2 flex items-center gap-3">
              <img src={referenceImageB64} alt="Reference" className="w-16 h-16 rounded-lg object-cover border border-zinc-700 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-pink-300 truncate">{referenceName}</p>
                <p className="text-xs text-zinc-500 mt-0.5">Reference image — AI will match this style</p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setReferenceImageB64(null); setReferenceName(null); }}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="p-4 flex flex-col items-center gap-1.5 text-center">
              <ImageIcon className="w-5 h-5 text-zinc-600" />
              <p className="text-xs text-zinc-500">Paste, drag, or click to add a <span className="text-pink-300">reference image</span></p>
              <p className="text-xs text-zinc-600">Style keywords from your prompt will guide the output</p>
            </div>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate(); }}
          placeholder={referenceImageB64 ? "Describe what to generate in the reference style..." : "Describe the image you want to generate..."}
          rows={1}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-pink-500/50 transition-colors resize-none leading-relaxed overflow-hidden min-h-[2.5rem]"
          style={{ height: "auto" }}
        />
        <button onClick={generate} disabled={imageLoading || !prompt.trim()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-pink-500/20 text-pink-300 border border-pink-500/30 text-sm font-medium hover:bg-pink-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {imageLoading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> {referenceImageB64 ? "Analyzing reference & generating…" : "Generating… (10–20 sec)"}</>
            : <><ImageIcon className="w-4 h-4" /> {referenceImageB64 ? "Generate with Reference" : "Generate Image"}</>}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {enhancedPrompt && (
          <details className="group">
            <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 flex items-center gap-1">
              <span className="text-pink-400">✦</span>
              {usedReference ? "Reference-guided prompt used" : "AI-enhanced prompt used"}
            </summary>
            <p className="mt-1.5 text-xs text-zinc-500 bg-zinc-800/50 rounded-lg p-2 leading-relaxed">{enhancedPrompt}</p>
          </details>
        )}
        {imageUrl && (
          <div className="space-y-2">
            <img src={imageUrl} alt={prompt} className="w-full rounded-xl border border-zinc-800 object-contain max-h-80" />
            <button onClick={download}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-zinc-700 transition-all">
              <Download className="w-3.5 h-3.5" /> Download Image
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
