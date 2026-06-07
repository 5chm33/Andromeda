/**
 * SkinSelector — floating palette button + modal skin picker
 * Andromeda v7.4.0 — 8 cinematic skins, skin-aware accent theming
 */
import { useEffect, useRef, useState } from "react";
import { Palette, Check } from "lucide-react";
import { SKINS, getSavedSkin, saveSkin, applySkinAccent } from "@/lib/themeEngine";
import type { SkinId } from "@/lib/themeEngine";

interface SkinSelectorProps {
  currentSkin: SkinId;
  onSkinChange: (id: SkinId) => void;
}

export function SkinSelector({ currentSkin, onSkinChange }: SkinSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Apply accent color on mount and when skin changes
  useEffect(() => {
    applySkinAccent(currentSkin);
  }, [currentSkin]);

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
    applySkinAccent(id);
    onSkinChange(id);
    setOpen(false);
  };

  const currentSkinMeta = SKINS.find((s) => s.id === currentSkin);

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
            <p
              className="text-[10px] uppercase tracking-wider font-medium"
              style={{ color: currentSkinMeta?.labelColor ?? "rgba(255,255,255,0.5)" }}
            >
              {currentSkinMeta?.name}
            </p>
          </div>

          {/* 2-column grid — 4 rows for 8 skins */}
          <div className="grid grid-cols-2 gap-2">
            {SKINS.map((skin) => {
              const isActive = skin.id === currentSkin;
              return (
                <button
                  key={skin.id}
                  onClick={() => handleSelect(skin.id)}
                  className={`relative rounded-xl overflow-hidden border transition-all duration-200 text-left group ${
                    isActive
                      ? "ring-1 scale-[1.02]"
                      : "border-border/30 hover:border-border/60 hover:scale-[1.01]"
                  }`}
                  style={{
                    background: skin.previewGradient,
                    borderColor: isActive ? skin.labelColor : undefined,
                    boxShadow: isActive ? `0 0 12px ${skin.labelColor}40` : undefined,
                  }}
                >
                  {/* Preview area — animated gradient shimmer */}
                  <div
                    className="h-14 flex items-end justify-start px-2 pb-1 relative overflow-hidden"
                    style={{ background: skin.previewGradient }}
                  >
                    {/* Animated shimmer overlay */}
                    <div
                      className="absolute inset-0 opacity-30"
                      style={{
                        background: `radial-gradient(ellipse at 30% 60%, ${skin.labelColor}30 0%, transparent 70%)`,
                      }}
                    />
                    {/* Skin name as colored label */}
                    <span
                      className="relative text-[9px] font-bold uppercase tracking-widest z-10"
                      style={{ color: skin.labelColor, textShadow: `0 0 8px ${skin.labelColor}80` }}
                    >
                      {skin.name}
                    </span>
                  </div>

                  {/* Description */}
                  <div className="px-2 py-1.5 bg-black/50 backdrop-blur-sm">
                    <p className="text-[10px] text-white/55 leading-tight line-clamp-2">{skin.description}</p>
                  </div>

                  {/* Active checkmark */}
                  {isActive && (
                    <div
                      className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: skin.labelColor }}
                    >
                      <Check className="w-3 h-3 text-black" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <p className="text-[10px] text-muted-foreground/40 text-center mt-3">
            Skin selection is saved automatically
          </p>
        </div>
      )}
    </div>
  );
}
