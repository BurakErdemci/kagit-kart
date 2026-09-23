// Canvas painters for the book stage: the printed spread, the volvelle disc, the podium numbers and
// the desk wood. Everything is drawn in code (ARCHITECTURE §2) with a print look: flat colour plates
// slightly off register against the ink key plate, halftone screens, text set as grey word bars.
import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { drawLettering } from '../ui/lettering.js';

export const INK = '#2d2a32';
export const PAPER = '#f4ecd8';
const PX_PER_M = 1024 / 12; // page prints: 12 m of page per 1024 px

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(c, renderer, { repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// Plate offset: every colour fill is printed this far off the ink key.
const REG = [3, -2];

function traceSmooth(g, pts) {
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const l = pts[pts.length - 1];
  g.lineTo(l[0], l[1]);
}

function blobPath(g, cx, cy, rx, ry, rand, n = 14) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.82 + rand() * 0.3;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  g.beginPath();
  const m0 = [(pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2];
  g.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  g.closePath();
}

// Colour plate (offset) + ink key line: the printed-shape primitive.
function printShape(g, path, fill, { ink = INK, line = 3, reg = REG, alpha = 1 } = {}) {
  g.save();
  g.globalAlpha = alpha;
  g.translate(reg[0], reg[1]);
  path(g);
  g.fillStyle = fill;
  g.fill();
  g.restore();
  if (line > 0) {
    path(g);
    g.lineWidth = line;
    g.lineJoin = 'round';
    g.strokeStyle = ink;
    g.stroke();
  }
}

// Halftone screen clipped to a path; dot radius from size(x, y) in 0..1 of the cell.
function halftone(g, path, color, cell, size, angle = 0.4) {
  g.save();
  path(g);
  g.clip();
  g.fillStyle = color;
  const c = Math.cos(angle), s = Math.sin(angle);
  const W = g.canvas.width, H = g.canvas.height, R = Math.hypot(W, H);
  for (let v = -R; v < R; v += cell) {
    for (let u = -R; u < R; u += cell) {
      const x = u * c - v * s, y = u * s + v * c;
      if (x < -cell || y < -cell || x > W + cell || y > H + cell) continue;
      const r = size(x, y) * cell * 0.5;
      if (r < 0.35) continue;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

// Body copy as word bars: reads as print at every distance without being text.
function textBlock(g, x, y, w, lines, rand, { lineH = 22, bar = 8, color = INK, alpha = 0.5, indent = 34, lastShort = true } = {}) {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  for (let l = 0; l < lines; l++) {
    let cx = x + (l === 0 ? indent : 0);
    const end = x + (lastShort && l === lines - 1 ? w * (0.35 + rand() * 0.3) : w);
    while (cx < end - 12) {
      const ww = Math.min(end - cx, 14 + rand() * 62);
      g.beginPath();
      g.roundRect(cx, y + l * lineH, ww, bar, bar / 2);
      g.fill();
      cx += ww + 9 + rand() * 4;
    }
  }
  g.restore();
}

function daisy(g, x, y, r, rand) {
  const petals = 8;
  g.save();
  g.translate(x, y);
  g.rotate(rand() * Math.PI);
  g.fillStyle = '#fbf6e9';
  g.strokeStyle = INK;
  g.lineWidth = Math.max(1.2, r * 0.12);
  for (let i = 0; i < petals; i++) {
    g.save();
    g.rotate((i / petals) * Math.PI * 2);
    g.beginPath();
    g.ellipse(r * 0.62, 0, r * 0.45, r * 0.2, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  }
  g.fillStyle = '#f2c14e';
  g.beginPath();
  g.arc(REG[0] * 0.5, REG[1] * 0.5, r * 0.3, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(0, 0, r * 0.3, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

function grassTicks(g, x, y, w, h, n, rand) {
  g.save();
  g.strokeStyle = INK;
  g.globalAlpha = 0.55;
  g.lineWidth = 2;
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const px = x + rand() * w, py = y + rand() * h, l = 7 + rand() * 7;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px - 2, py - l);
    g.moveTo(px + 4, py);
    g.lineTo(px + 6, py - l * 0.8);
    g.stroke();
  }
  g.restore();
}

// World (page-local metres) → print pixels. Left page x ∈ [-12, 0], right page x ∈ [0, 12]; the
// canvas top is the far edge of the book (z = -halfDepth).
function toPx(x, z, x0, halfDepth) {
  return [(x - x0) * PX_PER_M, (z + halfDepth) * PX_PER_M];
}

function road(g, pts) {
  const path = (gg) => { gg.beginPath(); traceSmooth(gg, pts); };
  const W = 2.8 * PX_PER_M, curb = 0.32 * PX_PER_M;
  g.save();
  g.lineCap = 'butt';
  g.lineJoin = 'round';
  path(g);
  g.strokeStyle = INK;
  g.lineWidth = W + curb * 2 + 7;
  g.stroke();
  g.translate(REG[0], REG[1]);
  path(g);
  g.strokeStyle = '#fbf6e9';
  g.lineWidth = W + curb * 2;
  g.stroke();
  path(g);
  g.strokeStyle = '#d9483b';
  g.setLineDash([curb * 2.2, curb * 2.2]);
  g.stroke();
  g.setLineDash([]);
  path(g);
  g.strokeStyle = '#a9a59c';
  g.lineWidth = W;
  g.stroke();
  g.restore();
  path(g);
  g.strokeStyle = '#fbf6e9';
  g.lineWidth = 9;
  g.setLineDash([34, 30]);
  g.stroke();
  g.setLineDash([]);
}

export function paintPages({ halfDepth, chapter, title, seed = 7 }) {
  const H = Math.round(halfDepth * 2 * PX_PER_M);
  const left = canvas(1024, H);
  const right = canvas(1024, H);
  const under = canvas(512, Math.round(H / 2));

  // ---- left page: chapter opening, meadow and the road that leads to the turntable -------------
  {
    const g = left.getContext('2d');
    const rand = mulberry32(seed);
    g.fillStyle = PAPER;
    g.fillRect(0, 0, left.width, H);
    const P = (x, z) => toPx(x, z, -12, halfDepth);

    textBlock(g, 70, 64, 880, 7, rand, { lineH: 24 });
    // meadow plates
    const hills = [[-8.6, 3.2, 3.6, 2.2], [-3.6, 5.8, 3.2, 2.1], [-9.8, 6.9, 2.6, 1.5], [-2.2, -0.4, 2.1, 1.3]];
    for (const [x, z, rx, rz] of hills) {
      const [cx, cy] = P(x, z);
      const path = (gg) => blobPath(gg, cx, cy, rx * PX_PER_M, rz * PX_PER_M, mulberry32(Math.round(x * 97 + z * 31)));
      printShape(g, path, '#a9cf78', { line: 3 });
      halftone(g, path, '#6f9a58', 13, (px, py) => 0.25 + 0.55 * Math.max(0, Math.min(1, (py - cy) / (rz * PX_PER_M) + 0.3)));
      grassTicks(g, cx - rx * 50, cy - rz * 30, rx * 100, rz * 60, 10, rand);
    }
    // the road: from the front-left corner, past the arch, over the gutter
    const pts = [[-11.5, 8.6], [-10.2, 6.1], [-7.4, 3.9], [-5.2, 1.7], [-3.1, 0.55], [-1.2, 0.4], [0.4, 0.55]].map(([x, z]) => P(x, z));
    road(g, pts);
    for (let i = 0; i < 16; i++) {
      const x = -11.3 + rand() * 10, z = -1.5 + rand() * 9.5;
      const [px, py] = P(x, z);
      daisy(g, px, py, 10 + rand() * 9, rand);
    }
    // page number + running rule
    g.fillStyle = INK;
    g.globalAlpha = 0.7;
    g.fillRect(70, H - 58, 300, 3);
    g.globalAlpha = 1;
    drawLettering(g, String(chapter * 2 + 12), { x: 70, y: H - 18, size: 26, style: 'label', colors: { fill: INK }, seed: 5 });
  }

  // ---- right page: the volvelle stage, its printed ring and the story text ------------------------
  {
    const g = right.getContext('2d');
    const rand = mulberry32(seed + 1);
    g.fillStyle = PAPER;
    g.fillRect(0, 0, right.width, H);
    const P = (x, z) => toPx(x, z, 0, halfDepth);
    textBlock(g, 70, 64, 880, 7, rand, { lineH: 24 });

    // sunburst printed behind the stage
    const [sx, sy] = P(5.4, 0.9);
    g.save();
    g.translate(sx, sy);
    for (let i = 0; i < 24; i++) {
      g.rotate(Math.PI / 12);
      if (i % 2) continue;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(470, -52);
      g.lineTo(470, 52);
      g.closePath();
      g.fillStyle = 'rgba(242,193,78,0.28)';
      g.fill();
    }
    g.restore();
    // base ring the disc sits in, with its tick scale
    printShape(g, (gg) => { gg.beginPath(); gg.arc(sx, sy, 3.62 * PX_PER_M, 0, Math.PI * 2); }, '#e9dcbc', { line: 3 });
    g.save();
    g.strokeStyle = INK;
    g.lineWidth = 3;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2, r0 = 3.62 * PX_PER_M, r1 = r0 - (i % 6 === 0 ? 20 : 10);
      g.beginPath();
      g.moveTo(sx + Math.cos(a) * r0, sy + Math.sin(a) * r0);
      g.lineTo(sx + Math.cos(a) * r1, sy + Math.sin(a) * r1);
      g.stroke();
    }
    g.restore();
    // the road arrives from the gutter
    const pts = [[-0.6, 0.55], [0.8, 0.6], [2.2, 0.8], [3.0, 0.9]].map(([x, z]) => P(x, z));
    road(g, pts);
    // curved "turn" arrow printed beside the disc
    g.save();
    g.strokeStyle = '#d9483b';
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(sx, sy, 3.95 * PX_PER_M, Math.PI * 0.12, Math.PI * 0.42);
    g.stroke();
    const ea = Math.PI * 0.42, er = 3.95 * PX_PER_M;
    const ex = sx + Math.cos(ea) * er, ey = sy + Math.sin(ea) * er;
    g.fillStyle = '#d9483b';
    g.beginPath();
    g.moveTo(ex - 22, ey - 8);
    g.lineTo(ex + 14, ey + 22);
    g.lineTo(ex + 20, ey - 22);
    g.closePath();
    g.fill();
    g.restore();
    const [tx, ty] = P(9.2, 4.55);
    drawLettering(g, 'Çevir', { x: tx, y: ty, size: 34, style: 'label', align: 'center', colors: { fill: '#d9483b', shadow: 'rgba(45,42,50,0.3)' }, seed: 9 });

    // chapter heading and the story column at the front, where the reader looks first
    const [hx, hy] = P(1.5, 5.35);
    drawLettering(g, `${chapter}. Bölüm`, { x: hx, y: hy - 58, size: 28, style: 'label', colors: { fill: '#d9483b', shadow: 'rgba(45,42,50,0.35)' }, seed: 3 });
    drawLettering(g, title, { x: hx, y: hy + 4, size: 62, style: 'cut', seed: 11,
      colors: { fill: ['#f2c14e', '#e56b6f', '#8fb3d9', '#9cc56b'], shadow: INK } });
    textBlock(g, 70, P(0, 6.1)[1], 560, 5, rand, { lineH: 24 });
    for (let i = 0; i < 7; i++) {
      const [px, py] = P(7.4 + rand() * 3.4, 5.6 + rand() * 2.2);
      daisy(g, px, py, 9 + rand() * 7, rand);
    }
    g.fillStyle = INK;
    g.globalAlpha = 0.7;
    g.fillRect(1024 - 370, H - 58, 300, 3);
    g.globalAlpha = 1;
    drawLettering(g, String(chapter * 2 + 13), { x: 1024 - 70, y: H - 18, size: 26, style: 'label', align: 'right', colors: { fill: INK }, seed: 6 });
  }

  // ---- the page under the lifting leaf (right page): faint copy, seen only under the lifted corner ---
  {
    const g = under.getContext('2d');
    const rand = mulberry32(seed + 2);
    g.fillStyle = '#efe5cd';
    g.fillRect(0, 0, under.width, under.height);
    for (let b = 0; b < 4; b++) textBlock(g, 34, 40 + b * 170, 440, 5, rand, { lineH: 12, bar: 4, alpha: 0.3, indent: 16 });
  }

  return { left, right, under };
}

// Volvelle: a turning paper disc with a stage ring, the roster's colour notches and a printed pad.
export function paintDisc(colors, seed = 21) {
  const S = 768;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const rand = mulberry32(seed);
  const C = S / 2, R = S / 2;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, S, S);
  // outer scale band
  printShape(g, (gg) => { gg.beginPath(); gg.arc(C, C, R * 0.985, 0, Math.PI * 2); gg.arc(C, C, R * 0.8, 0, Math.PI * 2, true); }, '#f2c14e', { line: 4 });
  g.save();
  g.strokeStyle = INK;
  g.lineWidth = 3;
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2, r0 = R * 0.965, r1 = R * (i % 8 === 0 ? 0.87 : 0.92);
    g.beginPath();
    g.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0);
    g.lineTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
    g.stroke();
  }
  g.restore();
  // the roster's colour notches
  colors.forEach((col, i) => {
    const a = (i / colors.length) * Math.PI * 2 + Math.PI / colors.length;
    const x = C + Math.cos(a) * R * 0.895, y = C + Math.sin(a) * R * 0.895;
    printShape(g, (gg) => { gg.beginPath(); gg.arc(x, y, R * 0.05, 0, Math.PI * 2); }, col, { line: 3 });
  });
  // alternating rays on the stage floor
  g.save();
  g.translate(C, C);
  for (let i = 0; i < 16; i++) {
    g.rotate(Math.PI / 8);
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, R * 0.8, -Math.PI / 16, Math.PI / 16);
    g.closePath();
    g.fillStyle = i % 2 ? '#f6d6c8' : '#fbf1dc';
    g.fill();
  }
  g.restore();
  halftone(g, (gg) => { gg.beginPath(); gg.arc(C, C, R * 0.8, 0, Math.PI * 2); }, 'rgba(217,72,59,0.55)', 14,
    (x, y) => 0.15 + 0.5 * Math.max(0, Math.hypot(x - C, y - C) / (R * 0.8) - 0.45));
  g.beginPath();
  g.arc(C, C, R * 0.8, 0, Math.PI * 2);
  g.strokeStyle = INK;
  g.lineWidth = 4;
  g.stroke();
  // round tarmac pad the kart parks on
  printShape(g, (gg) => { gg.beginPath(); gg.arc(C, C, R * 0.5, 0, Math.PI * 2); }, '#a9a59c', { line: 4 });
  g.save();
  g.setLineDash([26, 20]);
  g.strokeStyle = '#fbf6e9';
  g.lineWidth = 8;
  g.beginPath();
  g.arc(C, C, R * 0.42, 0, Math.PI * 2);
  g.stroke();
  g.restore();
  g.save();
  g.globalAlpha = 0.08;
  g.fillStyle = INK;
  for (let i = 0; i < 900; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * R * 0.49;
    g.fillRect(C + Math.cos(a) * r, C + Math.sin(a) * r, 2, 2);
  }
  g.restore();
  return c;
}

// Podium faces: one number cell per step, each cut to its face's aspect so the numeral is not
// stretched, plus a plain patch for every other face. Returns uv rects [u0, v0, u1, v1].
export function paintPodium(cells) {
  const W = 1024, H = 512, cw = 300, gap = 16;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  const rects = cells.map((p, i) => {
    const x = gap + i * (cw + gap);
    const ch = Math.min(H - 2 * gap, Math.round(cw / p.aspect));
    const y = gap;
    g.fillStyle = p.color;
    g.fillRect(x, y, cw, ch);
    halftone(g, (gg) => { gg.beginPath(); gg.rect(x, y, cw, ch); }, 'rgba(45,42,50,0.16)', 12, (px, py) => 0.15 + 0.6 * ((py - y) / ch));
    g.strokeStyle = 'rgba(251,246,233,0.85)';
    g.lineWidth = 6;
    const m = Math.min(18, ch * 0.08);
    g.strokeRect(x + m, y + m, cw - 2 * m, ch - 2 * m);
    const size = Math.min(ch * 0.62, 190);
    drawLettering(g, String(p.n), { x: x + cw / 2, y: y + ch * 0.47, baseline: 'middle', size, style: 'cut', align: 'center', seed: 40 + i,
      colors: { fill: '#fbf6e9', shadow: INK } });
    return [x / W, 1 - (y + ch) / H, (x + cw) / W, 1 - y / H];
  });
  return { canvas: c, rects, plain: [0.975, 0.02, 0.99, 0.04] };
}

// Desk top: two long planks per tile with grain, seams and the odd knot.
export function paintWood(base = '#7a5236', seed = 31) {
  const W = 1024, H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const rand = mulberry32(seed);
  const col = new THREE.Color(base);
  const planks = 2;
  const ph = H / planks;
  for (let p = 0; p < planks; p++) {
    const k = p === 0 ? 1.0 : 0.9;
    g.fillStyle = `#${col.clone().multiplyScalar(k).getHexString()}`;
    g.fillRect(0, p * ph, W, ph);
    const y0 = p * ph;
    for (let l = 0; l < 34; l++) {
      const yy = y0 + rand() * ph, amp = 3 + rand() * 9, fr = 0.004 + rand() * 0.01, ph0 = rand() * 6;
      g.beginPath();
      for (let x = 0; x <= W; x += 16) {
        const y = yy + Math.sin(x * fr + ph0) * amp + Math.sin(x * fr * 3.1 + ph0) * amp * 0.25;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokeStyle = rand() < 0.7 ? 'rgba(45,25,15,0.22)' : 'rgba(255,220,170,0.12)';
      g.lineWidth = 1 + rand() * 2.2;
      g.stroke();
    }
    if (rand() < 0.9) {
      const kx = 120 + rand() * (W - 240), ky = y0 + ph * (0.3 + rand() * 0.4);
      for (let r = 5; r > 0; r--) {
        g.beginPath();
        g.ellipse(kx, ky, 8 + r * 7, 4 + r * 3.2, 0, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(45,25,15,0.3)';
        g.lineWidth = 1.6;
        g.stroke();
      }
    }
    g.fillStyle = 'rgba(30,16,10,0.55)';
    g.fillRect(0, y0, W, 3);
  }
  return c;
}
