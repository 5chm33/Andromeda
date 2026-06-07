/**
 * ThemeCanvas — full-viewport animated background
 * Andromeda v7.6.0
 *
 * Key improvements:
 * - Preloads ALL skin images on mount → instant switching, no delay
 * - Rich per-skin dynamic overlays: animated rain drops, flying bats, roaming deer,
 *   glowing mushrooms, drifting ghosts, aurora ribbons, neon rain, floating objects
 * - 600ms cross-fade between skins
 * - prefers-reduced-motion support
 */
import { useEffect, useRef, useState } from "react";
import type { SkinId } from "@/lib/themeEngine";
import { SKINS } from "@/lib/themeEngine";

interface ThemeCanvasProps {
  skin: SkinId;
}

// ─── Image preloader — runs once on app load ──────────────────────────────────
function preloadAllSkins() {
  SKINS.forEach((s) => {
    const img = new Image();
    img.src = s.bgImage;
  });
}

let preloaded = false;

export function ThemeCanvas({ skin }: ThemeCanvasProps) {
  const [activeSkin, setActiveSkin] = useState(skin);
  const [nextSkin, setNextSkin] = useState<SkinId | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Preload all images once
  useEffect(() => {
    if (!preloaded) {
      preloaded = true;
      preloadAllSkins();
    }
  }, []);

  // Cross-fade: show next skin on top, fade it in, then swap
  useEffect(() => {
    if (skin === activeSkin) return;
    setNextSkin(skin);
    setTransitioning(false);
    // Small delay to ensure next layer renders before fading in
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

      {/* Base layer — current active skin */}
      <BgLayer meta={activeMeta} opacity={1} />

      {/* Transition layer — next skin fades in on top */}
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
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        overflow: "hidden",
        opacity,
        ...style,
      }}
    >
      {/* Background image with Ken Burns */}
      <div
        className={`theme-bg-img ${meta.animClass}-img`}
        style={{
          position: "absolute",
          inset: "-6%",
          backgroundImage: `url(${meta.bgImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />

      {/* Readability overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: meta.overlayColor,
          zIndex: 1,
          pointerEvents: "none",
        }}
      />

      {/* Per-skin dynamic overlay */}
      <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
        {meta.id === "aurora"       && <AuroraOverlay />}
        {meta.id === "goth"         && <GothOverlay />}
        {meta.id === "nature"       && <NatureOverlay />}
        {meta.id === "cyberpunk"    && <CyberpunkOverlay />}
        {meta.id === "lofi"         && <LoFiOverlay />}
        {meta.id === "spacestation" && <SpaceOverlay />}
        {meta.id === "luigismansion"&& <LuigiOverlay />}
        {meta.id === "monsters"     && <MonstersOverlay />}
        {meta.id === "finalfantasy" && <FFOverlay />}
      </div>

      {/* Vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.70) 100%)",
          zIndex: 3,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// AURORA — rippling light curtains + shooting stars
// ════════════════════════════════════════════════════════════════════════════════
function AuroraOverlay() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0 }}>
      {/* Aurora ribbon 1 */}
      <path d="M-100,200 Q400,80 900,180 Q1400,280 2020,150" stroke="rgba(60,255,160,0.18)" strokeWidth="80" fill="none" filter="url(#blur20)">
        <animate attributeName="d" dur="8s" repeatCount="indefinite"
          values="M-100,200 Q400,80 900,180 Q1400,280 2020,150;
                  M-100,180 Q400,120 900,140 Q1400,220 2020,190;
                  M-100,200 Q400,80 900,180 Q1400,280 2020,150" />
        <animate attributeName="stroke-opacity" dur="6s" repeatCount="indefinite" values="0.18;0.32;0.18" />
      </path>
      {/* Aurora ribbon 2 */}
      <path d="M-100,280 Q500,160 1000,260 Q1500,360 2020,220" stroke="rgba(120,60,255,0.14)" strokeWidth="60" fill="none" filter="url(#blur20)">
        <animate attributeName="d" dur="11s" repeatCount="indefinite"
          values="M-100,280 Q500,160 1000,260 Q1500,360 2020,220;
                  M-100,300 Q500,200 1000,220 Q1500,300 2020,260;
                  M-100,280 Q500,160 1000,260 Q1500,360 2020,220" />
        <animate attributeName="stroke-opacity" dur="9s" repeatCount="indefinite" values="0.14;0.28;0.14" />
      </path>
      {/* Aurora ribbon 3 */}
      <path d="M-100,350 Q600,230 1100,320 Q1600,410 2020,280" stroke="rgba(40,200,255,0.12)" strokeWidth="50" fill="none" filter="url(#blur20)">
        <animate attributeName="d" dur="14s" repeatCount="indefinite"
          values="M-100,350 Q600,230 1100,320 Q1600,410 2020,280;
                  M-100,370 Q600,270 1100,280 Q1600,350 2020,320;
                  M-100,350 Q600,230 1100,320 Q1600,410 2020,280" />
      </path>
      {/* Shooting star 1 */}
      <line x1="-20" y1="80" x2="60" y2="110" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0">
        <animate attributeName="x1" dur="4s" repeatCount="indefinite" values="-20;900" begin="1s" />
        <animate attributeName="x2" dur="4s" repeatCount="indefinite" values="60;980" begin="1s" />
        <animate attributeName="y1" dur="4s" repeatCount="indefinite" values="80;280" begin="1s" />
        <animate attributeName="y2" dur="4s" repeatCount="indefinite" values="110;310" begin="1s" />
        <animate attributeName="opacity" dur="4s" repeatCount="indefinite" values="0;0;0.9;0.9;0" keyTimes="0;0.1;0.2;0.85;1" begin="1s" />
      </line>
      {/* Shooting star 2 */}
      <line x1="-20" y1="50" x2="60" y2="80" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0">
        <animate attributeName="x1" dur="3s" repeatCount="indefinite" values="-20;1200" begin="7s" />
        <animate attributeName="x2" dur="3s" repeatCount="indefinite" values="60;1280" begin="7s" />
        <animate attributeName="y1" dur="3s" repeatCount="indefinite" values="50;350" begin="7s" />
        <animate attributeName="y2" dur="3s" repeatCount="indefinite" values="80;380" begin="7s" />
        <animate attributeName="opacity" dur="3s" repeatCount="indefinite" values="0;0;1;1;0" keyTimes="0;0.05;0.15;0.8;1" begin="7s" />
      </line>
      <defs>
        <filter id="blur20"><feGaussianBlur stdDeviation="20" /></filter>
      </defs>
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// GOTH — bats flying across the scene in arcing paths
// ════════════════════════════════════════════════════════════════════════════════
function GothOverlay() {
  // Each bat: start x, start y, end x, end y, control point, duration, delay
  const bats = [
    { sx: -60, sy: 200, ex: 2000, ey: 150, cx: 900, cy: 80,  dur: 14, delay: 0,  size: 22 },
    { sx: 2000, sy: 120, ex: -60, ey: 250, cx: 900, cy: 40,  dur: 18, delay: 3,  size: 16 },
    { sx: -60, sy: 300, ex: 2000, ey: 180, cx: 800, cy: 120, dur: 12, delay: 6,  size: 20 },
    { sx: 2000, sy: 80,  ex: -60, ey: 320, cx: 1000,cy: 30,  dur: 16, delay: 9,  size: 14 },
    { sx: -60, sy: 160, ex: 2000, ey: 100, cx: 700, cy: 60,  dur: 20, delay: 2,  size: 18 },
    { sx: 2000, sy: 200, ex: -60, ey: 140, cx: 600, cy: 80,  dur: 15, delay: 11, size: 12 },
  ];

  return (
    <svg width="100%" height="100%" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0 }}>
      {/* Purple mist at bottom */}
      <rect x="0" y="800" width="1920" height="280" fill="url(#gothMist)" opacity="0.5">
        <animate attributeName="opacity" dur="5s" repeatCount="indefinite" values="0.4;0.7;0.4" />
      </rect>

      {bats.map((bat, i) => {
        const pathId = `batPath${i}`;
        const goRight = bat.sx < 0;
        return (
          <g key={i}>
            <path id={pathId} d={`M${bat.sx},${bat.sy} Q${bat.cx},${bat.cy} ${bat.ex},${bat.ey}`} fill="none" />
            <text fontSize={bat.size} fill="rgba(30,0,40,0.9)" style={{ filter: "drop-shadow(0 0 3px rgba(180,80,255,0.6))" }}>
              🦇
              <animateMotion dur={`${bat.dur}s`} repeatCount="indefinite" begin={`${bat.delay}s`}>
                <mpath href={`#${pathId}`} />
              </animateMotion>
            </text>
          </g>
        );
      })}

      {/* Moon glow pulse */}
      <circle cx="960" cy="120" r="80" fill="rgba(255,255,240,0.04)">
        <animate attributeName="r" dur="4s" repeatCount="indefinite" values="80;95;80" />
        <animate attributeName="opacity" dur="4s" repeatCount="indefinite" values="0.04;0.08;0.04" />
      </circle>

      <defs>
        <linearGradient id="gothMist" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(60,0,80,0)" />
          <stop offset="100%" stopColor="rgba(60,0,80,0.6)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// NATURE — deer walking, glowing mushrooms pulsing, fireflies, light shafts
