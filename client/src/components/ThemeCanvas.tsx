/**
 * ThemeCanvas v7.8.0
 * Pure crossfade slideshow — 2 AI-generated frames per skin, slow crossfade loop.
 * Zero overlays, zero emoji, zero pasted graphics.
 * The background itself breathes between two cinematic frames.
 */

import { useEffect, useRef, useState } from "react";
import { SKINS, getSavedSkin, saveSkin, applySkinAccent, type SkinId } from "@/lib/themeEngine";

// ─── Frame definitions ────────────────────────────────────────────────────────
const SKIN_FRAMES: Record<SkinId, string[]> = {
  aurora:        ["/skins/aurora.jpg",          "/skins/aurora_2.jpg"],
  goth:          ["/skins/goth.jpg",            "/skins/goth_2.jpg"],
  nature:        ["/skins/nature_forest.jpg",   "/skins/nature_forest_2.jpg"],
  cyberpunk:     ["/skins/cyberpunk.jpg",       "/skins/cyberpunk_2.jpg"],
  finalfantasy:  ["/skins/finalfantasy.jpg",    "/skins/finalfantasy_2.jpg"],
  monsters:      ["/skins/monsters.jpg",        "/skins/monsters_2.jpg"],
  lofi:          ["/skins/lofi.jpg",            "/skins/lofi_2.jpg"],
  spacestation:  ["/skins/space.jpg",           "/skins/space_2.jpg"],
  luigismansion: ["/skins/luigis_mansion.jpg",  "/skins/luigis_mansion_2.jpg"],
};

// How long each frame is shown before crossfading to the next (ms)
const FRAME_HOLD_MS = 9000;
// How long the crossfade transition takes (ms)
const FADE_MS = 3000;
// How long the skin-switch transition takes (ms)
const SKIN_SWITCH_MS = 600;

// ─── Preload all images on mount ─────────────────────────────────────────────
function preloadAll() {
  const allUrls = Object.values(SKIN_FRAMES).flat();
  allUrls.forEach((url) => {
    const img = new Image();
    img.src = url;
  });
}

// ─── ThemeCanvas ─────────────────────────────────────────────────────────────
interface ThemeCanvasProps {
  skinId?: SkinId;
  onSkinChange?: (id: SkinId) => void;
  className?: string;
}

export function ThemeCanvas({ skinId, onSkinChange, className = "" }: ThemeCanvasProps) {
  const [currentSkin, setCurrentSkin] = useState<SkinId>(skinId ?? getSavedSkin());
  const [frameIndex, setFrameIndex] = useState(0);       // which frame is "active"
  const [fading, setFading] = useState(false);            // crossfade in progress
  const [skinVisible, setSkinVisible] = useState(true);   // for skin-switch fade
  const frameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external skinId prop
  useEffect(() => {
    if (skinId && skinId !== currentSkin) {
      handleSkinSwitch(skinId);
    }
  }, [skinId]);

  // Preload everything once on mount
  useEffect(() => {
    preloadAll();
  }, []);

  // Apply skin accent color whenever skin changes
  useEffect(() => {
    applySkinAccent(currentSkin);
  }, [currentSkin]);

  // Frame crossfade loop
  useEffect(() => {
    const frames = SKIN_FRAMES[currentSkin];
    if (frames.length < 2) return;

    // Respect reduced motion preference
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    function scheduleNext() {
      frameTimer.current = setTimeout(() => {
        // Start fade
        setFading(true);
        fadeTimer.current = setTimeout(() => {
          // Swap frame at midpoint of fade
          setFrameIndex((prev) => (prev + 1) % frames.length);
          setFading(false);
          scheduleNext();
        }, FADE_MS);
      }, FRAME_HOLD_MS);
    }

    scheduleNext();

    return () => {
      if (frameTimer.current) clearTimeout(frameTimer.current);
      if (fadeTimer.current)  clearTimeout(fadeTimer.current);
    };
  }, [currentSkin]);

  function handleSkinSwitch(id: SkinId) {
    if (id === currentSkin) return;
    // Clear existing timers
    if (frameTimer.current) clearTimeout(frameTimer.current);
    if (fadeTimer.current)  clearTimeout(fadeTimer.current);

    // Fade out, swap, fade in
    setSkinVisible(false);
    setTimeout(() => {
      setCurrentSkin(id);
      setFrameIndex(0);
      setFading(false);
      saveSkin(id);
      if (onSkinChange) onSkinChange(id);
      setSkinVisible(true);
    }, SKIN_SWITCH_MS);
  }

  const frames = SKIN_FRAMES[currentSkin];
  const skinMeta = SKINS.find((s) => s.id === currentSkin)!;

  // Frame A is always the "current" frame; Frame B is the "next" frame
  const frameA = frames[frameIndex];
  const frameB = frames[(frameIndex + 1) % frames.length];

  return (
    <div
      className={`theme-canvas-root ${className}`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        overflow: "hidden",
        opacity: skinVisible ? 1 : 0,
        transition: `opacity ${SKIN_SWITCH_MS}ms ease-in-out`,
      }}
    >
      {/* Frame A — always visible underneath */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url(${frameA})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />

      {/* Frame B — fades in on top during crossfade */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url(${frameB})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          opacity: fading ? 1 : 0,
          transition: fading ? `opacity ${FADE_MS}ms ease-in-out` : "none",
        }}
      />

      {/* Overlay tint for readability */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: skinMeta.overlayColor,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

export default ThemeCanvas;
