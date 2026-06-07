/**
 * ThemeCanvas — full-viewport animated background canvas
 * Andromeda v7.3.0
 *
 * Each skin is a self-contained painter function that receives a canvas 2D context
 * and a time value (seconds), and draws one frame. The RAF loop is managed here.
 */
import { useEffect, useRef } from "react";
import type { SkinId } from "@/lib/themeEngine";

// ─── Skin painters ────────────────────────────────────────────────────────────

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

// ── Aurora ────────────────────────────────────────────────────────────────────
function paintAurora(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.clearRect(0, 0, w, h);
  // Deep space base
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#050010");
  bg.addColorStop(1, "#0a0820");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Stars
  const starCount = 120;
  for (let i = 0; i < starCount; i++) {
    const sx = ((i * 137.508 + 50) % w);
    const sy = ((i * 97.3 + 20) % h);
    const alpha = 0.3 + 0.5 * Math.abs(Math.sin(t * 0.4 + i));
    ctx.beginPath();
    ctx.arc(sx, sy, i % 3 === 0 ? 1.2 : 0.6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(200,210,255,${alpha})`;
    ctx.fill();
  }

  // Aurora blobs
  const blobs = [
    { cx: 0.3, cy: 0.35, rx: 0.55, ry: 0.18, hue: 265, speed: 0.12 },
    { cx: 0.7, cy: 0.45, rx: 0.45, ry: 0.14, hue: 290, speed: 0.09 },
    { cx: 0.5, cy: 0.55, rx: 0.60, ry: 0.12, hue: 240, speed: 0.07 },
  ];
  ctx.globalCompositeOperation = "screen";
  for (const b of blobs) {
    const ox = Math.sin(t * b.speed + b.hue) * 0.08 * w;
    const oy = Math.cos(t * b.speed * 0.7 + b.hue) * 0.05 * h;
    const grd = ctx.createRadialGradient(
      b.cx * w + ox, b.cy * h + oy, 0,
      b.cx * w + ox, b.cy * h + oy, b.rx * w,
    );
    grd.addColorStop(0, `hsla(${b.hue},80%,55%,0.22)`);
    grd.addColorStop(0.5, `hsla(${b.hue + 20},70%,45%,0.10)`);
    grd.addColorStop(1, "transparent");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(b.cx * w + ox, b.cy * h + oy, b.rx * w, b.ry * h, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

// ── Goth / Tarot ──────────────────────────────────────────────────────────────
interface GothParticle { x: number; y: number; vx: number; vy: number; size: number; alpha: number; type: "ember" | "smoke" | "card" }
const gothParticles: GothParticle[] = [];
function initGoth(w: number, h: number) {
  gothParticles.length = 0;
  for (let i = 0; i < 40; i++) {
    gothParticles.push({
      x: Math.random() * w, y: h * 0.6 + Math.random() * h * 0.4,
      vx: (Math.random() - 0.5) * 0.4, vy: -(0.3 + Math.random() * 0.6),
      size: 1 + Math.random() * 2, alpha: 0.5 + Math.random() * 0.5,
      type: "ember",
    });
  }
  for (let i = 0; i < 6; i++) {
    gothParticles.push({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.15, vy: -0.08 - Math.random() * 0.1,
      size: 28 + Math.random() * 20, alpha: 0.12 + Math.random() * 0.1,
      type: "card",
    });
  }
}
let gothInit = false;
function paintGoth(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  if (!gothInit) { initGoth(w, h); gothInit = true; }
  ctx.clearRect(0, 0, w, h);
  // Dark altar background
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#050005");
  bg.addColorStop(0.6, "#100018");
  bg.addColorStop(1, "#1a0010");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Moon
  const moonX = w * 0.75, moonY = h * 0.15;
  const moonGrd = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, 60);
  moonGrd.addColorStop(0, "rgba(240,230,200,0.9)");
  moonGrd.addColorStop(0.3, "rgba(200,180,160,0.4)");
  moonGrd.addColorStop(1, "transparent");
  ctx.fillStyle = moonGrd;
  ctx.beginPath();
  ctx.arc(moonX, moonY, 60, 0, Math.PI * 2);
  ctx.fill();

  // Candle flames (3 candles)
  const candles = [0.2, 0.5, 0.8];
  for (const cx of candles) {
    const flicker = Math.sin(t * 8 + cx * 10) * 0.15;
    const fx = cx * w + Math.sin(t * 3 + cx * 5) * 3;
    const fy = h * 0.78;
    const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, 18 + flicker * 8);
    fg.addColorStop(0, "rgba(255,200,80,0.95)");
    fg.addColorStop(0.3, "rgba(255,120,20,0.6)");
    fg.addColorStop(1, "transparent");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.ellipse(fx, fy, 8 + flicker * 3, 18 + flicker * 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Glow halo
    const halo = ctx.createRadialGradient(fx, fy, 0, fx, fy, 60);
    halo.addColorStop(0, "rgba(255,160,40,0.08)");
    halo.addColorStop(1, "transparent");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(fx, fy, 60, 0, Math.PI * 2);
    ctx.fill();
  }

  // Embers & cards
  for (const p of gothParticles) {
    p.x += p.vx; p.y += p.vy;
    if (p.y < -40) { p.y = h + 10; p.x = Math.random() * w; }
    if (p.type === "ember") {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,${80 + Math.random() * 60},20,${p.alpha * (0.5 + 0.5 * Math.sin(t * 3 + p.x))})`;
      ctx.fill();
    } else if (p.type === "card") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.sin(t * 0.2 + p.x) * 0.3);
      ctx.globalAlpha = p.alpha;
      ctx.strokeStyle = "rgba(180,120,220,0.6)";
      ctx.lineWidth = 1;
      ctx.strokeRect(-p.size * 0.6, -p.size, p.size * 1.2, p.size * 2);
      // Star symbol on card
      ctx.fillStyle = "rgba(200,150,255,0.4)";
      ctx.font = `${p.size}px serif`;
      ctx.fillText("★", -p.size * 0.3, p.size * 0.4);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  // Purple mist at bottom
  const mist = ctx.createLinearGradient(0, h * 0.7, 0, h);
  mist.addColorStop(0, "transparent");
  mist.addColorStop(1, "rgba(80,0,120,0.35)");
  ctx.fillStyle = mist;
  ctx.fillRect(0, h * 0.7, w, h * 0.3);
}