// ════════════════════════════════════════════════════════════════════════════════
function NatureOverlay() {
  // Firefly positions
  const fireflies = Array.from({ length: 18 }, (_, i) => ({
    x: 80 + (i * 103) % 1700,
    y: 400 + (i * 77) % 500,
    dur: 2.5 + (i % 5) * 0.7,
    delay: i * 0.4,
    r: 2 + (i % 3),
  }));

  return (
    <svg width="100%" height="100%" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0 }}>
      {/* Light shafts from upper left */}
      {[0,1,2,3].map(i => (
        <polygon key={i}
          points={`${-100 + i*80},0 ${-60 + i*80},0 ${600 + i*120},1080 ${540 + i*120},1080`}
          fill={`rgba(255,220,100,${0.03 + i*0.01})`}
          style={{ filter: "blur(8px)" }}>
          <animate attributeName="opacity" dur={`${5 + i*2}s`} repeatCount="indefinite"
            values={`${0.03 + i*0.01};${0.07 + i*0.02};${0.03 + i*0.01}`} />
        </polygon>
      ))}

      {/* Mushroom glow clusters */}
      {[
        { x: 1650, y: 820, color: "rgba(80,255,180,0.5)" },
        { x: 1700, y: 860, color: "rgba(100,200,255,0.4)" },
        { x: 1720, y: 800, color: "rgba(80,255,180,0.3)" },
        { x: 1580, y: 850, color: "rgba(140,255,200,0.4)" },
        { x: 1760, y: 840, color: "rgba(60,255,160,0.5)" },
      ].map((m, i) => (
        <circle key={i} cx={m.x} cy={m.y} r={18 + i*4} fill={m.color} style={{ filter: "blur(6px)" }}>
          <animate attributeName="r" dur={`${2 + i*0.5}s`} repeatCount="indefinite"
            values={`${18 + i*4};${26 + i*4};${18 + i*4}`} />
          <animate attributeName="opacity" dur={`${2 + i*0.5}s`} repeatCount="indefinite"
            values="0.5;1;0.5" />
        </circle>
      ))}

      {/* Fireflies */}
      {fireflies.map((f, i) => (
        <g key={i}>
          <circle cx={f.x} cy={f.y} r={f.r} fill="rgba(200,255,100,0.9)" style={{ filter: "blur(1px)" }}>
            <animate attributeName="opacity" dur={`${f.dur}s`} repeatCount="indefinite"
              values="0;0.9;0;0.7;0" begin={`${f.delay}s`} />
            <animateTransform attributeName="transform" type="translate" dur={`${f.dur * 3}s`}
              repeatCount="indefinite" begin={`${f.delay}s`}
              values={`0,0; ${-20 + (i%5)*10},${-15 + (i%4)*8}; 0,0`} />
          </circle>
        </g>
      ))}

      {/* Deer silhouette walking across */}
      <g style={{ filter: "drop-shadow(0 0 8px rgba(255,200,100,0.3))" }}>
        {/* Simple deer shape using SVG path — stylized silhouette */}
        <g opacity="0.55">
          {/* Body */}
          <ellipse cx="0" cy="0" rx="40" ry="22" fill="rgba(80,50,20,0.8)" />
          {/* Head */}
          <ellipse cx="38" cy="-18" rx="14" ry="11" fill="rgba(80,50,20,0.8)" />
          {/* Neck */}
          <rect x="24" y="-22" width="16" height="18" rx="4" fill="rgba(80,50,20,0.8)" />
          {/* Antlers */}
          <path d="M42,-28 L38,-50 M38,-50 L30,-42 M38,-50 L46,-42" stroke="rgba(80,50,20,0.8)" strokeWidth="3" fill="none" strokeLinecap="round" />
          {/* Legs */}
          <rect x="-20" y="18" width="8" height="28" rx="3" fill="rgba(70,40,15,0.8)" />
          <rect x="-5" y="18" width="8" height="28" rx="3" fill="rgba(70,40,15,0.8)" />
          <rect x="12" y="18" width="8" height="28" rx="3" fill="rgba(70,40,15,0.8)" />
          <rect x="27" y="18" width="8" height="28" rx="3" fill="rgba(70,40,15,0.8)" />
          {/* Tail */}
          <ellipse cx="-40" cy="-5" rx="8" ry="6" fill="rgba(220,200,180,0.7)" />
          <animateTransform attributeName="transform" type="translate"
            dur="35s" repeatCount="indefinite"
            values="-120,950; 2100,950" />
        </g>
        {/* Fawn — smaller, follows behind */}
        <g opacity="0.45">
          <ellipse cx="0" cy="0" rx="25" ry="15" fill="rgba(100,65,25,0.8)" />
          <ellipse cx="24" cy="-12" rx="9" ry="7" fill="rgba(100,65,25,0.8)" />
          <rect x="15" y="-14" width="11" height="12" rx="3" fill="rgba(100,65,25,0.8)" />
          <rect x="-12" y="12" width="6" height="18" rx="2" fill="rgba(90,55,20,0.8)" />
          <rect x="-2" y="12" width="6" height="18" rx="2" fill="rgba(90,55,20,0.8)" />
          <rect x="9" y="12" width="6" height="18" rx="2" fill="rgba(90,55,20,0.8)" />
          <rect x="19" y="12" width="6" height="18" rx="2" fill="rgba(90,55,20,0.8)" />
          <animateTransform attributeName="transform" type="translate"
            dur="35s" repeatCount="indefinite"
            values="-280,970; 1940,970" />
        </g>
      </g>

      {/* Bioluminescent ground mist */}
      <rect x="0" y="900" width="1920" height="180" fill="rgba(40,120,60,0.06)" style={{ filter: "blur(20px)" }}>
        <animate attributeName="opacity" dur="6s" repeatCount="indefinite" values="0.06;0.12;0.06" />
      </rect>
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// CYBERPUNK — neon rain + flying car light trails + sign flicker
// ════════════════════════════════════════════════════════════════════════════════
function CyberpunkOverlay() {
  const rainDrops = Array.from({ length: 80 }, (_, i) => ({
    x: (i * 24.1) % 1920,
    dur: 0.4 + (i % 6) * 0.12,
    delay: (i * 0.09) % 1.8,
    h: 25 + (i % 5) * 12,
    color: i % 3 === 0 ? "rgba(0,200,255,0.35)" : i % 3 === 1 ? "rgba(255,60,180,0.25)" : "rgba(180,180,255,0.20)",
  }));

  const cars = [
    { y: 420, dur: 8,  delay: 0,  color: "rgba(0,200,255,0.8)",  dir: 1 },
    { y: 460, dur: 12, delay: 4,  color: "rgba(255,80,180,0.7)", dir: -1 },
    { y: 390, dur: 10, delay: 7,  color: "rgba(255,200,0,0.6)",  dir: 1 },
    { y: 480, dur: 9,  delay: 2,  color: "rgba(0,255,180,0.6)",  dir: -1 },
  ];

  return (
    <svg width="100%" height="100%" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0 }}>
      {/* Rain drops */}
      {rainDrops.map((r, i) => (
        <line key={i} x1={r.x} y1="-20" x2={r.x - 4} y2={r.h - 20}
          stroke={r.color} strokeWidth="1.2" strokeLinecap="round">
          <animateTransform attributeName="transform" type="translate"
            dur={`${r.dur}s`} repeatCount="indefinite" begin={`${r.delay}s`}
            values={`0,0; -8,${1100 + r.h}`} />
        </line>
      ))}

      {/* Flying car light trails */}
      {cars.map((car, i) => (
        <g key={i}>
          <line
            x1={car.dir > 0 ? -200 : 2120}
            y1={car.y}
            x2={car.dir > 0 ? -120 : 2040}
            y2={car.y}
            stroke={car.color} strokeWidth="3" strokeLinecap="round">
            <animateTransform attributeName="transform" type="translate"
              dur={`${car.dur}s`} repeatCount="indefinite" begin={`${car.delay}s`}
              values={car.dir > 0 ? "0,0; 2320,0" : "0,0; -2320,0"} />
          </line>
          {/* Headlight glow */}
          <circle cx={car.dir > 0 ? -120 : 2040} cy={car.y} r="6" fill={car.color} style={{ filter: "blur(3px)" }}>
            <animateTransform attributeName="transform" type="translate"
              dur={`${car.dur}s`} repeatCount="indefinite" begin={`${car.delay}s`}
              values={car.dir > 0 ? "0,0; 2320,0" : "0,0; -2320,0"} />
          </circle>
        </g>
      ))}

      {/* Scanlines */}
      <rect x="0" y="0" width="1920" height="1080"
        fill="url(#scanlines)" opacity="0.04" />

      {/* Neon puddle reflections at bottom */}
      <rect x="0" y="900" width="1920" height="180" fill="url(#puddleGrad)" opacity="0.3">
        <animate attributeName="opacity" dur="3s" repeatCount="indefinite" values="0.2;0.4;0.2" />
      </rect>

      <defs>
        <pattern id="scanlines" x="0" y="0" width="1" height="4" patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width="1920" height="1" fill="black" />
        </pattern>
        <linearGradient id="puddleGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255,60,180,0.3)" />
          <stop offset="30%" stopColor="rgba(0,200,255,0.3)" />
          <stop offset="60%" stopColor="rgba(255,200,0,0.2)" />
          <stop offset="100%" stopColor="rgba(180,60,255,0.3)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// LO-FI — rain on glass (window droplets), lamp flicker, cat tail wag
