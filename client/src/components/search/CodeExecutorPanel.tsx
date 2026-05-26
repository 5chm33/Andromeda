import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  FlaskConical,
  Loader2,
} from "lucide-react";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";

function CodeMirrorEditor({ value, onChange, language: lang, onRun }: {
  value: string;
  onChange: (v: string) => void;
  language: "python" | "javascript" | "shell";
  onRun: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const langExt = lang === "python" ? python() : javascript();
    const runKeymap = keymap.of([{
      key: "Ctrl-Enter",
      mac: "Cmd-Enter",
      run: () => { onRun(); return true; },
    }]);
    const state = EditorState.create({
      doc: value,
      extensions: [
        oneDark,
        langExt,
        lineNumbers(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, indentWithTab]),
        runKeymap,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString());
        }),
        EditorView.theme({
          "&": { minHeight: "200px", maxHeight: "400px", overflow: "auto", fontSize: "13px" },
          ".cm-scroller": { fontFamily: "'JetBrains Mono', 'Fira Code', monospace", lineHeight: "1.6" },
          ".cm-content": { padding: "12px 0" },
          ".cm-gutters": { borderRight: "1px solid rgba(255,255,255,0.06)" },
        }),
      ],
    });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div ref={containerRef} className="codemirror-wrapper" />;
}

export function CodeExecutorPanel() {
  const [code, setCode] = useState<string>(() =>
    localStorage.getItem("andromeda_code_editor") ??
    `# Python example\nprint("Hello from Andromeda!")\nfor i in range(5):\n    print(f"  Step {i+1}: {i*i}")`
  );
  const [language, setLanguage] = useState<"python" | "javascript" | "shell">(
    () => (localStorage.getItem("andromeda_code_lang") as "python" | "javascript" | "shell") ?? "python"
  );
  const [output, setOutput] = useState<{ stdout: string; stderr: string; exitCode: number; durationMs: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const runCode = async () => {
    if (!code.trim() || running) return;
    setRunning(true);
    setOutput(null);
    try {
      const res = await fetch("/api/code/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language }),
      });
      const result = await res.json();
      setOutput(result);
    } catch {
      setOutput({ stdout: "", stderr: "Network error — could not reach execution server", exitCode: -1, durationMs: 0 });
    } finally {
      setRunning(false);
    }
  };

  const copyOutput = () => {
    if (!output) return;
    navigator.clipboard.writeText(output.stdout || output.stderr || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const LANGS = [
    { value: "python", label: "Python" },
    { value: "javascript", label: "JavaScript" },
    { value: "shell", label: "Shell" },
  ] as const;

  return (
    <div className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <FlaskConical className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <span className="text-sm font-medium text-amber-300">Code Executor</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border border-zinc-700">
            {LANGS.map((l) => (
              <button key={l.value}
                onClick={() => { setLanguage(l.value); localStorage.setItem("andromeda_code_lang", l.value); }}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  language === l.value ? "bg-amber-500/20 text-amber-300" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                }`}>
                {l.label}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={runCode} disabled={running || !code.trim()}
            className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs h-7 px-3">
            {running ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            {running ? "Running…" : "▶ Run"}
          </Button>
        </div>
      </div>
      <div className="relative border-b border-zinc-800">
        <CodeMirrorEditor
          value={code}
          onChange={(v) => { setCode(v); localStorage.setItem("andromeda_code_editor", v); }}
          language={language}
          onRun={runCode}
        />
        <div className="absolute bottom-2 right-2 text-xs text-zinc-700 pointer-events-none select-none">
          Ctrl+Enter to run
        </div>
      </div>
      {output !== null && (
        <div className="border-t border-zinc-800">
          <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/50">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium ${output.exitCode === 0 ? "text-emerald-400" : "text-red-400"}`}>
                {output.exitCode === 0 ? "✓ Success" : output.exitCode === -1 ? "✗ Error / Timeout" : `✗ Exit ${output.exitCode}`}
              </span>
              <span className="text-xs text-zinc-600">{output.durationMs}ms</span>
            </div>
            <button onClick={copyOutput} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              {copied ? "Copied!" : "Copy output"}
            </button>
          </div>
          <pre className="p-4 text-sm font-mono overflow-x-auto max-h-[300px] overflow-y-auto bg-black/30 text-zinc-300 whitespace-pre-wrap break-words">
            {output.stdout || ""}
            {output.stderr && <span className="text-red-400">{output.stdout ? "\n" : ""}{output.stderr}</span>}
            {!output.stdout && !output.stderr && <span className="text-zinc-600 italic">No output</span>}
          </pre>
        </div>
      )}
    </div>
  );
}
