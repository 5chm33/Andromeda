/**
 * ThemeCanvas — full-viewport animated background canvas
 * Andromeda v7.4.0 — Cinematic Quality Skins
 *
 * All art is drawn with canvas 2D path/bezier/gradient operations.
 * No emoji placeholders — real canvas art with depth and atmosphere.
 */
import { useEffect, useRef } from "react";
import type { SkinId } from "@/lib/themeEngine";

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

// ═══════════════════════════════════════════════════════════════════════════════
// ── AURORA ────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function paintAurora(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#020008"); bg.addColorStop(0.5, "#06041a"); bg.addColorStop(1, "#0a0820");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

  // Three-layer star field
  const seeds = [137.508, 97.3, 251.7, 173.1, 317.4];
  for (let layer = 0; layer < 3; layer++) {
    const count = layer === 0 ? 200 : layer === 1 ? 80 : 30;
    const baseSize = layer === 0 ? 0.5 : layer === 1 ? 1.0 : 1.6;
    for (let i = 0; i < count; i++) {
      const sx = ((i * seeds[layer % 5] + layer * 200 + 50) % w);
      const sy = ((i * seeds[(layer + 1) % 5] + layer * 100 + 20) % (h * 0.85));
      const twinkle = layer === 2
        ? 0.4 + 0.6 * Math.abs(Math.sin(t * 0.8 + i * 0.3))
        : 0.6 + 0.4 * Math.abs(Math.sin(t * 0.3 + i));
      ctx.beginPath(); ctx.arc(sx, sy, baseSize, 0, Math.PI * 2);
      ctx.fillStyle = layer === 2 ? `rgba(255,240,200,${twinkle})` : `rgba(200,210,255,${twinkle * 0.7})`;
      ctx.fill();
    }
  }

  // Shooting star
  const shootT = (t * 0.07) % 1;
  if (shootT < 0.12) {
    const prog = shootT / 0.12;
    const sx = w * 0.8 - prog * w * 0.5, sy = h * 0.1 + prog * h * 0.15;
    const len = 80 * Math.sin(prog * Math.PI);
    const sg = ctx.createLinearGradient(sx, sy, sx + len, sy - len * 0.3);
    sg.addColorStop(0, "rgba(255,255,255,0)"); sg.addColorStop(0.5, "rgba(255,255,255,0.8)"); sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = sg; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + len, sy - len * 0.3); ctx.stroke();
  }

  // Aurora curtains — layered sine waves
  ctx.globalCompositeOperation = "screen";
  const curtains = [
    { hue: 160, hue2: 200, cy: 0.30, amp: 0.07, freq: 0.8, speed: 0.06, alpha: 0.18 },
    { hue: 260, hue2: 290, cy: 0.40, amp: 0.05, freq: 1.1, speed: 0.09, alpha: 0.14 },
    { hue: 200, hue2: 240, cy: 0.50, amp: 0.06, freq: 0.6, speed: 0.04, alpha: 0.12 },
    { hue: 140, hue2: 180, cy: 0.35, amp: 0.04, freq: 1.4, speed: 0.11, alpha: 0.10 },
  ];
  for (const c of curtains) {
    const yBase = c.cy * h, thickness = h * 0.18;
    const steps = 80;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const px = (i / steps) * w;
      const py = yBase + Math.sin(px * c.freq * 0.005 + t * c.speed) * c.amp * h
                       + Math.sin(px * c.freq * 0.009 + t * c.speed * 1.3 + 1.2) * c.amp * h * 0.5;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    for (let i = steps; i >= 0; i--) {
      const px = (i / steps) * w;
      const py = yBase + Math.sin(px * c.freq * 0.005 + t * c.speed) * c.amp * h
                       + Math.sin(px * c.freq * 0.009 + t * c.speed * 1.3 + 1.2) * c.amp * h * 0.5 + thickness;
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    const grd = ctx.createLinearGradient(0, yBase - thickness * 0.5, 0, yBase + thickness * 1.5);
    grd.addColorStop(0, "transparent");
    grd.addColorStop(0.3, `hsla(${c.hue},80%,60%,${c.alpha})`);
    grd.addColorStop(0.7, `hsla(${c.hue2},70%,50%,${c.alpha * 0.6})`);
    grd.addColorStop(1, "transparent");
    ctx.fillStyle = grd; ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  // Nebula wisps
  ctx.globalCompositeOperation = "screen";
  const wisps = [
    { x: 0.2, y: 0.6, r: 0.25, hue: 220 },
    { x: 0.75, y: 0.7, r: 0.20, hue: 280 },
    { x: 0.5, y: 0.8, r: 0.30, hue: 200 },
  ];
  for (const wp of wisps) {
    const ox = Math.sin(t * 0.04 + wp.hue) * 0.03 * w;
    const oy = Math.cos(t * 0.03 + wp.hue) * 0.02 * h;
    const wg = ctx.createRadialGradient(wp.x * w + ox, wp.y * h + oy, 0, wp.x * w + ox, wp.y * h + oy, wp.r * w);
    wg.addColorStop(0, `hsla(${wp.hue},60%,40%,0.08)`);
    wg.addColorStop(0.5, `hsla(${wp.hue + 30},50%,30%,0.04)`);
    wg.addColorStop(1, "transparent");
    ctx.fillStyle = wg;
    ctx.beginPath(); ctx.ellipse(wp.x * w + ox, wp.y * h + oy, wp.r * w, wp.r * h * 0.6, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── GOTH — Cologne Cathedral ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
interface Bat { x: number; y: number; vx: number; vy: number; phase: number; size: number }
interface GothCloud { x: number; y: number; vx: number; w: number; h: number; alpha: number }
const bats: Bat[] = [];
const gothClouds: GothCloud[] = [];
let gothInit = false;

function initGoth(cw: number, ch: number) {
  bats.length = 0; gothClouds.length = 0;
  for (let i = 0; i < 18; i++) {
    bats.push({
      x: Math.random() * cw, y: ch * 0.1 + Math.random() * ch * 0.5,
      vx: (Math.random() - 0.5) * 1.2 + (Math.random() > 0.5 ? 0.6 : -0.6),
      vy: (Math.random() - 0.5) * 0.5,
      phase: Math.random() * Math.PI * 2,
      size: 6 + Math.random() * 8,
    });
  }
  for (let i = 0; i < 6; i++) {
    gothClouds.push({
      x: Math.random() * cw * 1.5 - cw * 0.25,
      y: ch * 0.05 + Math.random() * ch * 0.35,
      vx: 0.15 + Math.random() * 0.25,
      w: 120 + Math.random() * 200,
      h: 40 + Math.random() * 60,
      alpha: 0.06 + Math.random() * 0.08,
    });
  }
}

function drawBat(ctx: CanvasRenderingContext2D, bat: Bat, t: number) {
  const wing = Math.sin(t * 6 + bat.phase) * 0.8;
  ctx.save();
  ctx.translate(bat.x, bat.y);
  if (bat.vx < 0) ctx.scale(-1, 1);
  ctx.fillStyle = "rgba(20,0,30,0.85)";
  ctx.beginPath();
  ctx.ellipse(0, 0, bat.size * 0.35, bat.size * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-bat.size * 0.5, -bat.size * wing, -bat.size * 1.2, -bat.size * wing * 0.3, -bat.size * 1.3, bat.size * 0.2);
  ctx.bezierCurveTo(-bat.size * 0.8, bat.size * 0.1, -bat.size * 0.4, bat.size * 0.15, 0, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(bat.size * 0.5, -bat.size * wing, bat.size * 1.2, -bat.size * wing * 0.3, bat.size * 1.3, bat.size * 0.2);
  ctx.bezierCurveTo(bat.size * 0.8, bat.size * 0.1, bat.size * 0.4, bat.size * 0.15, 0, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-bat.size * 0.15, -bat.size * 0.2);
  ctx.lineTo(-bat.size * 0.25, -bat.size * 0.5);
  ctx.lineTo(-bat.size * 0.05, -bat.size * 0.2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(bat.size * 0.15, -bat.size * 0.2);
  ctx.lineTo(bat.size * 0.25, -bat.size * 0.5);
  ctx.lineTo(bat.size * 0.05, -bat.size * 0.2);
  ctx.fill();
  ctx.restore();
}

function drawCathedralSilhouette(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cx = w * 0.5;
  const base = h;
  const sw = w / 800;
  const sh = h / 600;
  ctx.fillStyle = "rgba(5,0,10,0.92)";
  ctx.beginPath();
  ctx.moveTo(cx - 280 * sw, base);
  ctx.lineTo(cx - 280 * sw, base - 200 * sh);
  ctx.lineTo(cx - 240 * sw, base - 210 * sh);
  ctx.lineTo(cx - 200 * sw, base - 230 * sh);
  ctx.lineTo(cx - 160 * sw, base - 240 * sh);
  ctx.lineTo(cx - 160 * sw, base - 340 * sh);
  ctx.lineTo(cx - 120 * sw, base - 340 * sh);
  ctx.lineTo(cx - 120 * sw, base - 420 * sh);
  ctx.lineTo(cx - 105 * sw, base - 430 * sh);
  ctx.lineTo(cx - 90 * sw, base - 520 * sh);
  ctx.lineTo(cx - 75 * sw, base - 430 * sh);
  ctx.lineTo(cx - 60 * sw, base - 420 * sh);
  ctx.lineTo(cx - 60 * sw, base - 360 * sh);
  ctx.lineTo(cx - 40 * sw, base - 370 * sh);
  ctx.lineTo(cx, base - 390 * sh);
  ctx.lineTo(cx + 40 * sw, base - 370 * sh);
  ctx.lineTo(cx + 60 * sw, base - 360 * sh);
  ctx.lineTo(cx + 60 * sw, base - 420 * sh);
  ctx.lineTo(cx + 75 * sw, base - 430 * sh);
  ctx.lineTo(cx + 90 * sw, base - 520 * sh);
  ctx.lineTo(cx + 105 * sw, base - 430 * sh);
  ctx.lineTo(cx + 120 * sw, base - 420 * sh);
  ctx.lineTo(cx + 120 * sw, base - 340 * sh);
  ctx.lineTo(cx + 160 * sw, base - 340 * sh);
  ctx.lineTo(cx + 160 * sw, base - 240 * sh);
  ctx.lineTo(cx + 200 * sw, base - 230 * sh);
  ctx.lineTo(cx + 240 * sw, base - 210 * sh);
  ctx.lineTo(cx + 280 * sw, base - 200 * sh);
  ctx.lineTo(cx + 280 * sw, base);
  ctx.closePath();
  ctx.fill();
  // Gothic entrance arch
  ctx.fillStyle = "rgba(30,5,50,0.5)";
  ctx.beginPath();
  const archW = 50 * sw, archH = 90 * sh;
  ctx.moveTo(cx - archW, base);
  ctx.lineTo(cx - archW, base - archH * 0.7);
  ctx.bezierCurveTo(cx - archW, base - archH * 1.1, cx + archW, base - archH * 1.1, cx + archW, base - archH * 0.7);
  ctx.lineTo(cx + archW, base);
  ctx.closePath();
  ctx.fill();
  // Rose window glow
  const rwX = cx, rwY = base - 370 * sh, rwR = 28 * sw;
  const rwGrd = ctx.createRadialGradient(rwX, rwY, 0, rwX, rwY, rwR * 3);
  rwGrd.addColorStop(0, "rgba(180,60,255,0.35)");
  rwGrd.addColorStop(0.3, "rgba(120,20,200,0.15)");
  rwGrd.addColorStop(1, "transparent");
  ctx.fillStyle = rwGrd;
  ctx.beginPath(); ctx.arc(rwX, rwY, rwR * 3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(180,80,255,0.5)"; ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(rwX, rwY);
    ctx.lineTo(rwX + Math.cos(angle) * rwR, rwY + Math.sin(angle) * rwR); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(rwX, rwY, rwR, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(rwX, rwY, rwR * 0.5, 0, Math.PI * 2); ctx.stroke();
}

function paintGoth(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  if (!gothInit) { initGoth(w, h); gothInit = true; }
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#020005"); bg.addColorStop(0.4, "#0a0015");
  bg.addColorStop(0.7, "#120020"); bg.addColorStop(1, "#080010");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  // Stars
  for (let i = 0; i < 150; i++) {
    const sx = ((i * 137.508 + 50) % w), sy = ((i * 97.3 + 20) % (h * 0.7));
    const alpha = 0.2 + 0.5 * Math.abs(Math.sin(t * 0.3 + i * 0.5));
    ctx.beginPath(); ctx.arc(sx, sy, i % 5 === 0 ? 1.2 : 0.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(220,200,255,${alpha})`; ctx.fill();
  }
  // Full moon
  const moonX = w * 0.72, moonY = h * 0.14, moonR = Math.min(w, h) * 0.065;
  const moonHalo = ctx.createRadialGradient(moonX, moonY, moonR * 0.8, moonX, moonY, moonR * 3.5);
  moonHalo.addColorStop(0, "rgba(240,220,180,0.12)"); moonHalo.addColorStop(1, "transparent");
  ctx.fillStyle = moonHalo; ctx.beginPath(); ctx.arc(moonX, moonY, moonR * 3.5, 0, Math.PI * 2); ctx.fill();
  const moonGrd = ctx.createRadialGradient(moonX - moonR * 0.2, moonY - moonR * 0.2, 0, moonX, moonY, moonR);
  moonGrd.addColorStop(0, "rgba(255,248,220,0.95)"); moonGrd.addColorStop(0.6, "rgba(220,200,170,0.85)"); moonGrd.addColorStop(1, "rgba(180,160,130,0.7)");
  ctx.fillStyle = moonGrd; ctx.beginPath(); ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(150,130,110,0.15)";
  ctx.beginPath(); ctx.arc(moonX + moonR * 0.2, moonY - moonR * 0.1, moonR * 0.12, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(moonX - moonR * 0.3, moonY + moonR * 0.2, moonR * 0.08, 0, Math.PI * 2); ctx.fill();
  // Clouds
  for (const cloud of gothClouds) {
    cloud.x += cloud.vx;
    if (cloud.x > w + cloud.w) cloud.x = -cloud.w;
    ctx.save(); ctx.globalAlpha = cloud.alpha; ctx.fillStyle = "rgba(40,20,60,1)";
    ctx.beginPath(); ctx.ellipse(cloud.x, cloud.y, cloud.w * 0.5, cloud.h * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cloud.x + cloud.w * 0.2, cloud.y - cloud.h * 0.1, cloud.w * 0.35, cloud.h * 0.35, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cloud.x - cloud.w * 0.2, cloud.y + cloud.h * 0.05, cloud.w * 0.3, cloud.h * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // Cathedral
  drawCathedralSilhouette(ctx, w, h);
  // Bats
  for (const bat of bats) {
    bat.vx += (w * 0.5 - bat.x) * 0.00008 + Math.sin(t * 0.5 + bat.phase) * 0.02;
    bat.vy += (h * 0.3 - bat.y) * 0.00008 + Math.cos(t * 0.4 + bat.phase) * 0.015;
    const spd = Math.sqrt(bat.vx * bat.vx + bat.vy * bat.vy);
    if (spd > 1.8) { bat.vx = (bat.vx / spd) * 1.8; bat.vy = (bat.vy / spd) * 1.8; }
    bat.x += bat.vx; bat.y += bat.vy;
    if (bat.x < -30) bat.x = w + 30; if (bat.x > w + 30) bat.x = -30;
    if (bat.y < 0) bat.y = h * 0.6; if (bat.y > h * 0.7) bat.y = h * 0.05;
    drawBat(ctx, bat, t);
  }
  // Ground mist
  const mist = ctx.createLinearGradient(0, h * 0.72, 0, h);
  mist.addColorStop(0, "transparent"); mist.addColorStop(0.5, "rgba(60,0,100,0.20)"); mist.addColorStop(1, "rgba(30,0,60,0.40)");
  ctx.fillStyle = mist; ctx.fillRect(0, h * 0.72, w, h * 0.28);
  ctx.globalCompositeOperation = "screen";
  const atmo = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, w * 0.6);
  atmo.addColorStop(0, "rgba(80,0,120,0.04)"); atmo.addColorStop(1, "transparent");
  ctx.fillStyle = atmo; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── NATURE — Jungle Canyon & Forest ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
interface TropicalBird { x: number; y: number; vx: number; vy: number; phase: number; size: number; hue: number }
interface MistParticle { x: number; y: number; vx: number; vy: number; r: number; alpha: number }
const tropicalBirds: TropicalBird[] = [];
const mistParticles: MistParticle[] = [];
let natureInit = false;

function initNature(cw: number, ch: number) {
  tropicalBirds.length = 0; mistParticles.length = 0;
  for (let i = 0; i < 8; i++) {
    tropicalBirds.push({
      x: -80 - Math.random() * cw, y: ch * 0.08 + Math.random() * ch * 0.35,
      vx: 0.6 + Math.random() * 0.8, vy: (Math.random() - 0.5) * 0.2,
      phase: Math.random() * Math.PI * 2, size: 10 + Math.random() * 8,
      hue: 10 + Math.random() * 40,
    });
  }
  for (let i = 0; i < 60; i++) {
    mistParticles.push({
      x: Math.random() * cw, y: ch * 0.55 + Math.random() * ch * 0.45,
      vx: (Math.random() - 0.5) * 0.2, vy: -0.05 - Math.random() * 0.15,
      r: 20 + Math.random() * 50, alpha: 0.03 + Math.random() * 0.06,
    });
  }
}

function drawTropicalBird(ctx: CanvasRenderingContext2D, bird: TropicalBird, t: number) {
  const wingBeat = Math.sin(t * 5 + bird.phase);
  ctx.save(); ctx.translate(bird.x, bird.y); ctx.globalAlpha = 0.85;
  const s = bird.size;
  ctx.fillStyle = `hsl(${bird.hue},90%,45%)`;
  ctx.beginPath(); ctx.ellipse(0, 0, s * 0.6, s * 0.25, -0.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-s * 0.5, 0); ctx.lineTo(-s * 1.1, s * 0.15); ctx.lineTo(-s * 0.9, -s * 0.05);
  ctx.fillStyle = `hsl(${bird.hue + 20},80%,35%)`; ctx.fill();
  ctx.fillStyle = `hsl(${bird.hue + 10},85%,50%)`;
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.bezierCurveTo(s * 0.3, -s * (0.4 + wingBeat * 0.4), s * 0.9, -s * (0.3 + wingBeat * 0.5), s * 0.8, s * 0.1);
  ctx.bezierCurveTo(s * 0.5, s * 0.2, s * 0.2, s * 0.1, 0, 0); ctx.fill();
  ctx.fillStyle = `hsl(${bird.hue - 10},95%,40%)`;
  ctx.beginPath(); ctx.arc(s * 0.55, -s * 0.05, s * 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,200,50,0.9)";
  ctx.beginPath(); ctx.moveTo(s * 0.75, -s * 0.05); ctx.lineTo(s * 1.05, -s * 0.08); ctx.lineTo(s * 0.75, s * 0.05); ctx.fill();
  ctx.restore();
}

function paintNature(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  if (!natureInit) { initNature(w, h); natureInit = true; }
  ctx.clearRect(0, 0, w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#020c04"); sky.addColorStop(0.3, "#041508");
  sky.addColorStop(0.6, "#071e0a"); sky.addColorStop(1, "#030d05");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  // Light shafts
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 6; i++) {
    const sx = w * 0.1 + (i / 6) * w * 0.8;
    const sway = Math.sin(t * 0.08 + i * 1.2) * 20;
    const alpha = 0.04 + 0.02 * Math.sin(t * 0.15 + i * 0.7);
    const sg = ctx.createLinearGradient(sx + sway, 0, sx + sway + 30, h * 0.85);
    sg.addColorStop(0, `rgba(180,255,120,${alpha * 1.5})`);
    sg.addColorStop(0.4, `rgba(140,220,80,${alpha})`);
    sg.addColorStop(1, "transparent");
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.moveTo(sx + sway - 15, 0); ctx.lineTo(sx + sway + 15, 0);
    ctx.lineTo(sx + sway + 80, h * 0.85); ctx.lineTo(sx + sway - 50, h * 0.85); ctx.closePath(); ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  // Canyon walls
  ctx.fillStyle = "rgba(5,20,8,0.7)";
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, h); ctx.lineTo(w * 0.22, h);
  ctx.lineTo(w * 0.18, h * 0.7); ctx.lineTo(w * 0.25, h * 0.5); ctx.lineTo(w * 0.15, h * 0.3);
  ctx.lineTo(w * 0.20, h * 0.1); ctx.lineTo(w * 0.10, 0); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(w, 0); ctx.lineTo(w, h); ctx.lineTo(w * 0.78, h);
  ctx.lineTo(w * 0.82, h * 0.7); ctx.lineTo(w * 0.75, h * 0.5); ctx.lineTo(w * 0.85, h * 0.3);
  ctx.lineTo(w * 0.80, h * 0.1); ctx.lineTo(w * 0.90, 0); ctx.closePath(); ctx.fill();
  // Rope bridge
  const bY = h * 0.62, bL = w * 0.18, bR = w * 0.82, bSag = h * 0.06;
  for (let r = 0; r < 2; r++) {
    ctx.strokeStyle = "rgba(60,40,20,0.8)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bL, bY + r * 12);
    ctx.quadraticCurveTo(w * 0.5, bY + r * 12 + bSag, bR, bY + r * 12); ctx.stroke();
  }
  const plankCount = 22;
  for (let i = 0; i <= plankCount; i++) {
    const px = bL + (i / plankCount) * (bR - bL);
    const sagOff = bSag * Math.sin((i / plankCount) * Math.PI);
    ctx.strokeStyle = "rgba(50,30,15,0.7)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(px, bY + sagOff); ctx.lineTo(px, bY + sagOff + 14); ctx.stroke();
  }
  ctx.fillStyle = "rgba(40,25,10,0.6)";
  for (let i = 0; i < plankCount; i++) {
    const px = bL + (i / plankCount) * (bR - bL);
    const sagOff = bSag * Math.sin(((i + 0.5) / plankCount) * Math.PI);
    ctx.fillRect(px + 1, bY + sagOff + 8, (bR - bL) / plankCount - 2, 6);
  }
  // Waterfall
  ctx.globalCompositeOperation = "screen";
  const wfX = w * 0.15, wfW = 18;
  const wfG = ctx.createLinearGradient(wfX, h * 0.2, wfX, h * 0.75);
  wfG.addColorStop(0, "rgba(150,220,255,0.25)"); wfG.addColorStop(0.7, "rgba(100,180,220,0.15)"); wfG.addColorStop(1, "rgba(80,160,200,0.05)");
  ctx.fillStyle = wfG; ctx.fillRect(wfX - wfW / 2, h * 0.2, wfW, h * 0.55);
  for (let i = 0; i < 5; i++) {
    const shimX = wfX + Math.sin(t * 2 + i * 1.3) * wfW * 0.3;
    const shimY = h * 0.2 + ((t * 80 + i * 50) % (h * 0.55));
    ctx.fillStyle = "rgba(200,240,255,0.12)";
    ctx.beginPath(); ctx.ellipse(shimX, shimY, 2, 8, 0, 0, Math.PI * 2); ctx.fill();
  }
  const mistPool = ctx.createRadialGradient(wfX, h * 0.76, 0, wfX, h * 0.76, 60);
  mistPool.addColorStop(0, "rgba(180,230,255,0.15)"); mistPool.addColorStop(1, "transparent");
  ctx.fillStyle = mistPool; ctx.beginPath(); ctx.ellipse(wfX, h * 0.76, 60, 20, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  // Foliage
  const drawLeafCluster = (cx: number, cy: number, radius: number, hue: number, alpha: number) => {
    ctx.fillStyle = `hsla(${hue},65%,18%,${alpha})`;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2;
      const r = radius * (0.7 + 0.3 * (i % 3) * 0.15);
      const lx = cx + Math.cos(angle) * r, ly = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
    }
    ctx.closePath(); ctx.fill();
  };
  for (let i = 0; i < 20; i++) {
    drawLeafCluster((i / 20) * w * 1.1 - w * 0.05, h * 0.82 + Math.sin(i * 1.7) * h * 0.06, 60 + Math.sin(i * 2.3) * 25, 110 + i * 3, 0.7);
  }
  for (let i = 0; i < 8; i++) {
    drawLeafCluster(w * 0.05 + i * 15, h * 0.4 + i * 20, 40, 120, 0.5);
    drawLeafCluster(w * 0.95 - i * 15, h * 0.4 + i * 20, 40, 115, 0.5);
  }
  // Mist
  for (const mp of mistParticles) {
    mp.x += mp.vx + Math.sin(t * 0.1 + mp.y * 0.01) * 0.1; mp.y += mp.vy;
    if (mp.y < h * 0.4) { mp.y = h * 0.95; mp.x = Math.random() * w; }
    const mg = ctx.createRadialGradient(mp.x, mp.y, 0, mp.x, mp.y, mp.r);
    mg.addColorStop(0, `rgba(180,230,200,${mp.alpha})`); mg.addColorStop(1, "transparent");
    ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mp.x, mp.y, mp.r, 0, Math.PI * 2); ctx.fill();
  }
  // Birds
  for (const bird of tropicalBirds) {
    bird.x += bird.vx; bird.y += bird.vy + Math.sin(t * 0.3 + bird.phase) * 0.15;
    if (bird.x > w + 100) { bird.x = -100; bird.y = h * 0.08 + Math.random() * h * 0.35; }
    drawTropicalBird(ctx, bird, t);
  }
  // Bioluminescent glow
  ctx.globalCompositeOperation = "screen";
  for (const gx of [0.12, 0.28, 0.45, 0.62, 0.78, 0.91]) {
    const pulse = 0.6 + 0.4 * Math.sin(t * 0.8 + gx * 15);
    const gg = ctx.createRadialGradient(gx * w, h * 0.9, 0, gx * w, h * 0.9, 35);
    gg.addColorStop(0, `rgba(80,255,120,${0.15 * pulse})`); gg.addColorStop(1, "transparent");
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(gx * w, h * 0.9, 35, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── CYBERPUNK — Neon Rain City ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
interface CyberRain { x: number; y: number; speed: number; len: number; alpha: number; hue: number }
interface NeonSign { x: number; y: number; sw: number; sh: number; hue: number; label: string; flicker: number }
interface FlyingCar { x: number; y: number; vx: number; vy: number; size: number; hue: number }
interface PuddleRipple { x: number; y: number; r: number; maxR: number; alpha: number }
const cyberRain: CyberRain[] = [];
const neonSigns: NeonSign[] = [];
const flyingCars: FlyingCar[] = [];
const puddleRipples: PuddleRipple[] = [];
let cyberInit = false;
const NEON_LABELS = ["RAMEN", "BAR", "NET", "CYBER", "HOTEL", "SHOP", "CLUB", "NOODLE", "VR", "DATA"];

function initCyber(cw: number, ch: number) {
  cyberRain.length = 0; neonSigns.length = 0; flyingCars.length = 0; puddleRipples.length = 0;
  for (let i = 0; i < 160; i++) {
    cyberRain.push({ x: Math.random() * cw, y: Math.random() * ch, speed: 5 + Math.random() * 10, len: 8 + Math.random() * 25, alpha: 0.08 + Math.random() * 0.25, hue: Math.random() > 0.3 ? 185 : 300 });
  }
  for (let i = 0; i < 12; i++) {
    neonSigns.push({ x: (i / 12) * cw * 1.1 - cw * 0.05 + Math.random() * 40, y: ch * 0.25 + Math.random() * ch * 0.35, sw: 40 + Math.random() * 60, sh: 16 + Math.random() * 20, hue: [185, 300, 60, 120][Math.floor(Math.random() * 4)], label: NEON_LABELS[Math.floor(Math.random() * NEON_LABELS.length)], flicker: Math.random() * Math.PI * 2 });
  }
  for (let i = 0; i < 5; i++) {
    flyingCars.push({ x: -200 - Math.random() * cw, y: ch * 0.15 + Math.random() * ch * 0.3, vx: 1.2 + Math.random() * 1.8, vy: (Math.random() - 0.5) * 0.2, size: 18 + Math.random() * 12, hue: [185, 300, 60][Math.floor(Math.random() * 3)] });
  }
  for (let i = 0; i < 30; i++) {
    puddleRipples.push({ x: Math.random() * cw, y: ch * 0.6 + Math.random() * ch * 0.4, r: Math.random() * 20, maxR: 20 + Math.random() * 30, alpha: Math.random() * 0.3 });
  }
}

function paintCyberpunk(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  if (!cyberInit) { initCyber(w, h); cyberInit = true; }
  ctx.clearRect(0, 0, w, h);
  // Night sky
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
  sky.addColorStop(0, "#020308"); sky.addColorStop(0.5, "#05080f"); sky.addColorStop(1, "#080c18");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * 0.55);
  // Smog glow
  ctx.globalCompositeOperation = "screen";
  const smog1 = ctx.createRadialGradient(w * 0.3, h * 0.5, 0, w * 0.3, h * 0.5, w * 0.4);
  smog1.addColorStop(0, "rgba(0,200,255,0.04)"); smog1.addColorStop(1, "transparent");
  ctx.fillStyle = smog1; ctx.fillRect(0, 0, w, h);
  const smog2 = ctx.createRadialGradient(w * 0.7, h * 0.45, 0, w * 0.7, h * 0.45, w * 0.35);
  smog2.addColorStop(0, "rgba(200,0,255,0.04)"); smog2.addColorStop(1, "transparent");
  ctx.fillStyle = smog2; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  // City buildings
  const horizonY = h * 0.55;
  ctx.fillStyle = "rgba(5,8,15,0.9)";
  const bgBuildings = [
    [0.0,0.08,0.45],[0.07,0.06,0.38],[0.12,0.09,0.52],[0.20,0.07,0.35],[0.26,0.10,0.48],
    [0.35,0.06,0.42],[0.40,0.08,0.55],[0.47,0.07,0.40],[0.53,0.09,0.50],[0.61,0.06,0.38],
    [0.66,0.10,0.46],[0.75,0.07,0.53],[0.81,0.08,0.44],[0.88,0.06,0.36],[0.93,0.09,0.49],
  ];
  for (const [bx, bw, bh] of bgBuildings) {
    const px = bx * w, ph = bh * horizonY, py = horizonY - ph;
    ctx.fillRect(px, py, bw * w, ph);
    const cols = Math.floor(bw * w / 8), rows = Math.floor(ph / 10);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = px + c * 8 + 2, wy = py + r * 10 + 2;
        if (Math.sin(wx * 0.3 + wy * 0.2 + t * 0.1) > 0.3) {
          ctx.fillStyle = `hsla(${Math.sin(wx + wy) > 0 ? 185 : 300},80%,60%,0.12)`;
          ctx.fillRect(wx, wy, 4, 5);
        }
      }
    }
    ctx.fillStyle = "rgba(5,8,15,0.9)";
  }
  // Street
  const streetGrd = ctx.createLinearGradient(0, horizonY, 0, h);
  streetGrd.addColorStop(0, "rgba(8,12,20,0.95)"); streetGrd.addColorStop(1, "rgba(5,8,15,0.98)");
  ctx.fillStyle = streetGrd; ctx.fillRect(0, horizonY, w, h - horizonY);
  // Neon reflections
  ctx.globalCompositeOperation = "screen";
  for (const [rx, hue, alpha] of [[0.2, 185, 0.06],[0.5, 300, 0.08],[0.75, 60, 0.05]] as [number,number,number][]) {
    const rxx = rx * w + Math.sin(t * 0.3 + rx * 5) * 20;
    const rg = ctx.createRadialGradient(rxx, h * 0.75, 0, rxx, h * 0.75, 80);
    rg.addColorStop(0, `hsla(${hue},90%,60%,${alpha})`); rg.addColorStop(1, "transparent");
    ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(rxx, h * 0.75, 80, 25, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  // Puddle ripples
  for (const rip of puddleRipples) {
    rip.r += 0.8; rip.alpha -= 0.012;
    if (rip.alpha <= 0) { rip.r = 0; rip.alpha = 0.25 + Math.random() * 0.2; rip.x = Math.random() * w; rip.y = horizonY + Math.random() * (h - horizonY); }
    ctx.strokeStyle = `rgba(0,200,255,${rip.alpha * 0.4})`; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.ellipse(rip.x, rip.y, rip.r, rip.r * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
  }
  // Neon signs
  for (const sign of neonSigns) {
    const flicker = Math.sin(t * 8 + sign.flicker) > -0.85;
    if (!flicker) continue;
    const intensity = 0.7 + 0.3 * Math.sin(t * 3 + sign.flicker);
    ctx.globalCompositeOperation = "screen";
    const sg = ctx.createRadialGradient(sign.x + sign.sw / 2, sign.y + sign.sh / 2, 0, sign.x + sign.sw / 2, sign.y + sign.sh / 2, sign.sw * 0.8);
    sg.addColorStop(0, `hsla(${sign.hue},100%,70%,${0.15 * intensity})`); sg.addColorStop(1, "transparent");
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sign.x + sign.sw / 2, sign.y + sign.sh / 2, sign.sw * 0.8, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = `hsla(${sign.hue},100%,65%,${0.6 * intensity})`; ctx.lineWidth = 1.5;
    ctx.strokeRect(sign.x, sign.y, sign.sw, sign.sh);
    ctx.fillStyle = `hsla(${sign.hue},100%,75%,${0.8 * intensity})`;
    ctx.font = `bold ${sign.sh * 0.55}px monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(sign.label, sign.x + sign.sw / 2, sign.y + sign.sh / 2);
  }
  // Rain
  for (const r of cyberRain) {
    r.y += r.speed;
    if (r.y > h) { r.y = -r.len; r.x = Math.random() * w; }
    ctx.strokeStyle = `hsla(${r.hue},80%,70%,${r.alpha})`; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x - 0.5, r.y + r.len); ctx.stroke();
  }
  // Flying cars
  for (const car of flyingCars) {
    car.x += car.vx; car.y += car.vy + Math.sin(t * 0.4 + car.x * 0.01) * 0.1;
    if (car.x > w + 200) { car.x = -200; car.y = h * 0.15 + Math.random() * h * 0.3; }
    ctx.fillStyle = "rgba(10,15,25,0.9)";
    ctx.beginPath(); ctx.roundRect(car.x - car.size, car.y - car.size * 0.3, car.size * 2, car.size * 0.6, 3); ctx.fill();
    const hlGrd = ctx.createRadialGradient(car.x + car.size + 30, car.y, 0, car.x + car.size + 30, car.y, 40);
    hlGrd.addColorStop(0, `hsla(${car.hue},100%,80%,0.6)`); hlGrd.addColorStop(1, "transparent");
    ctx.fillStyle = hlGrd; ctx.beginPath(); ctx.arc(car.x + car.size + 30, car.y, 40, 0, Math.PI * 2); ctx.fill();
  }
  // Scanlines
  for (let y = 0; y < h; y += 4) { ctx.fillStyle = "rgba(0,0,0,0.025)"; ctx.fillRect(0, y, w, 1); }
  if (Math.sin(t * 7.3) > 0.97) { ctx.fillStyle = "rgba(0,200,255,0.012)"; ctx.fillRect(0, 0, w, h); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── FINAL FANTASY — Crystal World ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
interface FFChar { x: number; y: number; vx: number; frame: number; type: string; size: number; alpha: number }
interface FFCrystal { x: number; y: number; h: number; hue: number; pulse: number }
interface SummonCircle { x: number; y: number; r: number; alpha: number; hue: number; active: boolean; timer: number }
interface MagicParticle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; hue: number; size: number }
const ffChars: FFChar[] = [];
const ffCrystals: FFCrystal[] = [];
const summonCircles: SummonCircle[] = [];
const magicParticles: MagicParticle[] = [];
let ffInit = false;

function initFF(cw: number, ch: number) {
  ffChars.length = 0; ffCrystals.length = 0; summonCircles.length = 0; magicParticles.length = 0;
  const types = ["cloud", "vivi", "tifa", "moogle", "chocobo", "bahamut"];
  for (let i = 0; i < 6; i++) {
    ffChars.push({ x: -100 - i * 180, y: ch * 0.72 + Math.random() * ch * 0.08, vx: 0.5 + Math.random() * 0.4, frame: Math.random() * 100, type: types[i], size: 28 + Math.random() * 12, alpha: 0.75 + Math.random() * 0.2 });
  }
  for (let i = 0; i < 8; i++) {
    ffCrystals.push({ x: (i / 8) * cw + Math.random() * (cw / 8), y: ch * 0.5 + Math.random() * ch * 0.2, h: 60 + Math.random() * 120, hue: 180 + i * 25, pulse: Math.random() * Math.PI * 2 });
  }
  for (let i = 0; i < 3; i++) {
    summonCircles.push({ x: cw * (0.25 + i * 0.25), y: ch * 0.45, r: 0, alpha: 0, hue: [60, 200, 300][i], active: false, timer: i * 200 });
  }
}

function drawFFChar(ctx: CanvasRenderingContext2D, char: FFChar, t: number) {
  const walk = Math.sin(t * 4 + char.frame) * 0.15;
  ctx.save(); ctx.translate(char.x, char.y); ctx.globalAlpha = char.alpha;
  const s = char.size;
  if (char.type === "cloud") {
    ctx.fillStyle = "rgba(20,30,60,0.9)";
    ctx.beginPath(); ctx.ellipse(0, -s * 0.5, s * 0.22, s * 0.35, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-s*0.12,-s*0.15); ctx.lineTo(-s*0.18,s*0.3+walk*s*0.2); ctx.lineTo(-s*0.08,s*0.3+walk*s*0.2); ctx.lineTo(-s*0.02,-s*0.15); ctx.fill();
    ctx.beginPath(); ctx.moveTo(s*0.02,-s*0.15); ctx.lineTo(s*0.08,s*0.3-walk*s*0.2); ctx.lineTo(s*0.18,s*0.3-walk*s*0.2); ctx.lineTo(s*0.12,-s*0.15); ctx.fill();
    ctx.beginPath(); ctx.arc(0,-s*0.9,s*0.2,0,Math.PI*2); ctx.fill();
    for (let i=0;i<5;i++){const a=-Math.PI*0.7+(i/4)*Math.PI*0.5;ctx.beginPath();ctx.moveTo(0,-s*0.9);ctx.lineTo(Math.cos(a)*s*0.35,-s*0.9+Math.sin(a)*s*0.35);ctx.lineTo(Math.cos(a+0.2)*s*0.15,-s*0.9+Math.sin(a+0.2)*s*0.15);ctx.closePath();ctx.fill();}
    ctx.strokeStyle="rgba(150,180,220,0.7)";ctx.lineWidth=s*0.08;ctx.beginPath();ctx.moveTo(s*0.2,-s*0.7);ctx.lineTo(s*0.8,-s*0.1);ctx.stroke();
  } else if (char.type === "vivi") {
    ctx.fillStyle = "rgba(15,10,30,0.95)";
    ctx.beginPath(); ctx.ellipse(0,-s*0.3,s*0.25,s*0.3,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-s*0.1,0); ctx.lineTo(-s*0.15,s*0.35+walk*s*0.15); ctx.lineTo(-s*0.05,s*0.35+walk*s*0.15); ctx.fill();
    ctx.beginPath(); ctx.moveTo(s*0.05,0); ctx.lineTo(s*0.1,s*0.35-walk*s*0.15); ctx.lineTo(s*0.2,s*0.35-walk*s*0.15); ctx.fill();
    ctx.beginPath(); ctx.arc(0,-s*0.7,s*0.22,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-s*0.3,-s*0.7); ctx.lineTo(0,-s*1.4); ctx.lineTo(s*0.3,-s*0.7); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0,-s*0.7,s*0.35,s*0.08,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle="rgba(255,220,0,0.9)";
    ctx.beginPath(); ctx.arc(-s*0.08,-s*0.72,s*0.05,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(s*0.08,-s*0.72,s*0.05,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle="rgba(180,140,80,0.8)";ctx.lineWidth=s*0.05;ctx.beginPath();ctx.moveTo(s*0.22,-s*0.5);ctx.lineTo(s*0.35,s*0.4);ctx.stroke();
    ctx.fillStyle="rgba(100,200,255,0.7)";ctx.beginPath();ctx.arc(s*0.22,-s*0.55,s*0.08,0,Math.PI*2);ctx.fill();
  } else if (char.type === "tifa") {
    ctx.fillStyle = "rgba(30,10,20,0.9)";
    ctx.beginPath(); ctx.ellipse(0,-s*0.5,s*0.2,s*0.38,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-s*0.1,-s*0.12); ctx.lineTo(-s*0.16,s*0.32+walk*s*0.2); ctx.lineTo(-s*0.06,s*0.32+walk*s*0.2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(s*0.06,-s*0.12); ctx.lineTo(s*0.1,s*0.32-walk*s*0.2); ctx.lineTo(s*0.2,s*0.32-walk*s*0.2); ctx.fill();
    ctx.beginPath(); ctx.arc(0,-s*0.88,s*0.18,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-s*0.12,-s*0.75); ctx.bezierCurveTo(-s*0.35,-s*0.4,-s*0.3,0,-s*0.2,s*0.1);
    ctx.lineWidth=s*0.1; ctx.strokeStyle="rgba(30,10,20,0.9)"; ctx.stroke();
    ctx.fillStyle="rgba(200,80,80,0.5)";ctx.beginPath();ctx.arc(-s*0.28,-s*0.4+walk*s*0.1,s*0.07,0,Math.PI*2);ctx.fill();
  } else if (char.type === "moogle") {
    ctx.fillStyle = "rgba(200,180,200,0.85)";
    ctx.beginPath(); ctx.arc(0,-s*0.3,s*0.28,0,Math.PI*2); ctx.fill();
    ctx.fillStyle="rgba(180,160,180,0.85)";ctx.beginPath();ctx.ellipse(0,s*0.05,s*0.18,s*0.22,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="rgba(180,140,160,0.9)";
    ctx.beginPath();ctx.arc(-s*0.22,-s*0.52,s*0.1,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(s*0.22,-s*0.52,s*0.1,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="rgba(160,120,140,0.8)";ctx.lineWidth=s*0.04;ctx.beginPath();ctx.moveTo(0,-s*0.58);ctx.lineTo(s*0.08,-s*0.85);ctx.stroke();
    ctx.fillStyle="rgba(255,80,80,0.9)";ctx.beginPath();ctx.arc(s*0.08,-s*0.9,s*0.1,0,Math.PI*2);ctx.fill();
    const wFlap=Math.sin(t*6+char.frame)*0.3;
    ctx.fillStyle="rgba(220,200,220,0.6)";
    ctx.beginPath();ctx.moveTo(0,-s*0.2);ctx.bezierCurveTo(-s*0.4,-s*0.2-wFlap*s*0.3,-s*0.6,-s*0.1,-s*0.5,s*0.1);ctx.bezierCurveTo(-s*0.3,s*0.15,-s*0.1,s*0.05,0,-s*0.2);ctx.fill();
    ctx.beginPath();ctx.moveTo(0,-s*0.2);ctx.bezierCurveTo(s*0.4,-s*0.2-wFlap*s*0.3,s*0.6,-s*0.1,s*0.5,s*0.1);ctx.bezierCurveTo(s*0.3,s*0.15,s*0.1,s*0.05,0,-s*0.2);ctx.fill();
    ctx.fillStyle="rgba(180,140,140,0.8)";
    ctx.beginPath();ctx.ellipse(-s*0.08,s*0.28+walk*s*0.1,s*0.09,s*0.05,0,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.ellipse(s*0.08,s*0.28-walk*s*0.1,s*0.09,s*0.05,0,0,Math.PI*2);ctx.fill();
  } else if (char.type === "chocobo") {
    ctx.fillStyle="rgba(200,170,20,0.85)";
    ctx.beginPath();ctx.ellipse(0,-s*0.3,s*0.3,s*0.38,-0.2,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.moveTo(s*0.15,-s*0.65);ctx.bezierCurveTo(s*0.2,-s*0.9,s*0.3,-s*1.0,s*0.25,-s*1.1);ctx.bezierCurveTo(s*0.15,-s*1.05,s*0.05,-s*0.95,0,-s*0.7);ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.arc(s*0.22,-s*1.15,s*0.18,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="rgba(220,140,20,0.9)";ctx.beginPath();ctx.moveTo(s*0.38,-s*1.15);ctx.lineTo(s*0.6,-s*1.1);ctx.lineTo(s*0.38,-s*1.05);ctx.fill();
    ctx.fillStyle="rgba(20,20,20,0.9)";ctx.beginPath();ctx.arc(s*0.3,-s*1.18,s*0.04,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="rgba(180,150,20,0.8)";ctx.lineWidth=s*0.07;
    ctx.beginPath();ctx.moveTo(-s*0.1,s*0.08);ctx.lineTo(-s*0.15,s*0.45+walk*s*0.2);ctx.stroke();
    ctx.beginPath();ctx.moveTo(s*0.1,s*0.08);ctx.lineTo(s*0.05,s*0.45-walk*s*0.2);ctx.stroke();
    ctx.fillStyle="rgba(180,150,15,0.7)";ctx.beginPath();ctx.moveTo(-s*0.28,-s*0.1);ctx.bezierCurveTo(-s*0.5,-s*0.2,-s*0.6,0,-s*0.55,s*0.15);ctx.bezierCurveTo(-s*0.4,s*0.1,-s*0.3,s*0.05,-s*0.28,-s*0.1);ctx.fill();
  } else if (char.type === "bahamut") {
    // Bahamut wing shadow overhead
    ctx.fillStyle="rgba(10,5,30,0.7)";
    ctx.beginPath();ctx.ellipse(0,0,s*2.5,s*0.6,0,0,Math.PI*2);ctx.fill();
    const wFlap=Math.sin(t*1.5+char.frame)*0.4;
    ctx.beginPath();ctx.moveTo(-s*0.5,0);ctx.bezierCurveTo(-s*1.5,-s*(0.8+wFlap),-s*2.8,-s*(0.5+wFlap*0.5),-s*3.0,s*0.3);ctx.bezierCurveTo(-s*2.0,s*0.4,-s*1.0,s*0.3,-s*0.5,0);ctx.fill();
    ctx.beginPath();ctx.moveTo(s*0.5,0);ctx.bezierCurveTo(s*1.5,-s*(0.8+wFlap),s*2.8,-s*(0.5+wFlap*0.5),s*3.0,s*0.3);ctx.bezierCurveTo(s*2.0,s*0.4,s*1.0,s*0.3,s*0.5,0);ctx.fill();
  }
  ctx.restore();
}

function paintFinalFantasy(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  if (!ffInit) { initFF(w, h); ffInit = true; }
  ctx.clearRect(0, 0, w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0,"#040210");sky.addColorStop(0.3,"#080420");sky.addColorStop(0.6,"#0c0630");sky.addColorStop(1,"#060220");
  ctx.fillStyle=sky;ctx.fillRect(0,0,w,h);
  // Stars
  for(let i=0;i<200;i++){const sx=((i*137.508+50)%w),sy=((i*97.3+20)%(h*0.8));const alpha=0.3+0.5*Math.abs(Math.sin(t*0.5+i*0.4));ctx.beginPath();ctx.arc(sx,sy,i%7===0?1.5:0.6,0,Math.PI*2);ctx.fillStyle=`rgba(200,180,255,${alpha})`;ctx.fill();}
  // Crystals
  for(const cr of ffCrystals){
    const pulse=0.5+0.5*Math.sin(t*0.8+cr.pulse);
    ctx.fillStyle=`hsla(${cr.hue},70%,25%,0.6)`;
    ctx.beginPath();ctx.moveTo(cr.x-15,cr.y);ctx.lineTo(cr.x-10,cr.y-cr.h);ctx.lineTo(cr.x,cr.y-cr.h-20);ctx.lineTo(cr.x+10,cr.y-cr.h);ctx.lineTo(cr.x+15,cr.y);ctx.closePath();ctx.fill();
    ctx.globalCompositeOperation="screen";
    const cg=ctx.createRadialGradient(cr.x,cr.y-cr.h*0.5,0,cr.x,cr.y-cr.h*0.5,40);
    cg.addColorStop(0,`hsla(${cr.hue},90%,70%,${0.12*pulse})`);cg.addColorStop(1,"transparent");
    ctx.fillStyle=cg;ctx.beginPath();ctx.arc(cr.x,cr.y-cr.h*0.5,40,0,Math.PI*2);ctx.fill();
    ctx.globalCompositeOperation="source-over";
  }
  // Summon circles
  for(const sc of summonCircles){
    sc.timer++;
    if(!sc.active&&sc.timer>300){sc.active=true;sc.r=0;sc.alpha=0.8;sc.timer=0;}
    if(sc.active){
      sc.r+=1.5;sc.alpha-=0.004;
      if(sc.alpha<=0){sc.active=false;sc.timer=0;}
      ctx.globalCompositeOperation="screen";
      ctx.strokeStyle=`hsla(${sc.hue},100%,70%,${sc.alpha*0.6})`;ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(sc.x,sc.y,sc.r,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.arc(sc.x,sc.y,sc.r*0.6,0,Math.PI*2);ctx.stroke();
      for(let i=0;i<8;i++){const a=(i/8)*Math.PI*2+t*1.5;ctx.fillStyle=`hsla(${sc.hue},100%,80%,${sc.alpha*0.8})`;ctx.beginPath();ctx.arc(sc.x+Math.cos(a)*sc.r,sc.y+Math.sin(a)*sc.r,3,0,Math.PI*2);ctx.fill();}
      for(let i=0;i<6;i++){const a=(i/6)*Math.PI*2+t*0.5;ctx.beginPath();ctx.moveTo(sc.x,sc.y);ctx.lineTo(sc.x+Math.cos(a)*sc.r,sc.y+Math.sin(a)*sc.r);ctx.strokeStyle=`hsla(${sc.hue},100%,70%,${sc.alpha*0.3})`;ctx.stroke();}
      ctx.globalCompositeOperation="source-over";
      if(sc.alpha>0.3&&Math.random()<0.3){const a=Math.random()*Math.PI*2;magicParticles.push({x:sc.x+Math.cos(a)*sc.r,y:sc.y+Math.sin(a)*sc.r,vx:(Math.random()-0.5)*2,vy:-1-Math.random()*2,life:60,maxLife:60,hue:sc.hue,size:2+Math.random()*3});}
    }
  }
  // Magic particles
  ctx.globalCompositeOperation="screen";
  for(let i=magicParticles.length-1;i>=0;i--){const mp=magicParticles[i];mp.x+=mp.vx;mp.y+=mp.vy;mp.vy-=0.02;mp.life--;if(mp.life<=0){magicParticles.splice(i,1);continue;}const alpha=mp.life/mp.maxLife;ctx.fillStyle=`hsla(${mp.hue},100%,75%,${alpha*0.8})`;ctx.beginPath();ctx.arc(mp.x,mp.y,mp.size*alpha,0,Math.PI*2);ctx.fill();}
  ctx.globalCompositeOperation="source-over";
  // Ground
  const ground=ctx.createLinearGradient(0,h*0.7,0,h);ground.addColorStop(0,"rgba(10,5,30,0.8)");ground.addColorStop(1,"rgba(5,2,20,0.95)");ctx.fillStyle=ground;ctx.fillRect(0,h*0.7,w,h*0.3);
  // Characters
  for(const char of ffChars){char.x+=char.vx;char.frame+=0.05;if(char.x>w+200){char.x=-200;char.y=h*0.72+Math.random()*h*0.08;}drawFFChar(ctx,char,t);}
  // Atmospheric glow
  ctx.globalCompositeOperation="screen";
  const atmo=ctx.createRadialGradient(w*0.5,h*0.4,0,w*0.5,h*0.4,w*0.5);atmo.addColorStop(0,"rgba(100,50,200,0.04)");atmo.addColorStop(1,"transparent");ctx.fillStyle=atmo;ctx.fillRect(0,0,w,h);
  ctx.globalCompositeOperation="source-over";
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── MONSTERS INC — Parade ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
interface MonsterChar { x: number; y: number; vx: number; frame: number; type: string; size: number }
interface BalloonHouse { x: number; y: number; vy: number; balloonPhase: number }
const monsterChars: MonsterChar[] = [];
const balloonHouses: BalloonHouse[] = [];
let monstersInit = false;

function initMonsters(cw: number, ch: number) {
  monsterChars.length = 0; balloonHouses.length = 0;
  const types = ["sulley","mike","boo","bird","grandpa","sulley","mike","boo","randall","cda"];
  for(let i=0;i<types.length;i++){monsterChars.push({x:-120-i*140,y:ch*0.68+Math.random()*ch*0.06,vx:0.7+Math.random()*0.5,frame:Math.random()*100,type:types[i],size:30+Math.random()*15});}
  for(let i=0;i<2;i++){balloonHouses.push({x:cw*(0.25+i*0.5),y:ch*0.5+i*50,vy:-0.15-Math.random()*0.1,balloonPhase:Math.random()*Math.PI*2});}
}

function drawMonsterChar(ctx: CanvasRenderingContext2D, char: MonsterChar, t: number) {
  const walk=Math.sin(t*4+char.frame)*0.2;
  ctx.save();ctx.translate(char.x,char.y);
  const s=char.size;
  if(char.type==="sulley"){
    ctx.fillStyle="rgba(40,80,160,0.85)";
    ctx.beginPath();ctx.ellipse(0,-s*0.4,s*0.45,s*0.55,0,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(0,-s*1.05,s*0.38,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="rgba(30,60,130,0.9)";
    ctx.beginPath();ctx.moveTo(-s*0.2,-s*1.35);ctx.lineTo(-s*0.28,-s*1.65);ctx.lineTo(-s*0.08,-s*1.35);ctx.fill();
    ctx.beginPath();ctx.moveTo(s*0.2,-s*1.35);ctx.lineTo(s*0.28,-s*1.65);ctx.lineTo(s*0.08,-s*1.35);ctx.fill();
    ctx.fillStyle="rgba(120,40,160,0.5)";
    ctx.beginPath();ctx.arc(-s*0.2,-s*0.5,s*0.08,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(s*0.15,-s*0.3,s*0.06,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="rgba(240,220,60,0.9)";
    ctx.beginPath();ctx.arc(-s*0.12,-s*1.08,s*0.1,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(s*0.12,-s*1.08,s*0.1,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="rgba(20,20,20,0.9)";
    ctx.beginPath();ctx.arc(-s*0.12,-s*1.08,s*0.05,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(s*0.12,-s*1.08,s*0.05,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="rgba(40,80,160,0.85)";
    ctx.beginPath();ctx.moveTo(-s*0.4,-s*0.7);ctx.bezierCurveTo(-s*0.7,-s*0.5+walk*s*0.2,-s*0.75,-s*0.1,-s*0.6,s*0.1);ctx.bezierCurveTo(-s*0.45,s*0.15,-s*0.35,-s*0.1,-s*0.4,-s*0.7);ctx.fill();
    ctx.beginPath();ctx.moveTo(s*0.4,-s*0.7);ctx.bezierCurveTo(s*0.7,-s*0.5-walk*s*0.2,s*0.75,-s*0.1,s*0.6,s*0.1);ctx.bezierCurveTo(s*0.45,s*0.15,s*0.35,-s*0.1,s*0.4,-s*0.7);ctx.fill();
    ctx.beginPath();ctx.moveTo(-s*0.2,s*0.12);ctx.lineTo(-s*0.28,s*0.5+walk*s*0.2);ctx.lineTo(-s*0.1,s*0.5+walk*s*0.2);ctx.fill();
    ctx.beginPath();ctx.moveTo(s*0.2,s*0.12);ctx.lineTo(s*0.1,s*0.5-walk*s*0.2);ctx.lineTo(s*0.28,s*0.5-walk*s*0.2);ctx.fill();
  } else if(char.type==="mike"){
    ctx.fillStyle="rgba(60,160,60,0.85)";
    ctx.beginPath();ctx.arc(0,-s*0.35,s*0.42,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="rgba(240,240,240,0.95)";ctx.beginPath();ctx.arc(s*0.05,-s*0.38,s*0.28,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="rgba(60,120,200,0.9)";ctx.beginPath();ctx.arc(s*0.05,-s*0.38,s*0.18,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="rgba(10,10,10,0.95)";ctx.beginPath();ctx.arc(s*0.05,-s*0.38,s*0.1,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="rgba(255,255,255,0.8)";ctx.beginPath();ctx.arc(s*0.12,-s*0.46,s*0.04,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="rgba(40,130,40,0.9)";
    ctx.beginPath();ctx.moveTo(-s*0.15,-s*0.72);ctx.lineTo(-s*0.2,-s*0.95);ctx.lineTo(-s*0.05,-s*0.72);ctx.fill();
    ctx.beginPath();ctx.moveTo(s*0.25,-s*0.72);ctx.lineTo(s*0.32,-s*0.95);ctx.lineTo(s*0.15,-s*0.72);ctx.fill();
    ctx.strokeStyle="rgba(20,80,20,0.8)";ctx.lineWidth=s*0.05;ctx.beginPath();ctx.arc(s*0.05,-s*0.2,s*0.18,0.2,Math.PI-0.2);ctx.stroke();
    ctx.fillStyle="rgba(60,160,60,0.85)";
    ctx.beginPath();ctx.moveTo(-s*0.15,s*0.05);ctx.lineTo(-s*0.22,s*0.45+walk*s*0.2);ctx.lineTo(-s*0.05,s*0.45+walk*s*0.2);ctx.fill();
    ctx.beginPath();ctx.moveTo(s*0.15,s*0.05);ctx.lineTo(s*0.05,s*0.45-walk*s*0.2);ctx.lineTo(s*0.22,s*0.45-walk*s*0.2);ctx.fill();
  } else if(char.type==="boo"){
    ctx.fillStyle="rgba(240,180,200,0.85)";
    ctx.beginPath();ctx.ellipse(0,-s*0.25,s*0.3,s*0.38,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="rgba(255,220,200,0.9)";ctx.beginPath();ctx.arc(0,-s*0.75,s*0.25,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="rgba(80,40,20,0.8)";
    ctx.beginPath();ctx.arc(-s*0.28,-s*0.85,s*0.1,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(s*0.28,-s*0.85,s*0.1,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="rgba(40,20,10,0.9)";
    ctx.beginPath();ctx.arc(-s*0.1,-s*0.77,s*0.05,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(s*0.1,-s*0.77,s*0.05,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="rgba(180,80,80,0.8)";ctx.lineWidth=s*0.04;ctx.beginPath();ctx.arc(0,-s*0.68,s*0.1,0.2,Math.PI-0.2);ctx.stroke();
    ctx.fillStyle="rgba(240,180,200,0.85)";
    ctx.beginPath();ctx.moveTo(-s*0.12,s*0.12);ctx.lineTo(-s*0.18,s*0.45+walk*s*0.15);ctx.lineTo(-s*0.04,s*0.45+walk*s*0.15);ctx.fill();
    ctx.beginPath();ctx.moveTo(s*0.12,s*0.12);ctx.lineTo(s*0.04,s*0.45-walk*s*0.15);ctx.lineTo(s*0.18,s*0.45-walk*s*0.15);ctx.fill();
  } else if(char.type==="bird"){
    ctx.fillStyle="rgba(80,160,200,0.85)";
    ctx.beginPath();ctx.ellipse(0,-s*0.6,s*0.22,s*0.5,0.1,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.moveTo(s*0.08,-s*1.05);ctx.bezierCurveTo(s*0.15,-s*1.3,s*0.25,-s*1.5,s*0.2,-s*1.7);ctx.bezierCurveTo(s*0.1,-s*1.65,s*0.0,-s*1.45,-s*0.05,-s*1.1);ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.arc(s*0.18,-s*1.75,s*0.15,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="rgba(200,80,40,0.9)";ctx.beginPath();ctx.moveTo(s*0.18,-s*1.88);ctx.lineTo(s*0.08,-s*2.1);ctx.lineTo(s*0.28,-s*2.05);ctx.closePath();ctx.fill();
    ctx.fillStyle="rgba(255,200,0,0.9)";ctx.beginPath();ctx.arc(s*0.25,-s*1.77,s*0.05,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="rgba(60,130,170,0.85)";ctx.lineWidth=s*0.08;
    ctx.beginPath();ctx.moveTo(-s*0.08,-s*0.1);ctx.lineTo(-s*0.18,s*0.5+walk*s*0.3);ctx.lineTo(-s*0.28,s*0.5+walk*s*0.3);ctx.stroke();
    ctx.beginPath();ctx.moveTo(s*0.08,-s*0.1);ctx.lineTo(s*0.0,s*0.5-walk*s*0.3);ctx.lineTo(-s*0.1,s*0.5-walk*s*0.3);ctx.stroke();
    ctx.fillStyle="rgba(60,140,180,0.7)";ctx.beginPath();ctx.moveTo(s*0.15,-s*0.8);ctx.bezierCurveTo(s*0.5,-s*0.9+walk*s*0.2,s*0.7,-s*0.6,s*0.6,-s*0.3);ctx.bezierCurveTo(s*0.4,-s*0.2,s*0.2,-s*0.4,s*0.15,-s*0.8);ctx.fill();
  } else if(char.type==="grandpa"){
    ctx.fillStyle="rgba(80,60,40,0.85)";
    ctx.beginPath();ctx.ellipse(0,-s*0.45,s*0.2,s*0.35,0,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(0,-s*0.9,s*0.18,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="rgba(100,80,50,0.8)";ctx.lineWidth=s*0.05;
    ctx.beginPath();ctx.moveTo(s*0.18,-s*0.5);ctx.lineTo(s*0.28,s*0.4);ctx.stroke();
    ctx.beginPath();ctx.moveTo(s*0.18,-s*0.5);ctx.bezierCurveTo(s*0.25,-s*0.65,s*0.35,-s*0.6,s*0.3,-s*0.5);ctx.stroke();
    ctx.fillStyle="rgba(80,60,40,0.85)";
    ctx.beginPath();ctx.moveTo(-s*0.08,-s*0.1);ctx.lineTo(-s*0.14,s*0.38+walk*s*0.15);ctx.lineTo(-s*0.02,s*0.38+walk*s*0.15);ctx.fill();
    ctx.beginPath();ctx.moveTo(s*0.08,-s*0.1);ctx.lineTo(s*0.02,s*0.38-walk*s*0.15);ctx.lineTo(s*0.14,s*0.38-walk*s*0.15);ctx.fill();
  } else {
    // Generic monster
    ctx.fillStyle=`hsla(${(char.frame*30)%360},60%,35%,0.8)`;
    ctx.beginPath();ctx.ellipse(0,-s*0.4,s*0.3,s*0.45,0,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(0,-s*0.95,s*0.25,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.moveTo(-s*0.12,-s*0.05);ctx.lineTo(-s*0.18,s*0.42+walk*s*0.2);ctx.lineTo(-s*0.04,s*0.42+walk*s*0.2);ctx.fill();
    ctx.beginPath();ctx.moveTo(s*0.12,-s*0.05);ctx.lineTo(s*0.04,s*0.42-walk*s*0.2);ctx.lineTo(s*0.18,s*0.42-walk*s*0.2);ctx.fill();
  }
  ctx.restore();
}

function drawBalloonHouse(ctx: CanvasRenderingContext2D, bh: BalloonHouse, t: number) {
  const {x,y}=bh;
  const balloonColors=["rgba(255,80,80,0.8)","rgba(255,180,50,0.8)","rgba(80,180,255,0.8)","rgba(180,80,255,0.8)","rgba(80,220,80,0.8)","rgba(255,120,200,0.8)"];
  for(let i=0;i<20;i++){
    const bx=x+Math.sin(i*1.7+t*0.3+bh.balloonPhase)*30;
    const by=y-60-i*5+Math.cos(i*2.1+t*0.2)*8;
    ctx.fillStyle=balloonColors[i%balloonColors.length];
    ctx.beginPath();ctx.ellipse(bx,by,8,11,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="rgba(150,120,80,0.5)";ctx.lineWidth=0.5;
    ctx.beginPath();ctx.moveTo(bx,by+11);ctx.lineTo(x+(i-10)*2,y-20);ctx.stroke();
  }
  ctx.fillStyle="rgba(180,130,80,0.85)";ctx.fillRect(x-30,y-20,60,45);
  ctx.fillStyle="rgba(140,80,50,0.9)";ctx.beginPath();ctx.moveTo(x-38,y-20);ctx.lineTo(x,y-55);ctx.lineTo(x+38,y-20);ctx.closePath();ctx.fill();
  ctx.fillStyle="rgba(100,70,40,0.8)";ctx.beginPath();ctx.roundRect(x-10,y+5,20,20,3);ctx.fill();
  ctx.fillStyle="rgba(255,220,120,0.6)";ctx.fillRect(x-26,y-12,14,12);ctx.fillRect(x+12,y-12,14,12);
  ctx.fillStyle="rgba(120,80,50,0.8)";ctx.fillRect(x+10,y-52,10,20);
}

function paintMonsters(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  if(!monstersInit){initMonsters(w,h);monstersInit=true;}
  ctx.clearRect(0,0,w,h);
  const bg=ctx.createLinearGradient(0,0,0,h);
  bg.addColorStop(0,"#0a0c18");bg.addColorStop(0.4,"#0c1020");bg.addColorStop(0.7,"#080e1a");bg.addColorStop(1,"#060810");
  ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
  // Factory pipes
  ctx.strokeStyle="rgba(60,80,120,0.4)";ctx.lineWidth=8;
  for(let i=0;i<5;i++){ctx.beginPath();ctx.moveTo(0,h*0.05+i*h*0.04);ctx.lineTo(w,h*0.05+i*h*0.04);ctx.stroke();}
  ctx.fillStyle="rgba(80,100,140,0.5)";
  for(let i=0;i<5;i++){for(let j=0;j<6;j++){ctx.beginPath();ctx.arc(j*(w/5)+(i*40)%(w/5),h*0.05+i*h*0.04,6,0,Math.PI*2);ctx.fill();}}
  // Balloon houses
  for(const bh of balloonHouses){bh.y+=bh.vy;if(bh.y<-100){bh.y=h+100;bh.x=Math.random()*w;}drawBalloonHouse(ctx,bh,t);}
  // Floor
  const floor=ctx.createLinearGradient(0,h*0.65,0,h);floor.addColorStop(0,"rgba(15,20,35,0.9)");floor.addColorStop(1,"rgba(8,12,22,0.95)");ctx.fillStyle=floor;ctx.fillRect(0,h*0.65,w,h*0.35);
  ctx.strokeStyle="rgba(30,40,70,0.4)";ctx.lineWidth=1;
  for(let tx=0;tx<w;tx+=60){ctx.beginPath();ctx.moveTo(tx,h*0.65);ctx.lineTo(tx,h);ctx.stroke();}
  for(let ty=h*0.65;ty<h;ty+=24){ctx.beginPath();ctx.moveTo(0,ty);ctx.lineTo(w,ty);ctx.stroke();}
  // Parade
  for(const char of monsterChars){char.x+=char.vx;char.frame+=0.04;if(char.x>w+200){char.x=-200;char.y=h*0.68+Math.random()*h*0.06;}drawMonsterChar(ctx,char,t);}
  // Overhead lights
  ctx.globalCompositeOperation="screen";
  const lightHues=[185,300,60,120,240];
  for(let i=0;i<5;i++){const lx=(i/4)*w;const pulse=0.5+0.5*Math.sin(t*0.5+i*1.2);const lg=ctx.createRadialGradient(lx,0,0,lx,0,120);lg.addColorStop(0,`hsla(${lightHues[i]},80%,60%,${0.06*pulse})`);lg.addColorStop(1,"transparent");ctx.fillStyle=lg;ctx.beginPath();ctx.arc(lx,0,120,0,Math.PI*2);ctx.fill();}
  ctx.globalCompositeOperation="source-over";
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── LO-FI CITY NIGHT ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
interface LoFiRain { x: number; y: number; speed: number; len: number; alpha: number }
const lofiRain: LoFiRain[] = [];
let lofiInit = false;

function initLoFi(cw: number, ch: number) {
  lofiRain.length = 0;
  for(let i=0;i<120;i++){lofiRain.push({x:Math.random()*cw,y:Math.random()*ch,speed:3+Math.random()*5,len:6+Math.random()*14,alpha:0.1+Math.random()*0.25});}
}

function paintLoFi(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  if(!lofiInit){initLoFi(w,h);lofiInit=true;}
  ctx.clearRect(0,0,w,h);
  // Night sky — warm amber/indigo
  const sky=ctx.createLinearGradient(0,0,0,h);
  sky.addColorStop(0,"#08050f");sky.addColorStop(0.4,"#0f0a1a");sky.addColorStop(0.7,"#150d20");sky.addColorStop(1,"#0a0810");
  ctx.fillStyle=sky;ctx.fillRect(0,0,w,h);
  // Stars (sparse, warm)
  for(let i=0;i<80;i++){const sx=((i*137.5+30)%w),sy=((i*89.3+10)%(h*0.55));const alpha=0.2+0.4*Math.abs(Math.sin(t*0.4+i*0.6));ctx.beginPath();ctx.arc(sx,sy,0.7,0,Math.PI*2);ctx.fillStyle=`rgba(255,240,200,${alpha})`;ctx.fill();}
  // Crescent moon
  const moonX=w*0.78,moonY=h*0.12,moonR=Math.min(w,h)*0.055;
  ctx.fillStyle="rgba(255,240,180,0.92)";
  ctx.beginPath();ctx.arc(moonX,moonY,moonR,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="rgba(8,5,15,0.95)";
  ctx.beginPath();ctx.arc(moonX+moonR*0.35,moonY-moonR*0.1,moonR*0.85,0,Math.PI*2);ctx.fill();
  // Moon glow
  ctx.globalCompositeOperation="screen";
  const mg=ctx.createRadialGradient(moonX,moonY,0,moonX,moonY,moonR*4);
  mg.addColorStop(0,"rgba(255,220,100,0.08)");mg.addColorStop(1,"transparent");
  ctx.fillStyle=mg;ctx.beginPath();ctx.arc(moonX,moonY,moonR*4,0,Math.PI*2);ctx.fill();
  ctx.globalCompositeOperation="source-over";
  // City skyline silhouette
  const horizonY=h*0.58;
  ctx.fillStyle="rgba(8,6,18,0.95)";
  const buildings=[[0.0,0.07,0.35],[0.06,0.05,0.28],[0.10,0.08,0.42],[0.17,0.06,0.32],[0.22,0.09,0.38],[0.30,0.05,0.25],[0.34,0.07,0.45],[0.40,0.06,0.30],[0.45,0.08,0.40],[0.52,0.05,0.28],[0.56,0.07,0.35],[0.62,0.09,0.48],[0.70,0.06,0.32],[0.75,0.08,0.38],[0.82,0.05,0.25],[0.86,0.07,0.42],[0.92,0.06,0.30],[0.97,0.05,0.35]];
  for(const [bx,bw,bh2] of buildings){
    const px=bx*w,ph=bh2*horizonY,py=horizonY-ph;
    ctx.fillRect(px,py,bw*w,ph);
    // Lit windows
    const cols=Math.floor(bw*w/7),rows=Math.floor(ph/9);
    for(let r=0;r<rows;r++){for(let c=0;c<cols;c++){
      const wx=px+c*7+1,wy=py+r*9+1;
      const litSeed=Math.sin(wx*0.7+wy*0.3);
      if(litSeed>0.1){const warmth=litSeed>0.5?`rgba(255,200,100,0.18)`:`rgba(200,180,255,0.10)`;ctx.fillStyle=warmth;ctx.fillRect(wx,wy,4,5);}
    }}
    ctx.fillStyle="rgba(8,6,18,0.95)";
  }
  // Street / ground
  const streetGrd=ctx.createLinearGradient(0,horizonY,0,h);
  streetGrd.addColorStop(0,"rgba(10,8,20,0.95)");streetGrd.addColorStop(1,"rgba(6,5,12,0.98)");
  ctx.fillStyle=streetGrd;ctx.fillRect(0,horizonY,w,h-horizonY);
  // Street reflections
  ctx.globalCompositeOperation="screen";
  const refColors=[[w*0.25,255,180,100],[w*0.5,200,150,255],[w*0.75,255,200,100]] as [number,number,number,number][];
  for(const [rx,rr,rg,rb] of refColors){
    const rGrd=ctx.createRadialGradient(rx,h*0.8,0,rx,h*0.8,60);
    rGrd.addColorStop(0,`rgba(${rr},${rg},${rb},0.06)`);rGrd.addColorStop(1,"transparent");
    ctx.fillStyle=rGrd;ctx.beginPath();ctx.ellipse(rx,h*0.8,60,20,0,0,Math.PI*2);ctx.fill();
  }
  ctx.globalCompositeOperation="source-over";
  // Warm window glow (interior room)
  const winX=w*0.08,winY=h*0.38,winW=w*0.18,winH=h*0.28;
  const winGrd=ctx.createRadialGradient(winX+winW*0.5,winY+winH*0.5,0,winX+winW*0.5,winY+winH*0.5,winW*0.7);
  winGrd.addColorStop(0,"rgba(255,200,100,0.18)");winGrd.addColorStop(0.5,"rgba(255,160,60,0.08)");winGrd.addColorStop(1,"transparent");
  ctx.fillStyle=winGrd;ctx.fillRect(winX-20,winY-20,winW+40,winH+40);
  // Window frame
  ctx.strokeStyle="rgba(200,160,80,0.3)";ctx.lineWidth=2;
  ctx.strokeRect(winX,winY,winW,winH);
  ctx.beginPath();ctx.moveTo(winX+winW*0.5,winY);ctx.lineTo(winX+winW*0.5,winY+winH);ctx.stroke();
  ctx.beginPath();ctx.moveTo(winX,winY+winH*0.5);ctx.lineTo(winX+winW,winY+winH*0.5);ctx.stroke();
  // Anime girl silhouette at window
  const gx=winX+winW*0.35,gy=winY+winH*0.9;
  const gs=winH*0.55;
  ctx.fillStyle="rgba(15,10,25,0.88)";
  ctx.beginPath();ctx.ellipse(gx,gy-gs*0.38,gs*0.18,gs*0.32,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(gx,gy-gs*0.82,gs*0.16,0,Math.PI*2);ctx.fill();
  // Hair
  ctx.beginPath();ctx.moveTo(gx-gs*0.12,gy-gs*0.72);ctx.bezierCurveTo(gx-gs*0.35,gy-gs*0.5,gx-gs*0.4,gy-gs*0.1,gx-gs*0.3,gy+gs*0.05);ctx.bezierCurveTo(gx-gs*0.2,gy+gs*0.08,gx-gs*0.15,gy-gs*0.2,gx-gs*0.1,gy-gs*0.7);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(gx+gs*0.1,gy-gs*0.72);ctx.bezierCurveTo(gx+gs*0.3,gy-gs*0.55,gx+gs*0.28,gy-gs*0.2,gx+gs*0.2,gy+gs*0.02);ctx.bezierCurveTo(gx+gs*0.12,gy+gs*0.05,gx+gs*0.1,gy-gs*0.3,gx+gs*0.08,gy-gs*0.7);ctx.closePath();ctx.fill();
  // Sitting legs
  ctx.beginPath();ctx.moveTo(gx-gs*0.15,gy-gs*0.07);ctx.bezierCurveTo(gx-gs*0.3,gy+gs*0.05,gx-gs*0.35,gy+gs*0.15,gx-gs*0.1,gy+gs*0.18);ctx.bezierCurveTo(gx+gs*0.1,gy+gs*0.18,gx+gs*0.15,gy+gs*0.08,gx+gs*0.15,gy-gs*0.07);ctx.closePath();ctx.fill();
  // Cat silhouette on sill
  const catX=gx+gs*0.5,catY=gy-gs*0.02;
  ctx.fillStyle="rgba(10,8,20,0.9)";
  ctx.beginPath();ctx.ellipse(catX,catY-gs*0.06,gs*0.08,gs*0.06,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(catX,catY-gs*0.15,gs*0.07,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.moveTo(catX-gs*0.06,catY-gs*0.2);ctx.lineTo(catX-gs*0.1,catY-gs*0.3);ctx.lineTo(catX-gs*0.02,catY-gs*0.2);ctx.fill();
  ctx.beginPath();ctx.moveTo(catX+gs*0.02,catY-gs*0.2);ctx.lineTo(catX+gs*0.08,catY-gs*0.3);ctx.lineTo(catX+gs*0.12,catY-gs*0.2);ctx.fill();
  // Cat glow eyes
  ctx.fillStyle="rgba(100,255,150,0.8)";
  ctx.beginPath();ctx.arc(catX-gs*0.025,catY-gs*0.16,gs*0.015,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(catX+gs*0.025,catY-gs*0.16,gs*0.015,0,Math.PI*2);ctx.fill();
  ctx.globalCompositeOperation="screen";
  const catGlow=ctx.createRadialGradient(catX,catY-gs*0.15,0,catX,catY-gs*0.15,gs*0.15);
  catGlow.addColorStop(0,"rgba(100,255,150,0.12)");catGlow.addColorStop(1,"transparent");
  ctx.fillStyle=catGlow;ctx.beginPath();ctx.arc(catX,catY-gs*0.15,gs*0.15,0,Math.PI*2);ctx.fill();
  ctx.globalCompositeOperation="source-over";
  // Rain on glass
  for(const r of lofiRain){
    r.y+=r.speed;if(r.y>h){r.y=-r.len;r.x=Math.random()*w;}
    ctx.strokeStyle=`rgba(180,200,255,${r.alpha*0.6})`;ctx.lineWidth=0.6;
    ctx.beginPath();ctx.moveTo(r.x,r.y);ctx.lineTo(r.x-0.3,r.y+r.len);ctx.stroke();
  }
  // Warm atmospheric haze
  ctx.globalCompositeOperation="screen";
  const haze=ctx.createRadialGradient(w*0.5,h*0.6,0,w*0.5,h*0.6,w*0.5);
  haze.addColorStop(0,"rgba(255,150,80,0.03)");haze.addColorStop(1,"transparent");
  ctx.fillStyle=haze;ctx.fillRect(0,0,w,h);
  ctx.globalCompositeOperation="source-over";
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── SPACE STATION ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
interface FloatingObject { x: number; y: number; vx: number; vy: number; rot: number; vrot: number; type: string; size: number }
const floatingObjects: FloatingObject[] = [];
let spaceInit = false;

function initSpace(cw: number, ch: number) {
  floatingObjects.length = 0;
  const types=["book","mug","headphones","plant","star","orb"];
  for(let i=0;i<12;i++){floatingObjects.push({x:Math.random()*cw,y:Math.random()*ch,vx:(Math.random()-0.5)*0.3,vy:(Math.random()-0.5)*0.2,rot:Math.random()*Math.PI*2,vrot:(Math.random()-0.5)*0.01,type:types[i%types.length],size:8+Math.random()*12});}
}

function drawFloatingObject(ctx: CanvasRenderingContext2D, obj: FloatingObject, t: number) {
  ctx.save();ctx.translate(obj.x,obj.y);ctx.rotate(obj.rot+Math.sin(t*0.3+obj.x)*0.1);
  const s=obj.size;
  if(obj.type==="book"){
    ctx.fillStyle="rgba(180,100,60,0.7)";ctx.fillRect(-s*0.7,-s*0.5,s*1.4,s);
    ctx.fillStyle="rgba(220,140,80,0.5)";ctx.fillRect(-s*0.65,-s*0.45,s*0.08,s*0.9);
  } else if(obj.type==="mug"){
    ctx.fillStyle="rgba(200,180,160,0.7)";ctx.beginPath();ctx.roundRect(-s*0.4,-s*0.5,s*0.8,s,3);ctx.fill();
    ctx.strokeStyle="rgba(180,160,140,0.6)";ctx.lineWidth=s*0.12;ctx.beginPath();ctx.arc(s*0.5,0,s*0.3,Math.PI*0.3,Math.PI*1.7);ctx.stroke();
  } else if(obj.type==="headphones"){
    ctx.strokeStyle="rgba(150,150,200,0.7)";ctx.lineWidth=s*0.15;
    ctx.beginPath();ctx.arc(0,-s*0.2,s*0.5,Math.PI,0);ctx.stroke();
    ctx.fillStyle="rgba(120,120,180,0.7)";
    ctx.beginPath();ctx.arc(-s*0.5,s*0.1,s*0.2,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(s*0.5,s*0.1,s*0.2,0,Math.PI*2);ctx.fill();
  } else if(obj.type==="plant"){
    ctx.fillStyle="rgba(60,140,60,0.7)";
    ctx.beginPath();ctx.moveTo(0,s*0.3);ctx.bezierCurveTo(-s*0.5,0,-s*0.6,-s*0.5,0,-s*0.8);ctx.bezierCurveTo(s*0.6,-s*0.5,s*0.5,0,0,s*0.3);ctx.fill();
    ctx.beginPath();ctx.moveTo(0,s*0.3);ctx.bezierCurveTo(s*0.3,0,s*0.5,-s*0.3,s*0.2,-s*0.6);ctx.bezierCurveTo(-s*0.1,-s*0.3,0,0,0,s*0.3);ctx.fill();
  } else if(obj.type==="orb"){
    const og=ctx.createRadialGradient(0,0,0,0,0,s);
    og.addColorStop(0,"rgba(150,100,255,0.8)");og.addColorStop(0.5,"rgba(80,50,200,0.4)");og.addColorStop(1,"transparent");
    ctx.fillStyle=og;ctx.beginPath();ctx.arc(0,0,s,0,Math.PI*2);ctx.fill();
  } else {
    // Star
    ctx.fillStyle="rgba(255,220,100,0.7)";
    ctx.beginPath();for(let i=0;i<5;i++){const a=(i/5)*Math.PI*2-Math.PI/2;const ir=(i+0.5)/5*Math.PI*2-Math.PI/2;ctx.lineTo(Math.cos(a)*s,Math.sin(a)*s);ctx.lineTo(Math.cos(ir)*s*0.4,Math.sin(ir)*s*0.4);}ctx.closePath();ctx.fill();
  }
  ctx.restore();
}

function paintSpaceStation(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  if(!spaceInit){initSpace(w,h);spaceInit=true;}
  ctx.clearRect(0,0,w,h);
  // Deep space background
  const bg=ctx.createLinearGradient(0,0,0,h);
  bg.addColorStop(0,"#02000a");bg.addColorStop(0.4,"#05020f");bg.addColorStop(0.7,"#080318");bg.addColorStop(1,"#040210");
  ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
  // Stars
  for(let i=0;i<250;i++){const sx=((i*137.5+50)%w),sy=((i*89.3+20)%(h*0.65));const alpha=0.3+0.5*Math.abs(Math.sin(t*0.4+i*0.3));ctx.beginPath();ctx.arc(sx,sy,i%8===0?1.4:0.5,0,Math.PI*2);ctx.fillStyle=`rgba(200,180,255,${alpha})`;ctx.fill();}
  // Galaxy window (large oval viewport)
  const gwX=w*0.62,gwY=h*0.32,gwW=w*0.32,gwH=h*0.38;
  ctx.save();ctx.beginPath();ctx.ellipse(gwX,gwY,gwW*0.5,gwH*0.5,0,0,Math.PI*2);ctx.clip();
  // Galaxy nebula inside window
  ctx.globalCompositeOperation="screen";
  const nebColors=[[gwX-gwW*0.1,gwY-gwH*0.1,gwW*0.4,280],[gwX+gwW*0.1,gwY+gwH*0.1,gwW*0.35,200],[gwX,gwY,gwW*0.3,240]] as [number,number,number,number][];
  for(const [nx,ny,nr,nh] of nebColors){const ng=ctx.createRadialGradient(nx,ny,0,nx,ny,nr);ng.addColorStop(0,`hsla(${nh},80%,50%,0.15)`);ng.addColorStop(1,"transparent");ctx.fillStyle=ng;ctx.fillRect(gwX-gwW*0.5,gwY-gwH*0.5,gwW,gwH);}
  ctx.globalCompositeOperation="source-over";
  // Stars inside window
  for(let i=0;i<80;i++){const sx=gwX-gwW*0.4+Math.random()*gwW*0.8,sy=gwY-gwH*0.4+Math.random()*gwH*0.8;ctx.beginPath();ctx.arc(sx,sy,Math.random()*1.2,0,Math.PI*2);ctx.fillStyle=`rgba(220,200,255,${0.4+Math.random()*0.5})`;ctx.fill();}
  ctx.restore();
  // Window frame
  ctx.strokeStyle="rgba(80,60,120,0.6)";ctx.lineWidth=4;
  ctx.beginPath();ctx.ellipse(gwX,gwY,gwW*0.5,gwH*0.5,0,0,Math.PI*2);ctx.stroke();
  // Window glow
  ctx.globalCompositeOperation="screen";
  const wg=ctx.createRadialGradient(gwX,gwY,0,gwX,gwY,gwW*0.6);
  wg.addColorStop(0,"rgba(120,80,255,0.06)");wg.addColorStop(1,"transparent");
  ctx.fillStyle=wg;ctx.fillRect(0,0,w,h);
  ctx.globalCompositeOperation="source-over";
  // Station interior — floor/walls
  const wallGrd=ctx.createLinearGradient(0,h*0.55,0,h);
  wallGrd.addColorStop(0,"rgba(12,8,25,0.9)");wallGrd.addColorStop(1,"rgba(8,5,18,0.95)");
  ctx.fillStyle=wallGrd;ctx.fillRect(0,h*0.55,w,h*0.45);
  // Floor grid (perspective)
  ctx.strokeStyle="rgba(80,50,150,0.2)";ctx.lineWidth=1;
  const vp={x:w*0.5,y:h*0.55};
  for(let i=0;i<=16;i++){const x=(i/16)*w;ctx.beginPath();ctx.moveTo(vp.x,vp.y);ctx.lineTo(x,h);ctx.stroke();}
  for(let i=0;i<=6;i++){const prog=i/6;const y=vp.y+(h-vp.y)*prog;const xl=vp.x-vp.x*prog;const xr=vp.x+(w-vp.x)*prog;ctx.beginPath();ctx.moveTo(xl,y);ctx.lineTo(xr,y);ctx.stroke();}
  // Neon purple/teal accent strips on walls
  ctx.globalCompositeOperation="screen";
  const strips=[[0,h*0.55,w,3,280],[0,h*0.7,w,2,180],[0,h*0.85,w,2,280]];
  for(const [sx,sy,sw2,sh2,hue] of strips){
    const sg=ctx.createLinearGradient(0,0,w,0);
    sg.addColorStop(0,"transparent");sg.addColorStop(0.3,`hsla(${hue},100%,60%,0.15)`);sg.addColorStop(0.7,`hsla(${hue},100%,60%,0.15)`);sg.addColorStop(1,"transparent");
    ctx.fillStyle=sg;ctx.fillRect(sx,sy,sw2,sh2);
  }
  ctx.globalCompositeOperation="source-over";
  // Side neon glow panels
  ctx.globalCompositeOperation="screen";
  const panelGrd1=ctx.createLinearGradient(0,0,w*0.15,0);
  panelGrd1.addColorStop(0,"rgba(120,0,255,0.08)");panelGrd1.addColorStop(1,"transparent");
  ctx.fillStyle=panelGrd1;ctx.fillRect(0,h*0.55,w*0.15,h*0.45);
  const panelGrd2=ctx.createLinearGradient(w,0,w*0.85,0);
  panelGrd2.addColorStop(0,"rgba(0,200,255,0.08)");panelGrd2.addColorStop(1,"transparent");
  ctx.fillStyle=panelGrd2;ctx.fillRect(w*0.85,h*0.55,w*0.15,h*0.45);
  ctx.globalCompositeOperation="source-over";
  // Floating objects
  for(const obj of floatingObjects){
    obj.x+=obj.vx+Math.sin(t*0.2+obj.y*0.01)*0.1;
    obj.y+=obj.vy+Math.cos(t*0.15+obj.x*0.01)*0.08;
    obj.rot+=obj.vrot;
    if(obj.x<-30)obj.x=w+30;if(obj.x>w+30)obj.x=-30;
    if(obj.y<h*0.1)obj.vy=Math.abs(obj.vy);if(obj.y>h*0.9)obj.vy=-Math.abs(obj.vy);
    drawFloatingObject(ctx,obj,t);
  }
  // Purple/teal atmospheric glow
  ctx.globalCompositeOperation="screen";
  const atmo1=ctx.createRadialGradient(w*0.15,h*0.7,0,w*0.15,h*0.7,w*0.3);
  atmo1.addColorStop(0,"rgba(120,0,255,0.05)");atmo1.addColorStop(1,"transparent");
  ctx.fillStyle=atmo1;ctx.fillRect(0,0,w,h);
  const atmo2=ctx.createRadialGradient(w*0.85,h*0.65,0,w*0.85,h*0.65,w*0.3);
  atmo2.addColorStop(0,"rgba(0,200,255,0.05)");atmo2.addColorStop(1,"transparent");
  ctx.fillStyle=atmo2;ctx.fillRect(0,0,w,h);
  ctx.globalCompositeOperation="source-over";
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── PAINTERS MAP ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
const PAINTERS: Record<SkinId, Painter> = {
  aurora: paintAurora,
  goth: paintGoth,
  nature: paintNature,
  cyberpunk: paintCyberpunk,
  finalfantasy: paintFinalFantasy,
  monsters: paintMonsters,
  lofi: paintLoFi,
  spacestation: paintSpaceStation,
};

// Reset init flags when skin changes
function resetSkinState(skin: SkinId) {
  if (skin !== "goth") gothInit = false;
  if (skin !== "nature") natureInit = false;
  if (skin !== "cyberpunk") cyberInit = false;
  if (skin !== "finalfantasy") ffInit = false;
  if (skin !== "monsters") monstersInit = false;
  if (skin !== "lofi") lofiInit = false;
  if (skin !== "spacestation") spaceInit = false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── THEME CANVAS COMPONENT ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
interface ThemeCanvasProps {
  skin: SkinId;
}

export function ThemeCanvas({ skin }: ThemeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Reset all other skin states when switching
    resetSkinState(skin);

    let animId: number;
    let startTime = performance.now();

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const painter = PAINTERS[skin] ?? paintAurora;

    const frame = () => {
      const t = (performance.now() - startTime) / 1000;
      painter(ctx, canvas.width, canvas.height, t);
      animId = requestAnimationFrame(frame);
    };
    animId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, [skin]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
        opacity: 0.85,
      }}
    />
  );
}