// ════════════════════════════════════════════════════════════════════════════════
function LoFiOverlay() {
  // Window rain drops — slow, streaky, on glass
  const drops = Array.from({ length: 35 }, (_, i) => ({
    x: 600 + (i * 37.3) % 800,  // concentrated in window area
    dur: 2.5 + (i % 6) * 0.6,
    delay: (i * 0.18) % 4,
    h: 40 + (i % 5) * 25,
    wobble: (i % 3 - 1) * 3,
  }));

  return (
    <svg width="100%" height="100%" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0 }}>
      {/* Window rain streaks */}
      {drops.map((d, i) => (
        <g key={i}>
          <line x1={d.x} y1="50" x2={d.x + d.wobble} y2={50 + d.h}
            stroke="rgba(180,210,255,0.25)" strokeWidth="1.5" strokeLinecap="round">
            <animateTransform attributeName="transform" type="translate"
              dur={`${d.dur}s`} repeatCount="indefinite" begin={`${d.delay}s`}
              values={`0,0; ${d.wobble * 2},${900}`} />
            <animate attributeName="opacity" dur={`${d.dur}s`} repeatCount="indefinite"
              begin={`${d.delay}s`} values="0;0.25;0.25;0" keyTimes="0;0.1;0.8;1" />
          </line>
          {/* Drop bead at bottom */}
          <circle cx={d.x + d.wobble * 2} cy={50 + d.h} r="2.5" fill="rgba(180,210,255,0.3)">
            <animateTransform attributeName="transform" type="translate"
              dur={`${d.dur}s`} repeatCount="indefinite" begin={`${d.delay}s`}
              values={`0,0; ${d.wobble * 2},${900}`} />
            <animate attributeName="opacity" dur={`${d.dur}s`} repeatCount="indefinite"
              begin={`${d.delay}s`} values="0;0;0.5;0" keyTimes="0;0.7;0.85;1" />
          </circle>
        </g>
      ))}

      {/* Warm desk lamp glow — flickers gently */}
      <radialGradient id="lampGlow" cx="20%" cy="55%" r="25%">
        <stop offset="0%" stopColor="rgba(255,190,80,0.18)" />
        <stop offset="100%" stopColor="rgba(255,190,80,0)" />
      </radialGradient>
      <rect x="0" y="0" width="1920" height="1080" fill="url(#lampGlow)">
        <animate attributeName="opacity" dur="4s" repeatCount="indefinite"
          values="0.8;1;0.85;1;0.9;1;0.8" keyTimes="0;0.2;0.3;0.5;0.7;0.85;1" />
      </rect>

      {/* Vinyl record spinning on shelf (top left area) */}
      <g transform="translate(120, 200)">
        <circle cx="0" cy="0" r="28" fill="rgba(20,10,5,0.7)" stroke="rgba(80,60,40,0.5)" strokeWidth="1" />
        <circle cx="0" cy="0" r="6" fill="rgba(60,40,20,0.8)" />
        <circle cx="0" cy="0" r="2" fill="rgba(180,140,80,0.6)" />
        <animateTransform attributeName="transform" type="rotate"
          dur="3s" repeatCount="indefinite" additive="sum" />
      </g>

      {/* City lights shimmer outside window */}
      <rect x="580" y="0" width="900" height="1080" fill="url(#cityShimmer)" opacity="0.06">
        <animate attributeName="opacity" dur="2s" repeatCount="indefinite" values="0.04;0.09;0.04" />
      </rect>

      <defs>
        <radialGradient id="cityShimmer" cx="50%" cy="60%" r="50%">
          <stop offset="0%" stopColor="rgba(255,180,80,0.3)" />
          <stop offset="50%" stopColor="rgba(80,180,255,0.2)" />
          <stop offset="100%" stopColor="rgba(255,80,120,0.1)" />
        </radialGradient>
      </defs>
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// SPACE STATION — floating objects, star twinkle, nebula pulse
// ════════════════════════════════════════════════════════════════════════════════
function SpaceOverlay() {
  const stars = Array.from({ length: 60 }, (_, i) => ({
    x: (i * 32.7) % 1920,
    y: (i * 19.3) % 600,
    r: 1 + (i % 3) * 0.5,
    dur: 1.5 + (i % 5) * 0.6,
    delay: i * 0.2,
  }));

  return (
    <svg width="100%" height="100%" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0 }}>
      {/* Twinkling stars */}
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="white">
          <animate attributeName="opacity" dur={`${s.dur}s`} repeatCount="indefinite"
            begin={`${s.delay}s`} values="0.2;1;0.2" />
          <animate attributeName="r" dur={`${s.dur}s`} repeatCount="indefinite"
            begin={`${s.delay}s`} values={`${s.r};${s.r * 1.8};${s.r}`} />
        </circle>
      ))}

      {/* Floating coffee mug */}
      <g opacity="0.7">
        <rect x="0" y="0" width="32" height="26" rx="4" fill="rgba(60,60,80,0.8)" stroke="rgba(100,150,255,0.3)" strokeWidth="1" />
        <path d="M32,8 Q44,8 44,17 Q44,26 32,26" stroke="rgba(100,150,255,0.4)" strokeWidth="2" fill="none" />
        <rect x="4" y="4" width="24" height="10" rx="2" fill="rgba(180,120,60,0.6)" />
        <animateTransform attributeName="transform" type="translate"
          dur="12s" repeatCount="indefinite"
          values="1200,320; 1210,308; 1198,318; 1205,328; 1200,320" />
        <animateTransform attributeName="transform" type="rotate"
          dur="18s" repeatCount="indefinite" additive="sum"
          values="0; 8; -5; 3; 0" />
      </g>

      {/* Floating tablet */}
      <g opacity="0.6">
        <rect x="0" y="0" width="50" height="36" rx="5" fill="rgba(20,20,40,0.85)" stroke="rgba(100,150,255,0.3)" strokeWidth="1.5" />
        <rect x="4" y="4" width="42" height="28" rx="3" fill="rgba(0,100,200,0.25)" />
        <animateTransform attributeName="transform" type="translate"
          dur="15s" repeatCount="indefinite"
          values="1350,280; 1340,292; 1355,285; 1345,275; 1350,280" />
        <animateTransform attributeName="transform" type="rotate"
          dur="22s" repeatCount="indefinite" additive="sum"
          values="0; -12; 6; -4; 0" />
      </g>

      {/* LED strip glow top */}
      <rect x="0" y="0" width="1920" height="4" fill="url(#ledGrad)">
        <animate attributeName="opacity" dur="3s" repeatCount="indefinite" values="0.5;1;0.5" />
      </rect>

      {/* Nebula pulse */}
      <radialGradient id="nebulaPulse" cx="50%" cy="40%" r="40%">
        <stop offset="0%" stopColor="rgba(180,80,255,0.06)" />
        <stop offset="50%" stopColor="rgba(80,120,255,0.04)" />
        <stop offset="100%" stopColor="rgba(0,0,0,0)" />
      </radialGradient>
      <rect x="0" y="0" width="1920" height="1080" fill="url(#nebulaPulse)">
        <animate attributeName="opacity" dur="7s" repeatCount="indefinite" values="0.6;1;0.6" />
      </rect>

      <defs>
        <linearGradient id="ledGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(0,150,255,0)" />
          <stop offset="30%" stopColor="rgba(0,180,255,0.8)" />
          <stop offset="60%" stopColor="rgba(100,80,255,0.8)" />
          <stop offset="100%" stopColor="rgba(100,80,255,0)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// LUIGI'S MANSION — ghosts drifting, chandelier flicker, portrait eyes
