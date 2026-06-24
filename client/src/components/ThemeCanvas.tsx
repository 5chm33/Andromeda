/**
 * ThemeCanvas v9.3.0
 * AI-generated looping video backgrounds with mouse parallax.
 * - Each skin has an 8-second MP4 loop playing behind the UI.
 * - Still image shows instantly while video loads (no flash of black).
 * - Skin switching: 600ms crossfade, video restarted from 0.
 * - Mouse parallax: subtle 12px drift on background layer for depth.
 * - Respects prefers-reduced-motion.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { SKINS, getSavedSkin, saveSkin, applySkinAccent, type SkinId } from "@/lib/themeEngine";

// ─── Asset map ────────────────────────────────────────────────────────────────
interface SkinAssets {
  poster: string;   // shown instantly while video loads
  video:  string;   // looping MP4
}

const SKIN_ASSETS: Record<SkinId, SkinAssets> = {
  andromeda:     { poster: "/skins/andromeda.jpg",       video: "/skins/videos/andromeda.mp4"     },
  andromeda2:    { poster: "/skins/andromeda2.jpg",      video: "/skins/videos/andromeda2.mp4"    },
  aurora:        { poster: "/skins/aurora.jpg",          video: "/skins/videos/aurora.mp4"        },
  goth:          { poster: "/skins/goth.jpg",            video: "/skins/videos/goth.mp4"          },
  nature:        { poster: "/skins/nature_forest.jpg",   video: "/skins/videos/nature.mp4"        },
  cyberpunk:     { poster: "/skins/cyberpunk.jpg",       video: "/skins/videos/cyberpunk.mp4"     },
  finalfantasy:  { poster: "/skins/finalfantasy.jpg",    video: "/skins/videos/finalfantasy.mp4"  },
  monsters:      { poster: "/skins/monsters.jpg",        video: "/skins/videos/monsters.mp4"      },
  lofi:          { poster: "/skins/lofi.jpg",            video: "/skins/videos/lofi.mp4"          },
  spacestation:  { poster: "/skins/space.jpg",           video: "/skins/videos/space.mp4"         },
  luigismansion: { poster: "/skins/luigis_mansion.jpg",  video: "/skins/videos/luigis_mansion.mp4"},
  stealth:       { poster: "/skins/stealth.jpg",         video: ""                                },
};

const SKIN_SWITCH_MS = 600;
// Max parallax offset in px — background shifts by this amount at screen edges
const PARALLAX_PX = 14;

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
  const bgLayerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const targetRef = useRef({ x: 0, y: 0 });
  const currentRef = useRef({ x: 0, y: 0 });

  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── Mouse parallax ──────────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (reducedMotion) return;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    // Normalise to [-1, 1]
    targetRef.current = {
      x: ((e.clientX - cx) / cx) * PARALLAX_PX,
      y: ((e.clientY - cy) / cy) * PARALLAX_PX,
    };
  }, [reducedMotion]);

  // Smooth lerp animation loop
  useEffect(() => {
    if (reducedMotion) return;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const animate = () => {
      currentRef.current.x = lerp(currentRef.current.x, targetRef.current.x, 0.06);
      currentRef.current.y = lerp(currentRef.current.y, targetRef.current.y, 0.06);

      if (bgLayerRef.current) {
        // Slightly over-scale the background so parallax shift doesn't reveal edges
        bgLayerRef.current.style.transform =
          `translate(${currentRef.current.x}px, ${currentRef.current.y}px) scale(1.04)`;
      }
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    window.addEventListener("mousemove", handleMouseMove, { passive: true });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, [reducedMotion, handleMouseMove]);

  // ── Sync external skinId prop ───────────────────────────────────────────────
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
      {/* Parallax background layer — slightly over-sized to allow shift */}
      <div
        ref={bgLayerRef}
        style={{
          position: "absolute",
          inset: `-${PARALLAX_PX * 2}px`,
          willChange: "transform",
          transformOrigin: "center center",
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
      </div>

      {/* Overlay tint for UI readability — NOT in parallax layer */}
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
