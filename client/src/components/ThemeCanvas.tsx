/**
 * ThemeCanvas — full-viewport animated background
 * Andromeda v7.5.0 — Real AI-generated images with CSS animation overlays
 *
 * Each skin uses a high-quality AI-generated 2560×1440 background image
 * with CSS keyframe animations for motion: Ken Burns zoom/pan, parallax,
 * particle overlays, and skin-specific effects.
 *
 * No canvas emoji art. Real cinematic backgrounds.
 */
import { useEffect, useRef, useState } from "react";
import type { SkinId } from "@/lib/themeEngine";
import { SKINS } from "@/lib/themeEngine";

interface ThemeCanvasProps {
  skin: SkinId;
}

export function ThemeCanvas({ skin }: ThemeCanvasProps) {
  const [visible, setVisible] = useState(true);
  const [activeSkin, setActiveSkin] = useState(skin);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cross-fade: fade out → swap image → fade in
  useEffect(() => {
    if (skin === activeSkin) return;
    setVisible(false);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => {
      setActiveSkin(skin);
      setVisible(true);
    }, 500);
    return () => { if (fadeTimer.current) clearTimeout(fadeTimer.current); };
  }, [skin, activeSkin]);

  const meta = SKINS.find((s) => s.id === activeSkin) ?? SKINS[0];

  return (
    <>
      {/* CSS animation keyframes injected once */}
      <style>{SKIN_KEYFRAMES}</style>

      {/* Background image layer */}
      <div
        className={`theme-bg ${meta.animClass}`}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          overflow: "hidden",
          opacity: visible ? 1 : 0,
          transition: "opacity 0.5s ease",
        }}
      >
        {/* The actual background image */}
        <div
          className={`theme-bg-img ${meta.animClass}-img`}
          style={{
            position: "absolute",
            inset: "-5%", // slightly oversized so Ken Burns zoom doesn't show edges
            backgroundImage: `url(${meta.bgImage})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        />

        {/* Overlay tint for readability */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: meta.overlayColor,
            zIndex: 1,
          }}
        />

        {/* Skin-specific particle/effect overlays */}
        {activeSkin === "aurora" && <AuroraOverlay />}
        {activeSkin === "goth" && <GothOverlay />}
        {activeSkin === "cyberpunk" && <CyberpunkOverlay />}
        {activeSkin === "lofi" && <LoFiOverlay />}
        {activeSkin === "spacestation" && <SpaceOverlay />}
        {activeSkin === "luigismansion" && <LuigiOverlay />}
        {activeSkin === "monsters" && <MonstersOverlay />}
        {activeSkin === "nature" && <NatureOverlay />}
        {activeSkin === "finalfantasy" && <FFOverlay />}

        {/* Vignette — always present */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.65) 100%)",
            zIndex: 3,
            pointerEvents: "none",
          }}
        />
      </div>
    </>
  );
}

// ─── Aurora Overlay: floating light wisps ───────────────────────────────────
function AuroraOverlay() {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${10 + i * 18}%`,
            top: `${5 + (i % 3) * 8}%`,
            width: `${200 + i * 60}px`,
            height: `${60 + i * 20}px`,
            background: `radial-gradient(ellipse, ${["rgba(80,255,180,0.08)","rgba(120,80,255,0.07)","rgba(40,200,255,0.06)","rgba(180,80,255,0.07)","rgba(60,255,140,0.06)"][i]}, transparent)`,
            borderRadius: "50%",
            animation: `aurora-wisp ${4 + i * 1.5}s ease-in-out infinite alternate`,
            animationDelay: `${i * 0.8}s`,
            filter: "blur(8px)",
          }}
        />
      ))}
    </div>
  );
}

// ─── Goth Overlay: floating bat silhouettes ──────────────────────────────────
function GothOverlay() {
  const bats = [
    { left: "15%", top: "18%", delay: "0s", dur: "12s", scale: 0.8 },
    { left: "72%", top: "12%", delay: "2s", dur: "9s", scale: 1.1 },
    { left: "45%", top: "8%", delay: "4s", dur: "14s", scale: 0.7 },
    { left: "28%", top: "25%", delay: "1s", dur: "11s", scale: 0.9 },
    { left: "85%", top: "22%", delay: "3s", dur: "10s", scale: 0.6 },
    { left: "60%", top: "30%", delay: "5s", dur: "13s", scale: 1.0 },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
      {bats.map((bat, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: bat.left,
            top: bat.top,
            fontSize: `${18 * bat.scale}px`,
            animation: `bat-fly ${bat.dur} ease-in-out infinite`,
            animationDelay: bat.delay,
            opacity: 0.7,
            filter: "drop-shadow(0 0 4px rgba(180,80,255,0.5))",
          }}
        >
          🦇
        </div>
      ))}
      {/* Purple mist at bottom */}
      <div style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: "25%",
        background: "linear-gradient(to top, rgba(60,0,80,0.4), transparent)",
        animation: "mist-pulse 6s ease-in-out infinite alternate",
      }} />
    </div>
  );
}