// ════════════════════════════════════════════════════════════════════════════════
function LuigiOverlay() {
  const ghosts = [
    { startX: -100, startY: 350, endX: 2100, endY: 280, dur: 22, delay: 0,  color: "rgba(80,255,120,0.55)",  size: 55 },
    { startX: 2100, startY: 250, endX: -100, endY: 320, dur: 28, delay: 8,  color: "rgba(160,80,255,0.50)",  size: 45 },
    { startX: -100, startY: 200, endX: 2100, endY: 400, dur: 18, delay: 14, color: "rgba(80,200,255,0.45)",  size: 38 },
    { startX: 2100, startY: 400, endX: -100, endY: 200, dur: 25, delay: 5,  color: "rgba(80,255,120,0.40)",  size: 30 },
  ];

  return (
    <svg width="100%" height="100%" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0 }}>
      {/* Chandelier flicker glow */}
      <radialGradient id="chandelierGlow" cx="50%" cy="15%" r="20%">
        <stop offset="0%" stopColor="rgba(100,200,255,0.15)" />
        <stop offset="100%" stopColor="rgba(100,200,255,0)" />
      </radialGradient>
      <rect x="0" y="0" width="1920" height="1080" fill="url(#chandelierGlow)">
        <animate attributeName="opacity" dur="2s" repeatCount="indefinite"
          values="0.6;1;0.3;1;0.8;1;0.6" keyTimes="0;0.15;0.2;0.3;0.7;0.9;1" />
      </rect>

      {/* Drifting ghosts — SVG ghost shapes */}
      {ghosts.map((g, i) => (
        <g key={i}>
          {/* Ghost body */}
          <g opacity="0">
            <ellipse cx="0" cy="-10" rx={g.size * 0.5} ry={g.size * 0.55} fill={g.color} style={{ filter: "blur(2px)" }} />
            {/* Ghost bottom wavy */}
            <path
              d={`M${-g.size*0.5},${g.size*0.1} Q${-g.size*0.35},${g.size*0.3} ${-g.size*0.2},${g.size*0.1} Q${-g.size*0.05},${g.size*0.3} ${g.size*0.1},${g.size*0.1} Q${g.size*0.25},${g.size*0.3} ${g.size*0.4},${g.size*0.1} L${g.size*0.5},${g.size*0.1} L${g.size*0.5},-${g.size*0.3} Q0,-${g.size*0.6} -${g.size*0.5},-${g.size*0.3} Z`}
              fill={g.color} style={{ filter: "blur(2px)" }}
            />
            {/* Eyes */}
            <circle cx={-g.size*0.15} cy={-g.size*0.1} r={g.size*0.08} fill="rgba(0,0,0,0.6)" />
            <circle cx={g.size*0.15} cy={-g.size*0.1} r={g.size*0.08} fill="rgba(0,0,0,0.6)" />
            <animateTransform attributeName="transform" type="translate"
              dur={`${g.dur}s`} repeatCount="indefinite" begin={`${g.delay}s`}
              values={`${g.startX},${g.startY}; ${g.endX},${g.endY}`} />
            <animate attributeName="opacity" dur={`${g.dur}s`} repeatCount="indefinite"
              begin={`${g.delay}s`}
              values="0;0;0.9;0.9;0" keyTimes="0;0.05;0.15;0.85;1" />
            {/* Bob up/down */}
            <animateTransform attributeName="transform" type="translate"
              dur="3s" repeatCount="indefinite" additive="sum"
              values="0,0; 0,-12; 0,0" />
          </g>
        </g>
      ))}

      {/* Portrait eyes glowing in frames */}
      {[
        { x: 280, y: 380 }, { x: 1640, y: 320 }, { x: 180, y: 520 }, { x: 1740, y: 460 },
      ].map((pos, i) => (
        <g key={i}>
          <ellipse cx={pos.x - 8} cy={pos.y} rx="5" ry="3" fill="rgba(255,80,80,0.7)">
            <animate attributeName="opacity" dur={`${3 + i}s`} repeatCount="indefinite"
              begin={`${i * 1.5}s`} values="0;0;0.7;0.7;0" keyTimes="0;0.3;0.4;0.7;1" />
          </ellipse>
          <ellipse cx={pos.x + 8} cy={pos.y} rx="5" ry="3" fill="rgba(255,80,80,0.7)">
            <animate attributeName="opacity" dur={`${3 + i}s`} repeatCount="indefinite"
              begin={`${i * 1.5}s`} values="0;0;0.7;0.7;0" keyTimes="0;0.3;0.4;0.7;1" />
          </ellipse>
        </g>
      ))}

      {/* Green atmospheric glow */}
      <rect x="0" y="700" width="1920" height="380" fill="rgba(0,60,20,0.08)" style={{ filter: "blur(30px)" }}>
        <animate attributeName="opacity" dur="5s" repeatCount="indefinite" values="0.08;0.15;0.08" />
      </rect>
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// MONSTERS INC — colored door lights sweeping, energy arcs
// ════════════════════════════════════════════════════════════════════════════════
function MonstersOverlay() {
  const doorLights = [
    { x: 200,  color: "rgba(0,200,255,0.15)",  dur: 2.1, delay: 0 },
    { x: 450,  color: "rgba(255,80,180,0.12)", dur: 1.8, delay: 0.5 },
    { x: 700,  color: "rgba(80,255,120,0.13)", dur: 2.4, delay: 1.1 },
    { x: 950,  color: "rgba(255,180,0,0.14)",  dur: 1.6, delay: 0.3 },
    { x: 1200, color: "rgba(180,80,255,0.12)", dur: 2.2, delay: 0.8 },
    { x: 1450, color: "rgba(0,255,200,0.13)",  dur: 1.9, delay: 1.5 },
    { x: 1700, color: "rgba(255,60,60,0.12)",  dur: 2.0, delay: 0.6 },
  ];

  return (
    <svg width="100%" height="100%" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0 }}>
      {/* Ceiling light beams */}
      {doorLights.map((l, i) => (
        <g key={i}>
          <polygon
            points={`${l.x - 40},0 ${l.x + 40},0 ${l.x + 120},600 ${l.x - 120},600`}
            fill={l.color} style={{ filter: "blur(15px)" }}>
            <animate attributeName="opacity" dur={`${l.dur}s`} repeatCount="indefinite"
              begin={`${l.delay}s`} values="0.4;1;0.4" />
          </polygon>
        </g>
      ))}

      {/* Door portal glow in center */}
      <radialGradient id="doorPortal" cx="50%" cy="35%" r="15%">
        <stop offset="0%" stopColor="rgba(100,200,255,0.20)" />
        <stop offset="100%" stopColor="rgba(100,200,255,0)" />
      </radialGradient>
      <rect x="0" y="0" width="1920" height="1080" fill="url(#doorPortal)">
        <animate attributeName="opacity" dur="3s" repeatCount="indefinite" values="0.6;1;0.6" />
      </rect>

      {/* Energy arc at top */}
      <path d="M800,0 Q960,-40 1120,0" stroke="rgba(0,200,255,0.3)" strokeWidth="2" fill="none">
        <animate attributeName="stroke-opacity" dur="1.5s" repeatCount="indefinite" values="0.1;0.5;0.1" />
        <animate attributeName="d" dur="4s" repeatCount="indefinite"
          values="M800,0 Q960,-40 1120,0; M780,0 Q960,-60 1140,0; M800,0 Q960,-40 1120,0" />
      </path>

      {/* Boo's red door glow */}
      <radialGradient id="booGlow" cx="50%" cy="42%" r="8%">
        <stop offset="0%" stopColor="rgba(255,80,60,0.18)" />
        <stop offset="100%" stopColor="rgba(255,80,60,0)" />
      </radialGradient>
      <rect x="0" y="0" width="1920" height="1080" fill="url(#booGlow)">
        <animate attributeName="opacity" dur="2.5s" repeatCount="indefinite" values="0.5;1;0.5" />
      </rect>
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// FINAL FANTASY — magic particles, crystal glow, summon circle
// ════════════════════════════════════════════════════════════════════════════════
function FFOverlay() {
  const particles = Array.from({ length: 30 }, (_, i) => ({
    x: 100 + (i * 61.3) % 1700,
    y: 200 + (i * 43.7) % 700,
    dur: 3 + (i % 5) * 0.8,
    delay: i * 0.3,
    color: i % 3 === 0 ? "rgba(100,150,255,0.8)" : i % 3 === 1 ? "rgba(180,100,255,0.7)" : "rgba(100,220,255,0.7)",
    r: 2 + (i % 3),
  }));

  return (
    <svg width="100%" height="100%" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0 }}>
      {/* Magic particles rising */}
      {particles.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.r} fill={p.color} style={{ filter: "blur(0.5px)" }}>
          <animate attributeName="opacity" dur={`${p.dur}s`} repeatCount="indefinite"
            begin={`${p.delay}s`} values="0;0.8;0" />
          <animateTransform attributeName="transform" type="translate"
            dur={`${p.dur}s`} repeatCount="indefinite" begin={`${p.delay}s`}
            values={`0,0; ${-10 + (i%5)*5},${-60 - (i%4)*20}`} />
        </circle>
      ))}

      {/* Summon circle on ground */}
      <g transform="translate(320, 900)">
        <circle cx="0" cy="0" r="120" stroke="rgba(100,150,255,0.25)" strokeWidth="1.5" fill="none">
          <animateTransform attributeName="transform" type="rotate" dur="15s" repeatCount="indefinite" additive="sum" />
        </circle>
        <circle cx="0" cy="0" r="90" stroke="rgba(180,100,255,0.20)" strokeWidth="1" fill="none">
          <animateTransform attributeName="transform" type="rotate" dur="10s" repeatCount="indefinite" additive="sum" from="0" to="-360" />
        </circle>
        <circle cx="0" cy="0" r="60" stroke="rgba(100,220,255,0.25)" strokeWidth="1.5" fill="none">
          <animateTransform attributeName="transform" type="rotate" dur="8s" repeatCount="indefinite" additive="sum" />
        </circle>
        {/* Rune marks */}
        {[0,45,90,135,180,225,270,315].map((angle, i) => (
          <circle key={i}
            cx={Math.cos(angle * Math.PI / 180) * 90}
            cy={Math.sin(angle * Math.PI / 180) * 90}
            r="4" fill="rgba(100,150,255,0.5)">
            <animate attributeName="opacity" dur="2s" repeatCount="indefinite"
              begin={`${i * 0.25}s`} values="0.3;1;0.3" />
          </circle>
        ))}
        <animate attributeName="opacity" dur="4s" repeatCount="indefinite" values="0.5;1;0.5" />
      </g>

      {/* Crystal glow pulses */}
      {[
        { x: 280, y: 400, color: "rgba(100,150,255,0.12)", h: 200 },
        { x: 600, y: 350, color: "rgba(180,100,255,0.10)", h: 250 },
        { x: 150, y: 450, color: "rgba(100,220,255,0.08)", h: 180 },
      ].map((c, i) => (
        <rect key={i} x={c.x - 20} y={c.y - c.h} width="40" height={c.h}
          fill={c.color} style={{ filter: "blur(10px)" }}>
          <animate attributeName="opacity" dur={`${3 + i}s`} repeatCount="indefinite"
            values="0.5;1;0.5" />
        </rect>
      ))}

      {/* Airship light */}
      <radialGradient id="airshipLight" cx="65%" cy="15%" r="8%">
        <stop offset="0%" stopColor="rgba(255,200,100,0.12)" />
        <stop offset="100%" stopColor="rgba(255,200,100,0)" />
      </radialGradient>
      <rect x="0" y="0" width="1920" height="1080" fill="url(#airshipLight)">
        <animate attributeName="opacity" dur="5s" repeatCount="indefinite" values="0.5;1;0.5" />
      </rect>
    </svg>
  );
}

