/**
 * SkinSelector — floating palette button + modal skin picker
 * Andromeda v7.3.0
 */
import { useEffect, useRef, useState } from "react";
import { Palette, Check } from "lucide-react";
import { SKINS, getSavedSkin, saveSkin } from "@/lib/themeEngine";
import type { SkinId } from "@/lib/themeEngine";

interface SkinSelectorProps {
  currentSkin: SkinId;
  onSkinChange: (id: SkinId) => void;
}

export function SkinSelector({ currentSkin, onSkinChange }: SkinSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = (id: SkinId) => {
    saveSkin(id);
    onSkinChange(id);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      {/* Floating palette button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={`fixed bottom-24 right-4 z-50 w-10 h-10 rounded-full flex items-center justify-center shadow-2xl transition-all duration-200 border ${
          open
            ? "bg-primary/20 border-primary/60 text-primary scale-110"
            : "bg-card/80 border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/40 backdrop-blur-md"
        }`}
        title="Change background skin"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)" }}
      >
        <Palette className="w-4 h-4" />
      </button>

      {/* Skin picker panel */}
      {open && (
        <div
          className="fixed right-4 z-50 w-80 glass rounded-2xl border border-border/50 shadow-2xl p-4 animate-scale-in"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 7.5rem)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-foreground">Background Skin</p>
            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
              {SKINS.find((s) => s.id === currentSkin)?.name}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {SKINS.map((skin) => {
              const isActive = skin.id === currentSkin;
              return (
                <button
                  key={skin.id}
                  onClick={() => handleSelect(skin.id)}
                  className={`relative rounded-xl overflow-hidden border transition-all duration-200 text-left group ${
                    isActive
                      ? "border-primary/60 ring-1 ring-primary/40 scale-[1.02]"
                      : "border-border/30 hover:border-border/60 hover:scale-[1.01]"
                  }`}
                  style={{ background: skin.previewGradient }}
                >
                  {/* Preview area */}
                  <div className="h-16 flex items-center justify-center">
                    <span className="text-3xl drop-shadow-lg">{skin.icon}</span>
                  </div>

                  {/* Label */}
                  <div className="px-2.5 py-2 bg-black/40 backdrop-blur-sm">
                    <p className="text-xs font-medium text-white/90 leading-tight">{skin.name}</p>
                    <p className="text-[10px] text-white/50 leading-tight mt-0.5 line-clamp-1">{skin.description}</p>
                  </div>

                  {/* Active checkmark */}
                  {isActive && (
                    <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <p className="text-[10px] text-muted-foreground/40 text-center mt-3">
            Selection is saved automatically
          </p>
        </div>
      )}
    </div>
  );
}
