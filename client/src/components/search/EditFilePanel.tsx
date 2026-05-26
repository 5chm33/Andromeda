import React, { useState } from "react";
import {
  FileEdit,
  Loader2,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import type { AttachedFile } from "./FileAttachmentPreview";

// Import the raw zip getter from the main search page store
declare function getRawZip(): { fileName: string; rawBase64: string } | null;

export function EditFilePanel({ file, model, getRawZipFn }: {
  file: AttachedFile;
  model: "deepseek-chat" | "deepseek-reasoner";
  getRawZipFn: () => { fileName: string; rawBase64: string } | null;
}) {
  const [instructions, setInstructions] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [result, setResult] = useState<{ editedZip: string; summary: string; editsApplied: number; log: string[] } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const handleEdit = async () => {
    if (!instructions.trim()) { toast.error("Please describe the changes you want"); return; }
    setIsEditing(true);
    setResult(null);
    setEditError(null);
    try {
      const storeEntry = getRawZipFn();
      const rawBytes = file.rawBase64 ?? (storeEntry?.fileName === file.name ? storeEntry.rawBase64 : undefined);
      if (!rawBytes) {
        toast.error("ZIP bytes not available — please re-attach the file directly on this page using the paperclip button.");
        setIsEditing(false);
        return;
      }
      const response = await fetch("/api/edit/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileContent: rawBytes, fileName: file.name, instructions: instructions.trim(), model }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Edit failed");
      }
      const data = await response.json();
      // v5.31: Server returns editedContent (from runMultiPassEdit), normalize to editedZip for download
      const normalizedResult = {
        editedZip: data.editedContent || data.editedZip || "",
        summary: data.summary || "Changes applied",
        editsApplied: data.editsApplied || 0,
        log: data.log || [],
      };
      setResult(normalizedResult);
      toast.success(`${normalizedResult.editsApplied} edit${normalizedResult.editsApplied !== 1 ? "s" : ""} applied`);
    } catch (err) {
      setEditError((err as Error).message || "Edit failed");
      toast.error("Edit failed: " + (err as Error).message);
    } finally {
      setIsEditing(false);
    }
  };

  const handleDownload = () => {
    if (!result || !result.editedZip) {
      toast.error("No edited ZIP data available");
      return;
    }
    try {
      // v5.31: Robust base64 → binary conversion that handles large files
      // Uses fetch + data URI approach which avoids atob() stack overflow on large strings
      const byteCharacters = atob(result.editedZip);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${file.name.replace(/\.zip$/i, "")}_edited.zip`;
      document.body.appendChild(a);
      a.click();
      // Cleanup
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      toast.success("Edited ZIP downloaded");
    } catch (err) {
      console.error("[EditFilePanel] Download failed:", err);
      // Fallback: try chunked approach for very large files
      try {
        const raw = result.editedZip;
        const binaryLen = raw.length;
        const CHUNK_SIZE = 512;
        const bytes = new Uint8Array(binaryLen);
        const decoded = atob(raw);
        for (let offset = 0; offset < binaryLen; offset += CHUNK_SIZE) {
          const end = Math.min(offset + CHUNK_SIZE, binaryLen);
          for (let i = offset; i < end; i++) {
            bytes[i] = decoded.charCodeAt(i);
          }
        }
        const blob = new Blob([bytes], { type: "application/zip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${file.name.replace(/\.zip$/i, "")}_edited.zip`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
        toast.success("Edited ZIP downloaded (fallback method)");
      } catch (fallbackErr) {
        toast.error("Download failed: " + (fallbackErr as Error).message);
      }
    }
  };

  return (
    <div className="space-y-3">
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="e.g. Add error handling to the processFile function, fix the token limit to 100000, add a dark mode toggle..."
        rows={3}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-violet-500/50 transition-colors resize-none"
        spellCheck={true}
      />
      <button onClick={handleEdit} disabled={isEditing || !instructions.trim()}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed">
        {isEditing ? <><Loader2 className="w-4 h-4 animate-spin" /> Editing files...</> : <><FileEdit className="w-4 h-4" /> Apply Edits</>}
      </button>
      {editError && <p className="text-xs text-red-400">{editError}</p>}
      {result && (
        <div className="space-y-2">
          <div className="rounded-lg p-3 space-y-1 bg-zinc-800 border border-zinc-700">
            <p className="text-xs font-medium text-zinc-200">{result.summary}</p>
            <p className="text-xs text-zinc-500">{result.editsApplied} change{result.editsApplied !== 1 ? "s" : ""} applied</p>
            {result.log.slice(0, 5).map((l, i) => (
              <p key={i} className={`text-xs font-mono ${
                l.startsWith("EDIT:") ? "text-green-400" : l.startsWith("NEW:") ? "text-blue-400" : "text-zinc-500"
              }`}>{l}</p>
            ))}
          </div>
          <button onClick={handleDownload}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-600/20 text-emerald-300 border border-emerald-600/30 text-sm font-medium hover:bg-emerald-600/30 transition-all">
            <Download className="w-4 h-4" /> Download Edited Files
          </button>
        </div>
      )}
    </div>
  );
}