// ─── Cyberpunk Overlay: rain streaks + scan line ─────────────────────────────
function CyberpunkOverlay() {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none", overflow: "hidden" }}>
      {/* Rain streaks */}
      {[...Array(40)].map((_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${(i * 2.5) % 100}%`,
            top: "-10%",
            width: "1px",
            height: `${40 + (i % 5) * 20}px`,
            background: `rgba(${i % 2 === 0 ? "0,200,255" : "255,80,180"},${0.15 + (i % 4) * 0.05})`,
            animation: `rain-fall ${0.6 + (i % 5) * 0.2}s linear infinite`,
            animationDelay: `${(i * 0.07) % 1.5}s`,
          }}
        />
      ))}
      {/* Scanline */}
      <div style={{
        position: "absolute",
        inset: 0,
        background: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.03) 3px, rgba(0,0,0,0.03) 4px)",
        pointerEvents: "none",
      }} />
    </div>
  );
}

// ─── Lo-Fi Overlay: rain on glass ────────────────────────────────────────────
function LoFiOverlay() {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none", overflow: "hidden" }}>
      {[...Array(25)].map((_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${(i * 4) % 100}%`,
            top: "-5%",
            width: "1.5px",
            height: `${20 + (i % 4) * 15}px`,
            background: `rgba(180,200,255,${0.12 + (i % 3) * 0.04})`,
            borderRadius: "1px",
            animation: `rain-fall ${1.2 + (i % 4) * 0.3}s linear infinite`,
            animationDelay: `${(i * 0.12) % 2}s`,
          }}
        />
      ))}
      {/* Warm amber glow from desk lamp area (left side) */}
      <div style={{
        position: "absolute",
        left: "5%",
        top: "30%",
        width: "300px",
        height: "300px",
        background: "radial-gradient(ellipse, rgba(255,180,60,0.06), transparent)",
        animation: "lamp-flicker 4s ease-in-out infinite alternate",
        filter: "blur(20px)",
      }} />
    </div>
  );
}

// ─── Space Overlay: floating particles ───────────────────────────────────────
function SpaceOverlay() {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
      {[...Array(20)].map((_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${(i * 5.3 + 10) % 90}%`,
            top: `${(i * 7.1 + 5) % 85}%`,
            width: `${2 + (i % 3)}px`,
            height: `${2 + (i % 3)}px`,
            borderRadius: "50%",
            background: `rgba(${i % 3 === 0 ? "200,180,255" : i % 3 === 1 ? "100,200,255" : "255,200,150"},${0.4 + (i % 4) * 0.1})`,
            animation: `star-twinkle ${2 + (i % 4)}s ease-in-out infinite alternate`,
            animationDelay: `${i * 0.3}s`,
          }}
        />
      ))}
      {/* Blue LED strip glow at top */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: "3px",
        background: "linear-gradient(90deg, transparent, rgba(0,180,255,0.6), rgba(100,80,255,0.6), transparent)",
        animation: "led-pulse 3s ease-in-out infinite alternate",
        boxShadow: "0 0 20px rgba(0,180,255,0.3)",
      }} />
    </div>
  );
}

// ─── Luigi's Mansion Overlay: ghost glow pulses ───────────────────────────────
function LuigiOverlay() {
  const ghosts = [
    { left: "12%", top: "35%", color: "rgba(80,255,120,0.12)", size: 120 },
    { left: "78%", top: "20%", color: "rgba(160,80,255,0.10)", size: 100 },
    { left: "50%", top: "45%", color: "rgba(80,200,255,0.08)", size: 80 },
    { left: "88%", top: "55%", color: "rgba(80,255,120,0.09)", size: 90 },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
      {ghosts.map((g, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: g.left,
            top: g.top,
            width: `${g.size}px`,
            height: `${g.size}px`,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${g.color}, transparent)`,
            animation: `ghost-pulse ${3 + i * 0.7}s ease-in-out infinite alternate`,
            animationDelay: `${i * 0.9}s`,
            filter: "blur(15px)",
          }}
        />
      ))}
      {/* Chandelier flicker at top center */}
      <div style={{
        position: "absolute",
        top: "5%",
        left: "40%",
        width: "20%",
        height: "30%",
        background: "radial-gradient(ellipse, rgba(100,200,255,0.08), transparent)",
        animation: "chandelier-flicker 2s ease-in-out infinite",
        filter: "blur(10px)",
      }} />
    </div>
  );
}

