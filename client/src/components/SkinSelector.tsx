/**
 * SkinSelector v9.1.0
 * Floating palette button + modal skin picker.
 * - Animated hover: video preview plays on thumbnail hover
 * - Glow ring on active skin
 * - Escape key to close
 */
import { useEffect, useRef, useState } from "react";
import { Palette, Check } from "lucide-react";
import { SKINS, saveSkin, applySkinAccent } from "@/lib/themeEngine";
import type { SkinId } from "@/lib/themeEngine";

// Video paths for hover preview
const SKIN_VIDEO: Partial<Record<SkinId, string>> = {
  aurora:        "/skins/videos/aurora.mp4",
  goth:          "/skins/videos/goth.mp4",
  nature:        "/skins/videos/nature.mp4",
  cyberpunk:     "/skins/videos/cyberpunk.mp4",
  finalfantasy:  "/skins/videos/finalfantasy.mp4",
  monsters:      "/skins/videos/monsters.mp4",
  lofi:          "/skins/videos/lofi.mp4",
  spacestation:  "/skins/videos/space.mp4",
  luigismansion: "/skins/videos/luigis_mansion.mp4",
};

// ── SkinThumb — individual thumbnail with video hover preview ────────────────
interface SkinThumbProps {
  skin: typeof SKINS[number];
  isActive: boolean;
  videoSrc?: string;
  onSelect: () => void;
}

function SkinThumb({ skin, isActive, videoSrc, onSelect }: SkinThumbProps) {
  const [hovered, setHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (hovered) {
      vid.currentTime = 0;
      vid.play().catch(() => {/* autoplay blocked */});
    } else {
      vid.pause();
    }
  }, [hovered]);

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className={`relative rounded-xl overflow-hidden border transition-all duration-200 text-left ${
        isActive
          ? "ring-1 scale-[1.05]"
          : "border-border/30 hover:border-border/60 hover:scale-[1.03]"
      }`}
      style={{
        borderColor: isActive ? skin.labelColor : undefined,
        boxShadow: isActive
          ? `0 0 18px ${skin.labelColor}60, 0 0 6px ${skin.labelColor}40`
          : hovered
          ? `0 0 10px ${skin.labelColor}30`
          : undefined,
      }}
      title={skin.name}
    >
      <div
        className="h-16 relative overflow-hidden"
        style={{
          backgroundImage: `url(${skin.bgImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* Animated video preview on hover */}
        {videoSrc && (
          <video
            ref={videoRef}
            src={videoSrc}
            muted
            loop
            playsInline
            preload="none"
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
            style={{ opacity: hovered ? 1 : 0 }}
          />
        )}
        <div className="absolute inset-0 bg-black/40" />
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
}

// ── SkinSelector ──────────────────────────────────────────────────────────────
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

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
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
        title="Change background skin (hover thumbnails to preview)"
        aria-label="Change background skin"
        aria-expanded={open}
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
              const videoSrc = SKIN_VIDEO[skin.id as SkinId];
              return (
                <SkinThumb
                  key={skin.id}
                  skin={skin}
                  isActive={isActive}
                  videoSrc={videoSrc}
                  onSelect={() => handleSelect(skin.id as SkinId)}
                />
              );
            })}
          </div>

          <p className="text-[10px] text-muted-foreground/40 text-center mt-3">
            Hover to preview · Click to apply
          </p>
        </div>
      )}
    </div>
  );
}