// ── Enchanted Nature ──────────────────────────────────────────────────────────
interface Firefly { x: number; y: number; vx: number; vy: number; phase: number; size: number }
interface Leaf { x: number; y: number; vx: number; vy: number; rot: number; vrot: number; size: number; hue: number }
const fireflies: Firefly[] = [];
const leaves: Leaf[] = [];
let natureInit = false;
function initNature(w: number, h: number) {
  fireflies.length = 0; leaves.length = 0;
  for (let i = 0; i < 35; i++) {
    fireflies.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.3, phase: Math.random() * Math.PI * 2, size: 1.5 + Math.random() * 2 });
  }
  for (let i = 0; i < 20; i++) {
    leaves.push({ x: Math.random() * w, y: -20 - Math.random() * h, vx: (Math.random() - 0.5) * 0.8, vy: 0.4 + Math.random() * 0.6, rot: Math.random() * Math.PI * 2, vrot: (Math.random() - 0.5) * 0.04, size: 6 + Math.random() * 10, hue: 100 + Math.random() * 60 });
  }
}
function paintNature(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  if (!natureInit) { initNature(w, h); natureInit = true; }
  ctx.clearRect(0, 0, w, h);
  // Night forest
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#010804");
  bg.addColorStop(0.5, "#030f06");
  bg.addColorStop(1, "#020a04");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Moon glow
  const mg = ctx.createRadialGradient(w * 0.2, h * 0.12, 0, w * 0.2, h * 0.12, 100);
  mg.addColorStop(0, "rgba(200,255,180,0.15)");
  mg.addColorStop(1, "transparent");
  ctx.fillStyle = mg;
  ctx.fillRect(0, 0, w, h);

  // Bioluminescent mushroom glows at bottom
  const shrooms = [0.1, 0.3, 0.55, 0.75, 0.9];
  for (const sx of shrooms) {
    const sg = ctx.createRadialGradient(sx * w, h * 0.92, 0, sx * w, h * 0.92, 40);
    sg.addColorStop(0, `rgba(80,255,${100 + Math.sin(t * 0.5 + sx * 10) * 50},0.25)`);
    sg.addColorStop(1, "transparent");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sx * w, h * 0.92, 40, 0, Math.PI * 2);
    ctx.fill();
  }

  // Leaves
  for (const l of leaves) {
    l.x += l.vx + Math.sin(t * 0.5 + l.y * 0.01) * 0.3;
    l.y += l.vy;
    l.rot += l.vrot;
    if (l.y > h + 20) { l.y = -20; l.x = Math.random() * w; }
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(l.rot);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = `hsl(${l.hue},70%,35%)`;
    ctx.beginPath();
    ctx.ellipse(0, 0, l.size * 0.4, l.size, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Fireflies
  for (const f of fireflies) {
    f.x += f.vx + Math.sin(t * 0.3 + f.phase) * 0.3;
    f.y += f.vy + Math.cos(t * 0.2 + f.phase) * 0.2;
    if (f.x < 0) f.x = w; if (f.x > w) f.x = 0;
    if (f.y < 0) f.y = h; if (f.y > h) f.y = 0;
    const pulse = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + f.phase));
    const fg = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.size * 4);
    fg.addColorStop(0, `rgba(180,255,100,${pulse * 0.9})`);
    fg.addColorStop(1, "transparent");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.size * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(220,255,150,${pulse})`;
    ctx.fill();
  }

  // Ground mist
  const mist = ctx.createLinearGradient(0, h * 0.8, 0, h);
  mist.addColorStop(0, "transparent");
  mist.addColorStop(1, "rgba(20,80,20,0.4)");
  ctx.fillStyle = mist;
  ctx.fillRect(0, h * 0.8, w, h * 0.2);
}

// ── Cyberpunk ─────────────────────────────────────────────────────────────────
interface RainDrop { x: number; y: number; speed: number; length: number; alpha: number }
interface DataStream { x: number; y: number; chars: string[]; speed: number; alpha: number }
const rainDrops: RainDrop[] = [];
const dataStreams: DataStream[] = [];
let cyberInit = false;
const CYBER_CHARS = "01アイウエオカキクケコサシスセソタチツテトナニヌネノ";
function initCyber(w: number, h: number) {
  rainDrops.length = 0; dataStreams.length = 0;
  for (let i = 0; i < 120; i++) {
    rainDrops.push({ x: Math.random() * w, y: Math.random() * h, speed: 4 + Math.random() * 8, length: 10 + Math.random() * 30, alpha: 0.1 + Math.random() * 0.4 });
  }
  for (let i = 0; i < 15; i++) {
    const chars = Array.from({ length: 8 }, () => CYBER_CHARS[Math.floor(Math.random() * CYBER_CHARS.length)]);
    dataStreams.push({ x: (i / 15) * w + Math.random() * 40, y: Math.random() * h, chars, speed: 0.5 + Math.random() * 1.5, alpha: 0.15 + Math.random() * 0.2 });
  }
}
function paintCyberpunk(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  if (!cyberInit) { initCyber(w, h); cyberInit = true; }
  // Fade trail
  ctx.fillStyle = "rgba(0,8,8,0.25)";
  ctx.fillRect(0, 0, w, h);

  // Neon horizon glow
  const hg = ctx.createLinearGradient(0, h * 0.55, 0, h);
  hg.addColorStop(0, "rgba(0,255,200,0.04)");
  hg.addColorStop(0.5, "rgba(180,0,255,0.06)");
  hg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = hg;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);

  // Grid lines (perspective floor)
  ctx.strokeStyle = "rgba(0,255,200,0.06)";
  ctx.lineWidth = 0.5;
  const vp = { x: w / 2, y: h * 0.6 };
  for (let i = 0; i <= 20; i++) {
    const x = (i / 20) * w;
    ctx.beginPath(); ctx.moveTo(vp.x, vp.y); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let i = 0; i <= 8; i++) {
    const progress = i / 8;
    const y = vp.y + (h - vp.y) * progress;
    const xl = vp.x - (vp.x) * progress;
    const xr = vp.x + (w - vp.x) * progress;
    ctx.beginPath(); ctx.moveTo(xl, y); ctx.lineTo(xr, y); ctx.stroke();
  }

  // Rain
  for (const r of rainDrops) {
    r.y += r.speed;
    if (r.y > h) { r.y = -r.length; r.x = Math.random() * w; }
    ctx.strokeStyle = `rgba(0,200,255,${r.alpha})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x - 1, r.y + r.length);
    ctx.stroke();
  }

  // Data streams (Matrix-style)
  ctx.font = "10px monospace";
  for (const ds of dataStreams) {
    ds.y += ds.speed;
    if (ds.y > h + 100) { ds.y = -100; ds.chars = Array.from({ length: 8 }, () => CYBER_CHARS[Math.floor(Math.random() * CYBER_CHARS.length)]); }
    for (let i = 0; i < ds.chars.length; i++) {
      const alpha = ds.alpha * (1 - i / ds.chars.length);
      ctx.fillStyle = i === 0 ? `rgba(180,255,255,${alpha * 2})` : `rgba(0,255,180,${alpha})`;
      ctx.fillText(ds.chars[i], ds.x, ds.y - i * 12);
    }
  }

  // Scanlines
  for (let y = 0; y < h; y += 3) {
    ctx.fillStyle = "rgba(0,0,0,0.03)";
    ctx.fillRect(0, y, w, 1);
  }

  // Neon flicker
  if (Math.random() < 0.003) {
    ctx.fillStyle = "rgba(0,255,200,0.015)";
    ctx.fillRect(0, 0, w, h);
  }
}