// ─── Monsters Inc Overlay: colored light pulses ───────────────────────────────
function MonstersOverlay() {
  const lights = [
    { left: "10%", color: "rgba(0,200,255,0.08)" },
    { left: "30%", color: "rgba(255,80,180,0.07)" },
    { left: "55%", color: "rgba(80,255,120,0.07)" },
    { left: "75%", color: "rgba(255,180,0,0.08)" },
    { left: "90%", color: "rgba(180,80,255,0.07)" },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
      {lights.map((l, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: l.left,
            top: 0,
            width: "200px",
            height: "50%",
            background: `linear-gradient(to bottom, ${l.color}, transparent)`,
            animation: `factory-light ${2 + i * 0.4}s ease-in-out infinite alternate`,
            animationDelay: `${i * 0.6}s`,
            filter: "blur(20px)",
          }}
        />
      ))}
    </div>
  );
}

// ─── Nature Overlay: light shaft pulses ──────────────────────────────────────
function NatureOverlay() {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${15 + i * 20}%`,
            top: 0,
            width: `${30 + i * 10}px`,
            height: "70%",
            background: `linear-gradient(to bottom, rgba(255,220,100,${0.04 + i * 0.01}), transparent)`,
            transform: `rotate(${-5 + i * 3}deg)`,
            transformOrigin: "top center",
            animation: `light-shaft ${5 + i * 1.5}s ease-in-out infinite alternate`,
            animationDelay: `${i * 1.2}s`,
            filter: "blur(4px)",
          }}
        />
      ))}
      {/* Bioluminescent glow at bottom right */}
      <div style={{
        position: "absolute",
        right: "8%",
        bottom: "15%",
        width: "150px",
        height: "150px",
        background: "radial-gradient(circle, rgba(80,255,180,0.08), transparent)",
        animation: "bio-glow 4s ease-in-out infinite alternate",
        filter: "blur(12px)",
      }} />
    </div>
  );
}

// ─── Final Fantasy Overlay: magic circle glow ────────────────────────────────
function FFOverlay() {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
      {/* Crystal glow pulses */}
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${20 + i * 25}%`,
            top: `${20 + i * 10}%`,
            width: "80px",
            height: "200px",
            background: `linear-gradient(to bottom, rgba(${i === 0 ? "100,150,255" : i === 1 ? "180,100,255" : "100,220,255"},0.10), transparent)`,
            animation: `crystal-pulse ${3 + i}s ease-in-out infinite alternate`,
            animationDelay: `${i * 1.1}s`,
            filter: "blur(8px)",
          }}
        />
      ))}
      {/* Summon circle on ground */}
      <div style={{
        position: "absolute",
        bottom: "18%",
        left: "15%",
        width: "180px",
        height: "180px",
        borderRadius: "50%",
        border: "1px solid rgba(100,150,255,0.2)",
        boxShadow: "0 0 30px rgba(100,150,255,0.15), inset 0 0 30px rgba(100,150,255,0.08)",
        animation: "summon-spin 12s linear infinite",
      }} />
    </div>
  );
}

