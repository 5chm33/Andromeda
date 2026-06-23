/**
 * OnboardingModal.tsx — v8.9.0
 *
 * First-run onboarding flow shown once to new users.
 * Highlights key features: search, agent mode, code executor, keyboard shortcuts.
 * Dismissed to localStorage so it never shows again after completion.
 */
import { useState, useEffect } from "react";
import {
  Sparkles,
  Bot,
  Code2,
  Keyboard,
  ChevronRight,
  X,
  Search as SearchIcon,
  FlaskConical,
} from "lucide-react";

const STORAGE_KEY = "andromeda_onboarded_v1";

interface Step {
  icon: React.ReactNode;
  title: string;
  description: string;
  tip?: string;
}

const STEPS: Step[] = [
  {
    icon: <Sparkles className="w-8 h-8 text-violet-400" />,
    title: "Welcome to Andromeda",
    description:
      "An AI-powered research and coding assistant that searches the web, analyzes files, writes and runs code, and continuously improves itself.",
    tip: "Type any question and press Enter to get started.",
  },
  {
    icon: <SearchIcon className="w-8 h-8 text-blue-400" />,
    title: "Smart Web Search",
    description:
      "Every answer is grounded in real-time web sources. Andromeda fetches, reads, and synthesizes multiple pages to give you accurate, up-to-date answers.",
    tip: 'Switch to "Deep" mode for multi-step research on complex topics.',
  },
  {
    icon: <Bot className="w-8 h-8 text-cyan-400" />,
    title: "Autonomous Agent Mode",
    description:
      "Toggle Agent mode to let Andromeda plan and execute multi-step tasks: read files, write code, run commands, and iterate until the job is done.",
    tip: 'Click the "Agent" button in the toolbar, or type a coding task.',
  },
  {
    icon: <Code2 className="w-8 h-8 text-amber-400" />,
    title: "Code Executor & Image Gen",
    description:
      "Run Python, JavaScript, or shell commands directly in the browser. Generate images with AI. Attach ZIP files to edit entire codebases.",
    tip: "Press Ctrl+E to open the code executor, Ctrl+I for image generation.",
  },
  {
    icon: <Keyboard className="w-8 h-8 text-emerald-400" />,
    title: "Keyboard Shortcuts",
    description: "Work faster with built-in shortcuts:",
    tip: undefined,
  },
];

const SHORTCUTS = [
  { keys: ["Ctrl", "K"], label: "Focus search input" },
  { keys: ["Ctrl", "E"], label: "Toggle code executor" },
  { keys: ["Ctrl", "I"], label: "Toggle image generator" },
  { keys: ["Ctrl", "B"], label: "Toggle sidebar" },
  { keys: ["Esc"], label: "Blur input" },
  { keys: ["Enter"], label: "Send message" },
  { keys: ["Shift", "Enter"], label: "New line" },
];

interface OnboardingModalProps {
  onComplete?: () => void;
}

export function OnboardingModal({ onComplete }: OnboardingModalProps) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      // Small delay so the page renders first
      const t = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(t);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
    onComplete?.();
  };

  const next = () => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      dismiss();
    }
  };

  if (!visible) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={dismiss}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md bg-zinc-900 border border-zinc-700/60 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-0">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === step
                    ? "w-6 bg-violet-500"
                    : i < step
                    ? "w-3 bg-violet-700"
                    : "w-3 bg-zinc-700"
                }`}
              />
            ))}
          </div>
          <button
            onClick={dismiss}
            className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center mb-4">
              {current.icon}
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">{current.title}</h2>
            <p className="text-sm text-zinc-400 leading-relaxed">{current.description}</p>
          </div>

          {/* Shortcuts step */}
          {isLast && (
            <div className="space-y-2 mb-4">
              {SHORTCUTS.map((s, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/40">
                  <span className="text-xs text-zinc-400">{s.label}</span>
                  <div className="flex items-center gap-1">
                    {s.keys.map((k, ki) => (
                      <span key={ki} className="px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300 text-[10px] font-mono font-medium">
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tip */}
          {current.tip && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-violet-500/10 border border-violet-500/20 mb-4">
              <Sparkles className="w-3.5 h-3.5 text-violet-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-violet-300">{current.tip}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center justify-between">
          <button
            onClick={dismiss}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Skip tour
          </button>
          <button
            onClick={next}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-all shadow-lg shadow-violet-500/20"
          >
            {isLast ? "Get started" : "Next"}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Utility: reset onboarding (for testing) */
export function resetOnboarding() {
  localStorage.removeItem(STORAGE_KEY);
}