// ── Final Fantasy ─────────────────────────────────────────────────────────────
interface FFSprite { x: number; y: number; vx: number; vy: number; type: string; frame: number; size: number; alpha: number }
const ffSprites: FFSprite[] = [];
const FF_TYPES = ["moogle", "vivi", "crystal", "chocobo", "meteor", "summon"];
let ffInit = false;
function initFF(w: number, h: number) {
  ffSprites.length = 0;
  const types = [...FF_TYPES, ...FF_TYPES]; // 12 sprites
  for (let i = 0; i < types.length; i++) {
    ffSprites.push({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.3,
      type: types[i], frame: Math.random() * 100,
      size: 18 + Math.random() * 16, alpha: 0.5 + Math.random() * 0.5,
    });
  }
}
function drawFFSprite(ctx: CanvasRenderingContext2D, s: FFSprite, t: number) {
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.globalAlpha = s.alpha * (0.7 + 0.3 * Math.sin(t * 1.5 + s.frame));
  const bob = Math.sin(t * 1.2 + s.frame) * 3;
  ctx.translate(0, bob);
  ctx.font = `${s.size}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const emojis: Record<string, string> = {
    moogle: "🐾", vivi: "🧙", crystal: "💎", chocobo: "🐦", meteor: "☄️", summon: "⚡",
  };
  // Glow
  ctx.shadowColor = s.type === "crystal" ? "#88f" : s.type === "meteor" ? "#f84" : "#4af";
  ctx.shadowBlur = 12;
  ctx.fillText(emojis[s.type] ?? "✨", 0, 0);
  ctx.restore();
}
function paintFF(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  if (!ffInit) { initFF(w, h); ffInit = true; }
  ctx.clearRect(0, 0, w, h);
  // Mystic sky
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#08041a");
  bg.addColorStop(0.5, "#140830");
  bg.addColorStop(1, "#0a0420");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Stars
  for (let i = 0; i < 80; i++) {
    const sx = (i * 173.3) % w, sy = (i * 89.7) % h;
    const a = 0.3 + 0.5 * Math.abs(Math.sin(t * 0.5 + i));
    ctx.beginPath(); ctx.arc(sx, sy, 0.8, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(200,180,255,${a})`; ctx.fill();
  }

  // Crystal light pillars
  for (let i = 0; i < 4; i++) {
    const px = (0.15 + i * 0.25) * w;
    const pulse = 0.04 + 0.02 * Math.sin(t * 0.8 + i);
    const pg = ctx.createLinearGradient(px, 0, px, h);
    pg.addColorStop(0, `rgba(150,100,255,${pulse})`);
    pg.addColorStop(0.5, `rgba(100,180,255,${pulse * 0.5})`);
    pg.addColorStop(1, "transparent");
    ctx.fillStyle = pg;
    ctx.fillRect(px - 15, 0, 30, h);
  }

  // Sprites
  for (const s of ffSprites) {
    s.x += s.vx; s.y += s.vy; s.frame += 0.02;
    if (s.x < -40) s.x = w + 40;
    if (s.x > w + 40) s.x = -40;
    if (s.y < -40) s.y = h + 40;
    if (s.y > h + 40) s.y = -40;
    drawFFSprite(ctx, s, t);
  }

  // Floating magic particles
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 30; i++) {
    const px = (Math.sin(t * 0.3 + i * 1.7) * 0.5 + 0.5) * w;
    const py = (Math.cos(t * 0.2 + i * 2.3) * 0.5 + 0.5) * h;
    const pg = ctx.createRadialGradient(px, py, 0, px, py, 8);
    pg.addColorStop(0, `hsla(${(i * 30 + t * 20) % 360},80%,70%,0.3)`);
    pg.addColorStop(1, "transparent");
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

// ── Monsters Inc ──────────────────────────────────────────────────────────────
interface Monster { x: number; y: number; vx: number; vy: number; type: number; size: number; phase: number; peeking: boolean; peekProgress: number }
const monsters: Monster[] = [];
let monstersInit = false;
const MONSTER_EMOJIS = ["👾", "🐙", "🦑", "🐸", "👻", "🤖", "👽", "🦎", "🐲", "🦕"];
function initMonsters(w: number, h: number) {
  monsters.length = 0;
  for (let i = 0; i < 14; i++) {
    monsters.push({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.4,
      type: Math.floor(Math.random() * MONSTER_EMOJIS.length),
      size: 20 + Math.random() * 24, phase: Math.random() * Math.PI * 2,
      peeking: Math.random() < 0.3, peekProgress: Math.random(),
    });
  }
}
function paintMonsters(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  if (!monstersInit) { initMonsters(w, h); monstersInit = true; }
  ctx.clearRect(0, 0, w, h);
  // Cozy dark blue background
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#040810");
  bg.addColorStop(1, "#081020");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Polka-dot subtle pattern
  for (let i = 0; i < 40; i++) {
    const dx = (i * 137.5) % w, dy = (i * 89.3) % h;
    ctx.beginPath(); ctx.arc(dx, dy, 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(100,150,255,0.04)`; ctx.fill();
  }

  // Door glow effects (Monsters Inc doors)
  const doors = [0.1, 0.5, 0.9];
  for (const dx of doors) {
    const glow = 0.03 + 0.02 * Math.sin(t * 0.5 + dx * 10);
    const dg = ctx.createRadialGradient(dx * w, h * 0.5, 0, dx * w, h * 0.5, 80);
    dg.addColorStop(0, `rgba(80,200,255,${glow})`);
    dg.addColorStop(1, "transparent");
    ctx.fillStyle = dg;
    ctx.fillRect(0, 0, w, h);
  }

  // Monsters
  for (const m of monsters) {
    m.x += m.vx + Math.sin(t * 0.4 + m.phase) * 0.2;
    m.y += m.vy + Math.cos(t * 0.3 + m.phase) * 0.15;
    if (m.x < -40) m.x = w + 40;
    if (m.x > w + 40) m.x = -40;
    if (m.y < -40) m.y = h + 40;
    if (m.y > h + 40) m.y = -40;

    const bounce = Math.sin(t * 2 + m.phase) * 4;
    const squish = 1 + Math.sin(t * 2 + m.phase) * 0.08;

    ctx.save();
    ctx.translate(m.x, m.y + bounce);
    ctx.scale(1 / squish, squish);
    ctx.font = `${m.size}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(100,200,255,0.4)";
    ctx.shadowBlur = 10;
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t + m.phase);
    ctx.fillText(MONSTER_EMOJIS[m.type], 0, 0);
    ctx.restore();
  }

  // Sparkles
  for (let i = 0; i < 20; i++) {
    const sx = (Math.sin(t * 0.5 + i * 2.1) * 0.5 + 0.5) * w;
    const sy = (Math.cos(t * 0.4 + i * 1.7) * 0.5 + 0.5) * h;
    const sa = 0.3 + 0.5 * Math.abs(Math.sin(t * 2 + i));
    ctx.beginPath(); ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(180,220,255,${sa})`; ctx.fill();
  }
}

// ─── Painter map ──────────────────────────────────────────────────────────────
const PAINTERS: Record<SkinId, Painter> = {
  aurora: paintAurora,
  goth: paintGoth,
  nature: paintNature,
  cyberpunk: paintCyberpunk,
  finalfantasy: paintFF,
  monsters: paintMonsters,
};

// ─── Component ────────────────────────────────────────────────────────────────
interface ThemeCanvasProps {
  skin: SkinId;
}

export function ThemeCanvas({ skin }: ThemeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(performance.now());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Reset init flags when skin changes
    gothInit = false;
    natureInit = false;
    cyberInit = false;
    ffInit = false;
    monstersInit = false;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const paint = PAINTERS[skin] ?? paintAurora;
    startRef.current = performance.now();

    const loop = () => {
      const t = (performance.now() - startRef.current) / 1000;
      paint(ctx, canvas.width, canvas.height, t);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [skin]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0, opacity: 0.85 }}
    />
  );
}
