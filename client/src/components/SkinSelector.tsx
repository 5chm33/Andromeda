/**
 * SkinSelector — floating palette button + modal skin picker
 * Andromeda v8.0.0 — 10 cinematic skins with real image thumbnails
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

          {/* 5-column grid for 10 skins */}
          <div className="grid grid-cols-5 gap-2">
            {SKINS.map((skin) => {
              const isActive = skin.id === currentSkin;
              return (
                <button
                  key={skin.id}
                  onClick={() => handleSelect(skin.id)}
                  className={`relative rounded-xl overflow-hidden border transition-all duration-200 text-left group ${
                    isActive
                      ? "ring-1 scale-[1.03]"
                      : "border-border/30 hover:border-border/60 hover:scale-[1.02]"
                  }`}
                  style={{
                    borderColor: isActive ? skin.labelColor : undefined,
                    boxShadow: isActive ? `0 0 14px ${skin.labelColor}50` : undefined,
                  }}
                >
                  {/* Real background image thumbnail */}
                  <div
                    className="h-16 relative overflow-hidden"
                    style={{
                      backgroundImage: `url(${skin.bgImage})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  >
                    {/* Dark overlay for label readability */}
                    <div className="absolute inset-0 bg-black/40" />

                    {/* Skin name label */}
                    <div className="absolute inset-0 flex items-end px-1.5 pb-1">
                      <span
                        className="text-[8px] font-bold uppercase tracking-widest leading-tight"
                        style={{
                          color: skin.labelColor,
                          textShadow: `0 0 6px ${skin.labelColor}90, 0 1px 3px rgba(0,0,0,0.8)`,
                        }}
                      >
                        {skin.name}
                      </span>
                    </div>

                    {/* Active checkmark */}
                    {isActive && (
                      <div
                        className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center"
                        style={{ background: skin.labelColor }}
                      >
                        <Check className="w-2.5 h-2.5 text-black" />
                      </div>
                    )}
                  </div>
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