// ─── CSS Keyframes ────────────────────────────────────────────────────────────
const KEYFRAMES = `
  /* Ken Burns zoom-pan per skin */
  .skin-aurora-img       { animation: kb-aurora 25s ease-in-out infinite alternate; }
  .skin-goth-img         { animation: kb-goth 30s ease-in-out infinite alternate; }
  .skin-nature-img       { animation: kb-nature 28s ease-in-out infinite alternate; }
  .skin-cyberpunk-img    { animation: kb-cyberpunk 20s ease-in-out infinite alternate; }
  .skin-finalfantasy-img { animation: kb-ff 32s ease-in-out infinite alternate; }
  .skin-monsters-img     { animation: kb-monsters 22s ease-in-out infinite alternate; }
  .skin-lofi-img         { animation: kb-lofi 40s ease-in-out infinite alternate; }
  .skin-space-img        { animation: kb-space 45s ease-in-out infinite alternate; }
  .skin-luigi-img        { animation: kb-luigi 28s ease-in-out infinite alternate; }

  @keyframes kb-aurora    { from { transform: scale(1.0) translate(0%,0%); } to { transform: scale(1.08) translate(-2%,1%); } }
  @keyframes kb-goth      { from { transform: scale(1.0) translate(0%,0%); } to { transform: scale(1.06) translate(1%,-1%); } }
  @keyframes kb-nature    { from { transform: scale(1.0) translate(0%,0%); } to { transform: scale(1.07) translate(-1.5%,0.5%); } }
  @keyframes kb-cyberpunk { from { transform: scale(1.0) translate(0%,0%); } to { transform: scale(1.05) translate(1%,0.5%); } }
  @keyframes kb-ff        { from { transform: scale(1.0) translate(0%,0%); } to { transform: scale(1.08) translate(-1%,-1.5%); } }
  @keyframes kb-monsters  { from { transform: scale(1.0) translate(0%,0%); } to { transform: scale(1.06) translate(0.5%,1%); } }
  @keyframes kb-lofi      { from { transform: scale(1.0) translate(0%,0%); } to { transform: scale(1.03) translate(-0.5%,0.3%); } }
  @keyframes kb-space     { from { transform: scale(1.0) translate(0%,0%); } to { transform: scale(1.05) translate(0%,-0.8%); } }
  @keyframes kb-luigi     { from { transform: scale(1.0) translate(0%,0%); } to { transform: scale(1.07) translate(-1%,0.5%); } }

  @media (prefers-reduced-motion: reduce) {
    .skin-aurora-img, .skin-goth-img, .skin-nature-img, .skin-cyberpunk-img,
    .skin-finalfantasy-img, .skin-monsters-img, .skin-lofi-img, .skin-space-img,
    .skin-luigi-img { animation: none !important; }
  }
`;
