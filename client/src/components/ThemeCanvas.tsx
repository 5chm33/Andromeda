/**
 * ThemeCanvas v7.9.0
 * AI-generated looping video backgrounds.
 * Each skin has an 8-second MP4 loop playing behind the UI.
 * Still image shows instantly while video loads (no flash of black).
 * Skin switching: 600ms crossfade, video restarted from 0.
 */

import { useEffect, useRef, useState } from "react";
import { SKINS, getSavedSkin, saveSkin, applySkinAccent, type SkinId } from "@/lib/themeEngine";

// ─── Asset map ────────────────────────────────────────────────────────────────
interface SkinAssets {
  poster: string;   // shown instantly while video loads
  video:  string;   // looping MP4
}

const SKIN_ASSETS: Record<SkinId, SkinAssets> = {
  aurora:        { poster: "/skins/aurora.jpg",          video: "/skins/videos/aurora.mp4"        },
  goth:          { poster: "/skins/goth.jpg",            video: "/skins/videos/goth.mp4"          },
  nature:        { poster: "/skins/nature_forest.jpg",   video: "/skins/videos/nature.mp4"        },
  cyberpunk:     { poster: "/skins/cyberpunk.jpg",       video: "/skins/videos/cyberpunk.mp4"     },
  finalfantasy:  { poster: "/skins/finalfantasy.jpg",    video: "/skins/videos/finalfantasy.mp4"  },
  monsters:      { poster: "/skins/monsters.jpg",        video: "/skins/videos/monsters.mp4"      },
  lofi:          { poster: "/skins/lofi.jpg",            video: "/skins/videos/lofi.mp4"          },
  spacestation:  { poster: "/skins/space.jpg",           video: "/skins/videos/space.mp4"         },
  luigismansion: { poster: "/skins/luigis_mansion.jpg",  video: "/skins/videos/luigis_mansion.mp4"},
  stealth:       { poster: "/skins/stealth.jpg",           video: ""                                  },
};

const SKIN_SWITCH_MS = 600;

// ─── ThemeCanvas ─────────────────────────────────────────────────────────────
interface ThemeCanvasProps {
  skinId?: SkinId;
  onSkinChange?: (id: SkinId) => void;
  className?: string;
}

export function ThemeCanvas({ skinId, onSkinChange, className = "" }: ThemeCanvasProps) {
  const [currentSkin, setCurrentSkin] = useState<SkinId>(skinId ?? getSavedSkin());
  const [visible, setVisible] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Sync external skinId prop
  useEffect(() => {
    if (skinId && skinId !== currentSkin) {
      switchSkin(skinId);
    }
  }, [skinId]);

  // Apply accent color on skin change
  useEffect(() => {
    applySkinAccent(currentSkin);
  }, [currentSkin]);

  // When skin changes, restart video from beginning
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const videoSrc = SKIN_ASSETS[currentSkin].video;
    if (!videoSrc) {
      vid.pause();
      vid.removeAttribute("src");
      return;
    }
    vid.src = videoSrc;
    vid.load();
    vid.play().catch(() => {
      // Autoplay blocked — video will play on first user interaction
    });
  }, [currentSkin]);

  function switchSkin(id: SkinId) {
    if (id === currentSkin) return;
    setVisible(false);
    setTimeout(() => {
      setCurrentSkin(id);
      saveSkin(id);
      if (onSkinChange) onSkinChange(id);
      setVisible(true);
    }, SKIN_SWITCH_MS);
  }

  const assets = SKIN_ASSETS[currentSkin];
  const skinMeta = SKINS.find((s) => s.id === currentSkin)!;
  const reducedMotion = typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div
      className={`theme-canvas-root ${className}`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        overflow: "hidden",
        opacity: visible ? 1 : 0,
        transition: `opacity ${SKIN_SWITCH_MS}ms ease-in-out`,
      }}
    >
      {/* Still image poster — visible instantly, sits behind the video */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url(${assets.poster})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />

      {/* Looping video — fades in once loaded, covers the poster */}
      {!reducedMotion && assets.video && (
        <video
          ref={videoRef}
          key={currentSkin}
          src={assets.video}
          poster={assets.poster}
          autoPlay
          loop
          muted
          playsInline
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center",
          }}
        />
      )}

      {/* Overlay tint for UI readability */}
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
