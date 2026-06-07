/**
 * ThemeCanvas — full-viewport animated background
 * Andromeda v7.7.0
 *
 * Approach: Real AI-generated background images as the base, with
 * real AI-generated overlay PNG assets animated via CSS transforms.
 * No SVG shapes, no emoji, no cartoon elements.
 * The scene itself feels alive through layered depth motion.
 *
 * Techniques used:
 * - Ken Burns slow zoom/pan on the base image
 * - Overlay PNGs animated with CSS: drift, float, scroll, parallax
 * - Multiple staggered copies of overlay assets for continuous looping
 * - CSS backdrop-filter blur for depth
 * - 600ms cross-fade on skin switch
 * - All images preloaded on mount for instant switching
 */
import { useEffect, useRef, useState } from "react";
import type { SkinId } from "@/lib/themeEngine";
import { SKINS } from "@/lib/themeEngine";

interface ThemeCanvasProps {
  skin: SkinId;
}

// Preload all skin background images + overlay assets once
const OVERLAY_ASSETS = [
  "/skins/overlays/goth_bats.png",
  "/skins/overlays/nature_fog.png",
  "/skins/overlays/lofi_rain.png",
  "/skins/overlays/luigi_ghost.png",
  "/skins/overlays/cyberpunk_rain.png",
  "/skins/overlays/aurora_particles.png",
];

let preloaded = false;
function preloadAll() {
  if (preloaded) return;
  preloaded = true;
  [...SKINS.map((s) => s.bgImage), ...OVERLAY_ASSETS].forEach((src) => {
    const img = new Image();
    img.src = src;
  });
}

