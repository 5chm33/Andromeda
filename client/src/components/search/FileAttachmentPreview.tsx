import React from "react";
import {
  X,
  FileText,
  FileCode,
  Image as ImageIcon,
} from "lucide-react";

export interface AttachedFile {
  name: string;
  content: string;
  mimeType: string;
  size: number;
  preview?: string;
  rawBase64?: string;
}

export function FileAttachmentPreview({ file, onRemove }: { file: AttachedFile; onRemove: () => void }) {
  const isImage = file.mimeType.startsWith("image/");
  const isCode = /\.(xml|json|yaml|yml|js|ts|py|html|css|sh|sql|md)$/i.test(file.name);
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 group">
      <div className="flex-shrink-0">
        {isImage ? <ImageIcon className="w-4 h-4 text-blue-400" />
          : isCode ? <FileCode className="w-4 h-4 text-green-400" />
          : <FileText className="w-4 h-4 text-zinc-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-zinc-200 truncate">{file.name}</p>
        <p className="text-xs text-zinc-500">{(file.size / 1024).toFixed(1)} KB</p>
      </div>
      <button onClick={onRemove} className="flex-shrink-0 text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