// ─── CSS Keyframes for all skin animations ────────────────────────────────────
const SKIN_KEYFRAMES = `
  /* Ken Burns zoom-pan for all backgrounds */
  .skin-aurora-img { animation: kb-aurora 25s ease-in-out infinite alternate; }
  .skin-goth-img { animation: kb-goth 30s ease-in-out infinite alternate; }
  .skin-nature-img { animation: kb-nature 28s ease-in-out infinite alternate; }
  .skin-cyberpunk-img { animation: kb-cyberpunk 20s ease-in-out infinite alternate; }
  .skin-finalfantasy-img { animation: kb-ff 32s ease-in-out infinite alternate; }
  .skin-monsters-img { animation: kb-monsters 22s ease-in-out infinite alternate; }
  .skin-lofi-img { animation: kb-lofi 35s ease-in-out infinite alternate; }
  .skin-space-img { animation: kb-space 40s ease-in-out infinite alternate; }
  .skin-luigi-img { animation: kb-luigi 28s ease-in-out infinite alternate; }

  @keyframes kb-aurora {
    from { transform: scale(1.0) translate(0%, 0%); }
    to   { transform: scale(1.08) translate(-2%, 1%); }
  }
  @keyframes kb-goth {
    from { transform: scale(1.0) translate(0%, 0%); }
    to   { transform: scale(1.06) translate(1%, -1%); }
  }
  @keyframes kb-nature {
    from { transform: scale(1.0) translate(0%, 0%); }
    to   { transform: scale(1.07) translate(-1.5%, 0.5%); }
  }
  @keyframes kb-cyberpunk {
    from { transform: scale(1.0) translate(0%, 0%); }
    to   { transform: scale(1.05) translate(1%, 0.5%); }
  }
  @keyframes kb-ff {
    from { transform: scale(1.0) translate(0%, 0%); }
    to   { transform: scale(1.08) translate(-1%, -1.5%); }
  }
  @keyframes kb-monsters {
    from { transform: scale(1.0) translate(0%, 0%); }
    to   { transform: scale(1.06) translate(0.5%, 1%); }
  }
  @keyframes kb-lofi {
    from { transform: scale(1.0) translate(0%, 0%); }
    to   { transform: scale(1.04) translate(-0.5%, 0.5%); }
  }
  @keyframes kb-space {
    from { transform: scale(1.0) translate(0%, 0%); }
    to   { transform: scale(1.06) translate(0%, -1%); }
  }
  @keyframes kb-luigi {
    from { transform: scale(1.0) translate(0%, 0%); }
    to   { transform: scale(1.07) translate(-1%, 0.5%); }
  }

  /* Overlay effect animations */
  @keyframes aurora-wisp {
    from { opacity: 0.4; transform: translateX(0) scaleX(1); }
    to   { opacity: 0.9; transform: translateX(20px) scaleX(1.15); }
  }
  @keyframes bat-fly {
    0%   { transform: translate(0,0) rotate(-5deg); opacity: 0.5; }
    25%  { transform: translate(30px,-15px) rotate(8deg); opacity: 0.8; }
    50%  { transform: translate(60px,5px) rotate(-3deg); opacity: 0.6; }
    75%  { transform: translate(30px,20px) rotate(6deg); opacity: 0.7; }
    100% { transform: translate(0,0) rotate(-5deg); opacity: 0.5; }
  }
  @keyframes mist-pulse {
    from { opacity: 0.6; }
    to   { opacity: 1.0; }
  }
  @keyframes rain-fall {
    from { transform: translateY(0) translateX(0); opacity: 1; }
    to   { transform: translateY(110vh) translateX(-10px); opacity: 0.3; }
  }
  @keyframes lamp-flicker {
    0%   { opacity: 0.6; }
    50%  { opacity: 1.0; }
    75%  { opacity: 0.8; }
    100% { opacity: 0.9; }
  }
  @keyframes star-twinkle {
    from { opacity: 0.3; transform: scale(0.8); }
    to   { opacity: 1.0; transform: scale(1.2); }
  }
  @keyframes led-pulse {
    from { opacity: 0.5; }
    to   { opacity: 1.0; }
  }
  @keyframes ghost-pulse {
    from { opacity: 0.4; transform: scale(0.9) translateY(0); }
    to   { opacity: 0.9; transform: scale(1.1) translateY(-8px); }
  }
  @keyframes chandelier-flicker {
    0%   { opacity: 0.5; }
    20%  { opacity: 1.0; }
    22%  { opacity: 0.3; }
    24%  { opacity: 1.0; }
    80%  { opacity: 0.8; }
    100% { opacity: 0.6; }
  }
  @keyframes factory-light {
    from { opacity: 0.4; }
    to   { opacity: 1.0; }
  }
  @keyframes light-shaft {
    from { opacity: 0.3; transform: rotate(-5deg) scaleX(0.8); }
    to   { opacity: 0.8; transform: rotate(-2deg) scaleX(1.2); }
  }
  @keyframes bio-glow {
    from { opacity: 0.4; transform: scale(0.9); }
    to   { opacity: 0.9; transform: scale(1.1); }
  }
  @keyframes crystal-pulse {
    from { opacity: 0.4; transform: scaleY(0.95); }
    to   { opacity: 1.0; transform: scaleY(1.05); }
  }
  @keyframes summon-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  /* Reduced motion: disable all animations */
  @media (prefers-reduced-motion: reduce) {
    .skin-aurora-img, .skin-goth-img, .skin-nature-img, .skin-cyberpunk-img,
    .skin-finalfantasy-img, .skin-monsters-img, .skin-lofi-img, .skin-space-img,
    .skin-luigi-img { animation: none !important; }
  }
`;