export function ThemeCanvas({ skin }: ThemeCanvasProps) {
  const [activeSkin, setActiveSkin] = useState(skin);
  const [nextSkin, setNextSkin] = useState<SkinId | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => { preloadAll(); }, []);

  useEffect(() => {
    if (skin === activeSkin) return;
    setNextSkin(skin);
    setTransitioning(false);
    const t1 = setTimeout(() => setTransitioning(true), 30);
    const t2 = setTimeout(() => {
      setActiveSkin(skin);
      setNextSkin(null);
      setTransitioning(false);
    }, 600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [skin]); // eslint-disable-line

  const activeMeta = SKINS.find((s) => s.id === activeSkin) ?? SKINS[0];
  const nextMeta = nextSkin ? SKINS.find((s) => s.id === nextSkin) : null;

  return (
    <>
      <style>{KEYFRAMES}</style>
      <BgLayer meta={activeMeta} opacity={1} />
      {nextMeta && (
        <BgLayer
          meta={nextMeta}
          opacity={transitioning ? 1 : 0}
          style={{ transition: "opacity 0.55s ease" }}
        />
      )}
    </>
  );
}

// ─── Single background layer ──────────────────────────────────────────────────
function BgLayer({
  meta,
  opacity,
  style,
}: {
  meta: (typeof SKINS)[0];
  opacity: number;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", opacity, ...style }}>
      {/* Base background image with Ken Burns */}
      <div
        className={`${meta.animClass}-img`}
        style={{
          position: "absolute",
          inset: "-6%",
          backgroundImage: `url(${meta.bgImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />

      {/* Readability tint */}
      <div style={{ position: "absolute", inset: 0, background: meta.overlayColor, zIndex: 1, pointerEvents: "none" }} />

      {/* Per-skin overlay layers */}
      <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none", overflow: "hidden" }}>
        {meta.id === "aurora"        && <AuroraLayers />}
        {meta.id === "goth"          && <GothLayers />}
        {meta.id === "nature"        && <NatureLayers />}
        {meta.id === "cyberpunk"     && <CyberpunkLayers />}
        {meta.id === "lofi"          && <LoFiLayers />}
        {meta.id === "spacestation"  && <SpaceLayers />}
        {meta.id === "luigismansion" && <LuigiLayers />}
        {meta.id === "monsters"      && <MonstersLayers />}
        {meta.id === "finalfantasy"  && <FFLayers />}
      </div>

      {/* Vignette */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 3, pointerEvents: "none",
        background: "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.65) 100%)",
      }} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// AURORA — aurora particle wisps drifting slowly across the sky
// ════════════════════════════════════════════════════════════════════════════════
function AuroraLayers() {
  return (
    <>
      {/* Aurora particle sheet — drifts right slowly */}
      <div className="overlay-aurora-drift1" style={{
        position: "absolute", inset: 0,
        backgroundImage: "url(/skins/overlays/aurora_particles.png)",
        backgroundSize: "100% 60%",
        backgroundPosition: "center top",
        backgroundRepeat: "no-repeat",
        opacity: 0.55,
        mixBlendMode: "screen",
      }} />
      {/* Second copy offset — continuous loop */}
      <div className="overlay-aurora-drift2" style={{
        position: "absolute", inset: 0,
        backgroundImage: "url(/skins/overlays/aurora_particles.png)",
        backgroundSize: "100% 60%",
        backgroundPosition: "center top",
        backgroundRepeat: "no-repeat",
        opacity: 0.35,
        mixBlendMode: "screen",
        transform: "translateX(100%)",
      }} />
      {/* Subtle color pulse overlay */}
      <div className="overlay-aurora-pulse" style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse 80% 40% at 50% 20%, rgba(60,255,160,0.06) 0%, transparent 70%)",
      }} />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// GOTH — bat flock drifting across the moon, purple mist rising
// ════════════════════════════════════════════════════════════════════════════════
function GothLayers() {
  return (
    <>
      {/* Bat flock — scrolls left to right slowly across upper portion */}
      <div className="overlay-goth-bats1" style={{
        position: "absolute",
        top: "5%",
        left: 0,
        width: "100%",
        height: "45%",
        backgroundImage: "url(/skins/overlays/goth_bats.png)",
        backgroundSize: "70% auto",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "left center",
        opacity: 0.75,
        mixBlendMode: "multiply",
      }} />
      {/* Second bat group — offset timing, different height */}
      <div className="overlay-goth-bats2" style={{
        position: "absolute",
        top: "12%",
        left: 0,
        width: "100%",
        height: "35%",
        backgroundImage: "url(/skins/overlays/goth_bats.png)",
        backgroundSize: "50% auto",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "left center",
        opacity: 0.5,
        mixBlendMode: "multiply",
        transform: "translateX(-100%) scaleX(-1)",
      }} />
      {/* Purple ground mist — breathes in/out */}
      <div className="overlay-goth-mist" style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        width: "100%",
        height: "30%",
        background: "linear-gradient(to top, rgba(40,0,60,0.5) 0%, rgba(40,0,60,0.2) 50%, transparent 100%)",
        filter: "blur(8px)",
      }} />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// NATURE — ground fog drifting, firefly glow layer pulsing
// ════════════════════════════════════════════════════════════════════════════════
function NatureLayers() {
  return (
    <>
      {/* Ground fog layer — drifts slowly right */}
      <div className="overlay-nature-fog1" style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        width: "200%",
        height: "55%",
        backgroundImage: "url(/skins/overlays/nature_fog.png)",
        backgroundSize: "50% 100%",
        backgroundRepeat: "repeat-x",
        backgroundPosition: "left bottom",
        opacity: 0.65,
        mixBlendMode: "screen",
      }} />
      {/* Second fog layer — slightly faster, different opacity */}
      <div className="overlay-nature-fog2" style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        width: "200%",
        height: "40%",
        backgroundImage: "url(/skins/overlays/nature_fog.png)",
        backgroundSize: "50% 100%",
        backgroundRepeat: "repeat-x",
        backgroundPosition: "left bottom",
        opacity: 0.40,
        mixBlendMode: "screen",
        transform: "translateX(-25%)",
      }} />
      {/* Firefly glow pulse */}
      <div className="overlay-nature-glow" style={{
        position: "absolute",
        bottom: "10%",
        right: "5%",
        width: "30%",
        height: "40%",
        background: "radial-gradient(ellipse at center, rgba(80,255,160,0.08) 0%, transparent 70%)",
      }} />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// CYBERPUNK — neon rain falling over the city
// ════════════════════════════════════════════════════════════════════════════════
function CyberpunkLayers() {
  return (
    <>
      {/* Rain layer 1 — falls at angle */}
      <div className="overlay-cyber-rain1" style={{
        position: "absolute",
        top: "-100%",
        left: 0,
        width: "100%",
        height: "300%",
        backgroundImage: "url(/skins/overlays/cyberpunk_rain.png)",
        backgroundSize: "100% 33.33%",
        backgroundRepeat: "repeat-y",
        opacity: 0.45,
        mixBlendMode: "screen",
      }} />
      {/* Rain layer 2 — offset, slightly different speed */}
      <div className="overlay-cyber-rain2" style={{
        position: "absolute",
        top: "-150%",
        left: 0,
        width: "100%",
        height: "300%",
        backgroundImage: "url(/skins/overlays/cyberpunk_rain.png)",
        backgroundSize: "100% 33.33%",
        backgroundRepeat: "repeat-y",
        opacity: 0.25,
        mixBlendMode: "screen",
      }} />
      {/* Neon puddle reflection glow at bottom */}
      <div className="overlay-cyber-puddle" style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        width: "100%",
        height: "20%",
        background: "linear-gradient(to top, rgba(0,180,255,0.12) 0%, rgba(255,60,180,0.08) 50%, transparent 100%)",
      }} />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// LO-FI — rain on glass overlay drifting down, warm lamp glow
// ════════════════════════════════════════════════════════════════════════════════
function LoFiLayers() {
  return (
    <>
      {/* Rain on glass — falls slowly down */}
      <div className="overlay-lofi-rain1" style={{
        position: "absolute",
        top: "-100%",
        left: 0,
        width: "100%",
        height: "300%",
        backgroundImage: "url(/skins/overlays/lofi_rain.png)",
        backgroundSize: "100% 33.33%",
        backgroundRepeat: "repeat-y",
        opacity: 0.30,
        mixBlendMode: "overlay",
      }} />
      {/* Second rain layer — offset */}
      <div className="overlay-lofi-rain2" style={{
        position: "absolute",
        top: "-200%",
        left: 0,
        width: "100%",
        height: "300%",
        backgroundImage: "url(/skins/overlays/lofi_rain.png)",
        backgroundSize: "100% 33.33%",
        backgroundRepeat: "repeat-y",
        opacity: 0.18,
        mixBlendMode: "overlay",
      }} />
      {/* Warm desk lamp glow — breathes */}
      <div className="overlay-lofi-lamp" style={{
        position: "absolute",
        bottom: "20%",
        left: "5%",
        width: "35%",
        height: "50%",
        background: "radial-gradient(ellipse at 30% 80%, rgba(255,180,60,0.12) 0%, transparent 60%)",
      }} />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// SPACE STATION — slow nebula drift, star shimmer
// ════════════════════════════════════════════════════════════════════════════════
function SpaceLayers() {
  return (
    <>
      {/* Aurora/nebula particles drifting across viewport */}
      <div className="overlay-space-nebula1" style={{
        position: "absolute",
        inset: 0,
        backgroundImage: "url(/skins/overlays/aurora_particles.png)",
        backgroundSize: "80% 80%",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        opacity: 0.20,
        mixBlendMode: "screen",
      }} />
      {/* Slow rotation of nebula */}
      <div className="overlay-space-nebula2" style={{
        position: "absolute",
        inset: "-20%",
        backgroundImage: "url(/skins/overlays/aurora_particles.png)",
        backgroundSize: "60% 60%",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        opacity: 0.12,
        mixBlendMode: "screen",
        filter: "hue-rotate(120deg)",
      }} />
      {/* LED strip glow at top */}
      <div className="overlay-space-led" style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "3px",
        background: "linear-gradient(to right, transparent, rgba(100,150,255,0.8), rgba(180,100,255,0.8), transparent)",
      }} />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// LUIGI'S MANSION — Boo ghosts drifting through the scene
// ════════════════════════════════════════════════════════════════════════════════
function LuigiLayers() {
  return (
    <>
      {/* Boo ghost 1 — drifts right to left, upper area */}
      <div className="overlay-luigi-boo1" style={{
        position: "absolute",
        top: "20%",
        left: 0,
        width: "100%",
        height: "30%",
        backgroundImage: "url(/skins/overlays/luigi_ghost.png)",
        backgroundSize: "12% auto",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "110% center",
        opacity: 0.70,
        mixBlendMode: "screen",
      }} />
      {/* Boo ghost 2 — smaller, different height, offset timing */}
      <div className="overlay-luigi-boo2" style={{
        position: "absolute",
        top: "40%",
        left: 0,
        width: "100%",
        height: "25%",
        backgroundImage: "url(/skins/overlays/luigi_ghost.png)",
        backgroundSize: "8% auto",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "110% center",
        opacity: 0.50,
        mixBlendMode: "screen",
        filter: "hue-rotate(30deg)",
      }} />
      {/* Boo ghost 3 — tiny, near bottom */}
      <div className="overlay-luigi-boo3" style={{
        position: "absolute",
        top: "55%",
        left: 0,
        width: "100%",
        height: "20%",
        backgroundImage: "url(/skins/overlays/luigi_ghost.png)",
        backgroundSize: "6% auto",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "110% center",
        opacity: 0.40,
        mixBlendMode: "screen",
      }} />
      {/* Green atmospheric glow */}
      <div className="overlay-luigi-glow" style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        width: "100%",
        height: "35%",
        background: "linear-gradient(to top, rgba(0,60,20,0.20) 0%, transparent 100%)",
        filter: "blur(15px)",
      }} />
      {/* Chandelier flicker */}
      <div className="overlay-luigi-chandelier" style={{
        position: "absolute",
        top: 0,
        left: "40%",
        width: "20%",
        height: "30%",
        background: "radial-gradient(ellipse at 50% 0%, rgba(100,200,255,0.10) 0%, transparent 70%)",
      }} />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// MONSTERS INC — colored light beams sweeping, energy glow
// ════════════════════════════════════════════════════════════════════════════════
function MonstersLayers() {
  return (
    <>
      {/* Colored light beam sweep — left side */}
      <div className="overlay-monsters-beam1" style={{
        position: "absolute",
        top: 0,
        left: "15%",
        width: "8%",
        height: "70%",
        background: "linear-gradient(to bottom, rgba(0,200,255,0.18) 0%, transparent 100%)",
        filter: "blur(12px)",
        transformOrigin: "top center",
      }} />
      <div className="overlay-monsters-beam2" style={{
        position: "absolute",
        top: 0,
        left: "35%",
        width: "6%",
        height: "65%",
        background: "linear-gradient(to bottom, rgba(255,80,180,0.15) 0%, transparent 100%)",
        filter: "blur(10px)",
        transformOrigin: "top center",
      }} />
      <div className="overlay-monsters-beam3" style={{
        position: "absolute",
        top: 0,
        left: "55%",
        width: "7%",
        height: "70%",
        background: "linear-gradient(to bottom, rgba(80,255,120,0.16) 0%, transparent 100%)",
        filter: "blur(11px)",
        transformOrigin: "top center",
      }} />
      <div className="overlay-monsters-beam4" style={{
        position: "absolute",
        top: 0,
        left: "75%",
        width: "6%",
        height: "65%",
        background: "linear-gradient(to bottom, rgba(255,180,0,0.14) 0%, transparent 100%)",
        filter: "blur(10px)",
        transformOrigin: "top center",
      }} />
      {/* Boo's red door glow */}
      <div className="overlay-monsters-door" style={{
        position: "absolute",
        top: "25%",
        left: "42%",
        width: "16%",
        height: "45%",
        background: "radial-gradient(ellipse at center, rgba(255,60,40,0.12) 0%, transparent 70%)",
      }} />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// FINAL FANTASY — aurora/magic particles rising, crystal glow
// ════════════════════════════════════════════════════════════════════════════════
function FFLayers() {
  return (
    <>
      {/* Magic particle sheet rising upward */}
      <div className="overlay-ff-particles1" style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "200%",
        backgroundImage: "url(/skins/overlays/aurora_particles.png)",
        backgroundSize: "100% 50%",
        backgroundRepeat: "repeat-y",
        backgroundPosition: "center top",
        opacity: 0.30,
        mixBlendMode: "screen",
        filter: "hue-rotate(200deg)",
      }} />
      {/* Second particle layer — offset */}
      <div className="overlay-ff-particles2" style={{
        position: "absolute",
        top: "100%",
        left: 0,
        width: "100%",
        height: "200%",
        backgroundImage: "url(/skins/overlays/aurora_particles.png)",
        backgroundSize: "100% 50%",
        backgroundRepeat: "repeat-y",
        backgroundPosition: "center top",
        opacity: 0.20,
        mixBlendMode: "screen",
        filter: "hue-rotate(240deg)",
      }} />
      {/* Crystal glow on left */}
      <div className="overlay-ff-crystal" style={{
        position: "absolute",
        bottom: "10%",
        left: "8%",
        width: "20%",
        height: "60%",
        background: "radial-gradient(ellipse at 50% 100%, rgba(100,150,255,0.12) 0%, transparent 60%)",
        filter: "blur(8px)",
      }} />
      {/* Airship spotlight from upper right */}
      <div className="overlay-ff-airship" style={{
        position: "absolute",
        top: 0,
        right: "20%",
        width: "15%",
        height: "40%",
        background: "radial-gradient(ellipse at 50% 0%, rgba(255,200,100,0.10) 0%, transparent 70%)",
      }} />
    </>
  );
}

// ─── CSS Keyframes ────────────────────────────────────────────────────────────
const KEYFRAMES = `
  /* ── Ken Burns base image animations ── */
  .skin-aurora-img       { animation: kb-zoom 30s ease-in-out infinite alternate; }
  .skin-goth-img         { animation: kb-zoom-slow 40s ease-in-out infinite alternate; }
  .skin-nature-img       { animation: kb-pan-right 35s ease-in-out infinite alternate; }
  .skin-cyberpunk-img    { animation: kb-zoom 25s ease-in-out infinite alternate; }
  .skin-finalfantasy-img { animation: kb-pan-left 38s ease-in-out infinite alternate; }
  .skin-monsters-img     { animation: kb-zoom-slow 28s ease-in-out infinite alternate; }
  .skin-lofi-img         { animation: kb-breathe 50s ease-in-out infinite alternate; }
  .skin-space-img        { animation: kb-zoom-slow 60s ease-in-out infinite alternate; }
  .skin-luigi-img        { animation: kb-pan-right 32s ease-in-out infinite alternate; }

  @keyframes kb-zoom       { from { transform: scale(1.00); } to { transform: scale(1.07) translate(-1.5%, 0.5%); } }
  @keyframes kb-zoom-slow  { from { transform: scale(1.00); } to { transform: scale(1.05) translate(1%, -0.5%); } }
  @keyframes kb-pan-right  { from { transform: scale(1.04) translateX(-1.5%); } to { transform: scale(1.04) translateX(1.5%); } }
  @keyframes kb-pan-left   { from { transform: scale(1.04) translateX(1.5%); } to { transform: scale(1.04) translateX(-1.5%); } }
  @keyframes kb-breathe    { from { transform: scale(1.00); } to { transform: scale(1.03); } }

  /* ── Aurora overlays ── */
  .overlay-aurora-drift1 { animation: drift-right 60s linear infinite; }
  .overlay-aurora-drift2 { animation: drift-right 60s linear infinite; animation-delay: -30s; }
  .overlay-aurora-pulse  { animation: pulse-opacity 8s ease-in-out infinite; }

  /* ── Goth bat overlays ── */
  .overlay-goth-bats1 { animation: bat-drift-right 45s linear infinite; }
  .overlay-goth-bats2 { animation: bat-drift-left 60s linear infinite; animation-delay: -20s; }
  .overlay-goth-mist  { animation: pulse-opacity 6s ease-in-out infinite; }

  /* ── Nature fog overlays ── */
  .overlay-nature-fog1  { animation: fog-drift 80s linear infinite; }
  .overlay-nature-fog2  { animation: fog-drift 55s linear infinite; animation-delay: -27s; }
  .overlay-nature-glow  { animation: pulse-opacity 4s ease-in-out infinite; }

  /* ── Cyberpunk rain overlays ── */
  .overlay-cyber-rain1   { animation: rain-fall 4s linear infinite; }
  .overlay-cyber-rain2   { animation: rain-fall 5.5s linear infinite; animation-delay: -2s; }
  .overlay-cyber-puddle  { animation: pulse-opacity 3s ease-in-out infinite; }

  /* ── Lo-Fi rain overlays ── */
  .overlay-lofi-rain1  { animation: rain-fall-slow 8s linear infinite; }
  .overlay-lofi-rain2  { animation: rain-fall-slow 10s linear infinite; animation-delay: -4s; }
  .overlay-lofi-lamp   { animation: lamp-flicker 5s ease-in-out infinite; }

  /* ── Space overlays ── */
  .overlay-space-nebula1 { animation: nebula-drift 90s linear infinite; }
  .overlay-space-nebula2 { animation: nebula-rotate 120s linear infinite; }
  .overlay-space-led     { animation: led-pulse 3s ease-in-out infinite; }

  /* ── Luigi ghost overlays ── */
  .overlay-luigi-boo1       { animation: ghost-drift-left 30s linear infinite; }
  .overlay-luigi-boo2       { animation: ghost-drift-left 42s linear infinite; animation-delay: -14s; }
  .overlay-luigi-boo3       { animation: ghost-drift-left 55s linear infinite; animation-delay: -28s; }
  .overlay-luigi-glow       { animation: pulse-opacity 5s ease-in-out infinite; }
  .overlay-luigi-chandelier { animation: chandelier-flicker 2.5s ease-in-out infinite; }

  /* ── Monsters Inc overlays ── */
  .overlay-monsters-beam1 { animation: beam-pulse 2.1s ease-in-out infinite; }
  .overlay-monsters-beam2 { animation: beam-pulse 1.8s ease-in-out infinite; animation-delay: -0.5s; }
  .overlay-monsters-beam3 { animation: beam-pulse 2.4s ease-in-out infinite; animation-delay: -1.1s; }
  .overlay-monsters-beam4 { animation: beam-pulse 1.6s ease-in-out infinite; animation-delay: -0.3s; }
  .overlay-monsters-door  { animation: pulse-opacity 2.5s ease-in-out infinite; }

  /* ── Final Fantasy overlays ── */
  .overlay-ff-particles1 { animation: particles-rise 20s linear infinite; }
  .overlay-ff-particles2 { animation: particles-rise 20s linear infinite; animation-delay: -10s; }
  .overlay-ff-crystal    { animation: pulse-opacity 4s ease-in-out infinite; }
  .overlay-ff-airship    { animation: pulse-opacity 5s ease-in-out infinite; animation-delay: -2s; }

  /* ── Shared keyframes ── */
  @keyframes drift-right {
    from { transform: translateX(-100%); }
    to   { transform: translateX(0%); }
  }
  @keyframes bat-drift-right {
    from { background-position: -70% center; }
    to   { background-position: 110% center; }
  }
  @keyframes bat-drift-left {
    from { background-position: 110% center; transform: scaleX(-1); }
    to   { background-position: -70% center; transform: scaleX(-1); }
  }
  @keyframes fog-drift {
    from { transform: translateX(0%); }
    to   { transform: translateX(-50%); }
  }
  @keyframes rain-fall {
    from { transform: translateY(0%); }
    to   { transform: translateY(33.33%); }
  }
  @keyframes rain-fall-slow {
    from { transform: translateY(0%); }
    to   { transform: translateY(33.33%); }
  }
  @keyframes ghost-drift-left {
    0%   { background-position: 110% center; opacity: 0; }
    5%   { opacity: 1; }
    90%  { opacity: 0.8; }
    100% { background-position: -15% center; opacity: 0; }
  }
  @keyframes nebula-drift {
    from { transform: translateX(-5%) scale(1.0); }
    to   { transform: translateX(5%) scale(1.05); }
  }
  @keyframes nebula-rotate {
    from { transform: rotate(0deg) scale(1.0); }
    to   { transform: rotate(360deg) scale(1.0); }
  }
  @keyframes particles-rise {
    from { transform: translateY(0%); }
    to   { transform: translateY(-50%); }
  }
  @keyframes pulse-opacity {
    0%, 100% { opacity: 0.6; }
    50%       { opacity: 1.0; }
  }
  @keyframes beam-pulse {
    0%, 100% { opacity: 0.4; }
    50%       { opacity: 1.0; }
  }
  @keyframes lamp-flicker {
    0%, 100% { opacity: 0.8; }
    20%       { opacity: 1.0; }
    30%       { opacity: 0.7; }
    50%       { opacity: 1.0; }
    70%       { opacity: 0.9; }
  }
  @keyframes chandelier-flicker {
    0%, 100% { opacity: 0.6; }
    15%       { opacity: 1.0; }
    20%       { opacity: 0.3; }
    25%       { opacity: 1.0; }
    80%       { opacity: 0.8; }
  }
  @keyframes led-pulse {
    0%, 100% { opacity: 0.5; }
    50%       { opacity: 1.0; }
  }

  @media (prefers-reduced-motion: reduce) {
    [class*="overlay-"], [class*="skin-"][class*="-img"] {
      animation: none !important;
    }
  }
`;
