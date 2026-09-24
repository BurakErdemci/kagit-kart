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

function star(g, x, y, r, fill, rot = 0) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot - Math.PI / 2 + (i / 10) * Math.PI * 2, rr = i % 2 ? r * 0.45 : r;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = Math.max(1.2, r * 0.14);
  g.strokeStyle = INK;
  g.stroke();
}

function snowflake(g, x, y, r, rot) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.strokeStyle = INK;
  g.globalAlpha = 0.7;
  g.lineWidth = Math.max(1.4, r * 0.14);
  g.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(-r, 0); g.lineTo(r, 0);
    g.moveTo(r * 0.55, 0); g.lineTo(r * 0.8, -r * 0.22);
    g.moveTo(r * 0.55, 0); g.lineTo(r * 0.8, r * 0.22);
    g.stroke();
  }
  g.restore();
}

// Small printed motif scattered over a chapter's pages (the meadow's daisies, the Bosphorus' stars...).
function motif(key, g, x, y, r, rand) {
  if (key === 'bosphorus') star(g, x, y, r * 0.8, '#f2c14e', rand());
  else if (key === 'glacier') snowflake(g, x, y, r * 0.85, rand());
  else if (key === 'desk') {
    g.save();
    g.translate(x, y);
    g.rotate(rand() * Math.PI);
    g.fillStyle = '#f2c14e';
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.beginPath();
    g.rect(-r, -r * 0.28, r * 1.5, r * 0.56);
    g.fill(); g.stroke();
    g.beginPath();
    g.moveTo(r * 0.5, -r * 0.28); g.lineTo(r * 1.1, 0); g.lineTo(r * 0.5, r * 0.28);
    g.fillStyle = '#e6c79a';
    g.fill(); g.stroke();
    g.restore();
  } else daisy(g, x, y, r, rand);
}

// Per chapter: the land plates on the left page (fill, halftone), the title's plate colours.
const CHAPTER_LOOK = {
  meadow: { title: ['#f2c14e', '#e56b6f', '#8fb3d9', '#9cc56b'], burst: 'rgba(242,193,78,0.28)' },
  bosphorus: { title: ['#f2c14e', '#e56b6f', '#7fb0d6', '#b39ad6'], burst: 'rgba(95,127,163,0.24)' },
  glacier: { title: ['#f29fb5', '#8fb3d9', '#f2c14e', '#9fd6c2'], burst: 'rgba(143,179,217,0.28)' },
  desk: { title: ['#e8534a', '#4d7fc4', '#f2c14e', '#7cc27a'], burst: 'rgba(232,83,74,0.18)' },
};

function landPlates(key, g, P, rand) {
  const blob = (x, z, rx, rz, fill, dots, ticks) => {
    const [cx, cy] = P(x, z);
    const path = (gg) => blobPath(gg, cx, cy, rx * PX_PER_M, rz * PX_PER_M, mulberry32(Math.round(x * 97 + z * 31)));
    printShape(g, path, fill, { line: 3 });
    halftone(g, path, dots, 13, (px, py) => 0.25 + 0.55 * Math.max(0, Math.min(1, (py - cy) / (rz * PX_PER_M) + 0.3)));
    if (ticks) grassTicks(g, cx - rx * 50, cy - rz * 30, rx * 100, rz * 60, 10, rand);
  };
  if (key === 'bosphorus') {
    // the strait: a band of water with printed wave strokes, the far shore's skyline and the moon
    for (const [x, z, rx, rz] of [[-8.4, 4.6, 4.2, 2.2], [-3.2, 6.2, 3.6, 1.9], [-10.2, 7.4, 2.4, 1.3]]) blob(x, z, rx, rz, '#8aa1cf', '#3d4f86', false);
    g.save();
    g.strokeStyle = INK;
    g.globalAlpha = 0.5;
    g.lineWidth = 2.5;
    for (let i = 0; i < 26; i++) {
      const [px, py] = P(-11 + rand() * 10, 3.2 + rand() * 4.6);
      g.beginPath();
      g.arc(px, py, 9, Math.PI * 1.1, Math.PI * 1.9);
      g.arc(px + 17, py, 9, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
    }
    g.restore();
    const [sx, sy] = P(-11.4, 1.6);
    const sky = (gg) => {
      gg.beginPath();
      gg.moveTo(sx, sy);
      const pts = [[0, -30], [60, -30], [60, -70], [95, -95], [130, -70], [130, -30], [150, -30], [152, -150], [158, -150], [160, -30],
        [230, -30], [230, -52], [290, -85], [350, -52], [350, -30], [372, -30], [374, -170], [380, -170], [382, -30], [460, -30], [460, -46],
        [520, -46], [520, -30], [600, -30], [600, 0]];
      for (const [dx, dy] of pts) gg.lineTo(sx + dx, sy + dy);
      gg.closePath();
    };
    printShape(g, sky, '#9a88c4', { line: 3 });
    g.fillStyle = '#f2c14e';
    for (let i = 0; i < 14; i++) g.fillRect(sx + 20 + rand() * 560, sy - 26 + rand() * 18, 7, 9);
    const [mx, my] = P(-3.4, -0.2);
    printShape(g, (gg) => { gg.beginPath(); gg.arc(mx, my, 46, 0, Math.PI * 2); gg.arc(mx + 22, my - 12, 40, 0, Math.PI * 2, true); }, '#f2c14e', { line: 3 });
  } else if (key === 'glacier') {
    // a range of snowy peaks and a stand of pines
    for (const [x, z, w, h] of [[-9.6, 2.6, 3.2, 2.9], [-6.4, 2.0, 3.8, 3.6], [-2.8, 2.4, 3.0, 2.6]]) {
      const [cx, cy] = P(x, z);
      const W = w * PX_PER_M / 2, Hh = h * PX_PER_M;
      const path = (gg) => { gg.beginPath(); gg.moveTo(cx - W, cy); gg.lineTo(cx - W * 0.15, cy - Hh); gg.lineTo(cx + W * 0.1, cy - Hh * 0.92); gg.lineTo(cx + W, cy); gg.closePath(); };
      printShape(g, path, '#bcd0ea', { line: 3 });
      halftone(g, path, '#6f86b8', 12, (px, py) => 0.2 + 0.6 * Math.max(0, (py - (cy - Hh)) / Hh - 0.35));
      const cap = (gg) => { gg.beginPath(); gg.moveTo(cx - W * 0.46, cy - Hh * 0.62); gg.lineTo(cx - W * 0.15, cy - Hh); gg.lineTo(cx + W * 0.1, cy - Hh * 0.92); gg.lineTo(cx + W * 0.4, cy - Hh * 0.6); gg.lineTo(cx + W * 0.1, cy - Hh * 0.7); gg.lineTo(cx - W * 0.12, cy - Hh * 0.56); gg.closePath(); };
      printShape(g, cap, '#fbf6e9', { line: 2.5 });
    }
    for (let i = 0; i < 9; i++) {
      const [px, py] = P(-10.8 + i * 1.15 + rand() * 0.4, 5.6 + rand() * 2.2);
      const s = 34 + rand() * 20;
      printShape(g, (gg) => { gg.beginPath(); gg.moveTo(px, py - s * 1.6); gg.lineTo(px + s * 0.6, py); gg.lineTo(px - s * 0.6, py); gg.closePath(); }, '#5f9a7a', { line: 2.5 });
    }
  } else if (key === 'desk') {
    // a ruled notebook page with a margin, a paper clip and a coffee ring
    g.save();
    g.strokeStyle = 'rgba(95,127,163,0.55)';
    g.lineWidth = 2;
    for (let y = 300; y < g.canvas.height - 90; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(g.canvas.width, y); g.stroke(); }
    g.strokeStyle = 'rgba(217,72,59,0.65)';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(120, 280); g.lineTo(120, g.canvas.height); g.stroke();
    const [cx, cy] = P(-3.6, 5.4);
    g.strokeStyle = 'rgba(122,82,54,0.35)';
    g.lineWidth = 14;
    g.beginPath(); g.arc(cx, cy, 120, 0.3, Math.PI * 2.1); g.stroke();
    const [kx, ky] = P(-9.8, 2.2);
    g.strokeStyle = '#8e96a3';
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(kx, ky + 110); g.lineTo(kx, ky); g.arc(kx + 26, ky, 26, Math.PI, 0); g.lineTo(kx + 52, ky + 130);
    g.arc(kx + 30, ky + 130, 22, 0, Math.PI); g.lineTo(kx + 8, ky + 30);
    g.stroke();
    g.restore();
  } else {
    for (const [x, z, rx, rz] of [[-8.6, 3.2, 3.6, 2.2], [-3.6, 5.8, 3.2, 2.1], [-9.8, 6.9, 2.6, 1.5], [-2.2, -0.4, 2.1, 1.3]]) blob(x, z, rx, rz, '#a9cf78', '#6f9a58', true);
  }
}

// chapter: { key (track id), chapter, title }
export function paintLeftPage(c, chapter, halfDepth, seed = 7) {
  const g = c.getContext('2d');
  const H = c.height;
  const rand = mulberry32(seed + chapter.chapter * 101);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, c.width, H);
  const P = (x, z) => toPx(x, z, -12, halfDepth);
  textBlock(g, 70, 64, 880, 7, rand, { lineH: 24 });
  landPlates(chapter.key, g, P, rand);
  // the road: from the front-left corner, past the arch, over the gutter
  const pts = [[-11.5, 8.6], [-10.2, 6.1], [-7.4, 3.9], [-5.2, 1.7], [-3.1, 0.55], [-1.2, 0.4], [0.4, 0.55]].map(([x, z]) => P(x, z));
  road(g, pts);
  for (let i = 0; i < 16; i++) {
    const x = -11.3 + rand() * 10, z = -1.5 + rand() * 9.5;
    const [px, py] = P(x, z);
    motif(chapter.key, g, px, py, 10 + rand() * 9, rand);
  }
  // page number + running rule
  g.fillStyle = INK;
  g.globalAlpha = 0.7;
  g.fillRect(70, H - 58, 300, 3);
  g.globalAlpha = 1;
  drawLettering(g, String(chapter.chapter * 2 + 12), { x: 70, y: H - 18, size: 26, style: 'label', colors: { fill: INK }, seed: 5 });
  return c;
}

export function paintRightPage(c, chapter, halfDepth, seed = 7) {
  const g = c.getContext('2d');
  const H = c.height;
  const look = CHAPTER_LOOK[chapter.key] || CHAPTER_LOOK.meadow;
  const rand = mulberry32(seed + 1 + chapter.chapter * 101);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  {
    const P = (x, z) => toPx(x, z, 0, halfDepth);
    g.fillStyle = PAPER;
    g.fillRect(0, 0, c.width, H);
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
      g.fillStyle = look.burst;
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
    drawLettering(g, `${chapter.chapter}. Bölüm`, { x: hx, y: hy - 58, size: 28, style: 'label', colors: { fill: '#d9483b', shadow: 'rgba(45,42,50,0.35)' }, seed: 3 });
    drawLettering(g, chapter.title, { x: hx, y: hy + 4, size: 62, style: 'cut', seed: 11 + chapter.chapter,
      colors: { fill: look.title, shadow: INK } });
    textBlock(g, 70, P(0, 6.1)[1], 560, 5, rand, { lineH: 24 });
    for (let i = 0; i < 7; i++) {
      const [px, py] = P(7.4 + rand() * 3.4, 5.6 + rand() * 2.2);
      motif(chapter.key, g, px, py, 9 + rand() * 7, rand);
    }
    g.fillStyle = INK;
    g.globalAlpha = 0.7;
    g.fillRect(1024 - 370, H - 58, 300, 3);
    g.globalAlpha = 1;
    drawLettering(g, String(chapter.chapter * 2 + 13), { x: 1024 - 70, y: H - 18, size: 26, style: 'label', align: 'right', colors: { fill: INK }, seed: 6 });
  }
  return c;
}

export function pageCanvas(halfDepth, scale = 1) {
  return canvas(Math.round(1024 * scale), Math.round(halfDepth * 2 * PX_PER_M * scale));
}

// Opening spread for one chapter: left and right prints plus the faint copy under the lifting corner.
export function paintPages({ halfDepth, chapter, seed = 7 }) {
  const left = paintLeftPage(pageCanvas(halfDepth), chapter, halfDepth, seed);
  const right = paintRightPage(pageCanvas(halfDepth), chapter, halfDepth, seed);
  const under = canvas(512, Math.round(left.height / 2));
  const g = under.getContext('2d');
  const rand = mulberry32(seed + 2);
  g.fillStyle = '#efe5cd';
  g.fillRect(0, 0, under.width, under.height);
  for (let b = 0; b < 4; b++) textBlock(g, 34, 40 + b * 170, 440, 5, rand, { lineH: 12, bar: 4, alpha: 0.3, indent: 16 });
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

// ---------------------------------------------------------------------------------------------
// Front cover of the closed book: bookcloth with a gold-stamped frame, the title in pasted cut-paper
// letters and a cut-paper kart collage. Canvas left = the spine, top = the far edge of the book.

const CLOTH = '#2e4f58';
const GOLD_INK = '#d8ad4c';

// A scissor-cut outline: every vertex nudged a little, deterministic per piece.
function cutPts(pts, rand, j = 2.2) {
  return pts.map(([x, y]) => [x + (rand() - 0.5) * j, y + (rand() - 0.5) * j]);
}

function facetCircle(cx, cy, r, n, rand, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const k = 1 + (rand() - 0.5) * 0.05;
    pts.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k]);
  }
  return pts;
}

function polyPath(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

// One pasted paper piece: its colour plate, a halftone shade toward its lower edge and a pale cut rim.
function pastePiece(g, pts, fill, { shade = 'rgba(45,42,50,0.28)', shadeFrom = 0.45, rim = 'rgba(251,246,233,0.55)' } = {}) {
  let y0 = Infinity, y1 = -Infinity;
  for (const [, y] of pts) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  polyPath(g, pts);
  g.fillStyle = fill;
  g.fill();
  if (shade) {
    const h = Math.max(1, y1 - y0);
    halftone(g, (gg) => polyPath(gg, pts), shade, 7, (x, y) => Math.max(0, (y - y0) / h - shadeFrom) * 1.5);
  }
  if (rim) {
    polyPath(g, pts);
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.strokeStyle = rim;
    g.stroke();
  }
}

// The player's fox in a kart, facing right, as a collage of cut pieces around (0, 0).
function kartCollage(g, x, y, s, seed = 5) {
  const rand = mulberry32(seed);
  const pieces = [];
  const P = (pts, fill, opts) => pieces.push({ pts: cutPts(pts.map(([px, py]) => [x + px * s, y + py * s]), rand, 2.4), fill, opts });
  const C = (cx, cy, r, n, fill, opts) => pieces.push({ pts: facetCircle(x + cx * s, y + cy * s, r * s, n, rand, rand()), fill, opts });
  // speed strips and puffs behind
  P([[-330, -64], [-205, -70], [-200, -52], [-326, -48]], '#fbf6e9', { shade: null });
  P([[-372, -12], [-215, -16], [-212, 2], [-368, 6]], '#fbf6e9', { shade: null });
  P([[-318, 44], [-235, 40], [-232, 56], [-314, 60]], '#fbf6e9', { shade: null });
  C(-262, 18, 17, 9, '#efe4c8', { shade: null });
  C(-292, 28, 11, 8, '#efe4c8', { shade: null });
  // scarf streaming back
  P([[-38, -104], [-150, -126], [-196, -104], [-168, -96], [-204, -80], [-120, -86], [-30, -84]], '#f2c14e');
  // seat back, body, nose
  P([[-120, -58], [-92, -118], [-56, -116], [-70, -40]], '#b93c22');
  P([[-232, 34], [-238, -14], [-196, -46], [-58, -52], [-36, -30], [46, -34], [150, -26], [246, -6], [258, 24], [238, 44]], '#e8552b', { shadeFrom: 0.35 });
  P([[-218, 4], [230, 2], [236, 18], [-222, 20]], '#fbf1df', { shade: null });
  C(38, -6, 30, 12, '#fbf1df', { shade: null });
  // wheels
  C(-146, 50, 64, 14, '#2e2b33', { shade: null, rim: 'rgba(251,246,233,0.35)' });
  C(-146, 50, 27, 10, '#fbf1df', { shade: null });
  C(170, 58, 52, 13, '#2e2b33', { shade: null, rim: 'rgba(251,246,233,0.35)' });
  C(170, 58, 22, 9, '#fbf1df', { shade: null });
  // the fox: head, ears, muzzle
  P([[-78, -96], [-86, -150], [-40, -188], [10, -168], [26, -128], [-6, -92]], '#e8792e', { shadeFrom: 0.5 });
  P([[-74, -158], [-86, -228], [-38, -178]], '#e8792e', { shade: null });
  P([[-30, -176], [-16, -242], [8, -164]], '#e8792e', { shade: null });
  P([[-80, -212], [-86, -228], [-66, -196]], '#2e2b33', { shade: null, rim: null });
  P([[-20, -222], [-16, -242], [-6, -206]], '#2e2b33', { shade: null, rim: null });
  P([[-6, -142], [66, -128], [60, -116], [-2, -104]], '#fbf1df', { shade: null });
  P([[48, -136], [72, -128], [52, -118]], '#2e2b33', { shade: null, rim: null });
  // steering wheel
  P([[40, -92], [64, -66], [56, -60], [32, -86]], '#2e2b33', { shade: null, rim: null });

  // one hard offset shadow for the whole collage, then the pieces in order
  g.save();
  g.translate(10 * s + 4, 12 * s + 5);
  g.fillStyle = 'rgba(8,20,24,0.62)';
  for (const p of pieces) { polyPath(g, p.pts); g.fill(); }
  g.restore();
  for (const p of pieces) pastePiece(g, p.pts, p.fill, p.opts);
  // printed details: eye, number
  g.fillStyle = INK;
  g.beginPath();
  g.arc(x + 2 * s, y - 150 * s, 7 * s, 0, Math.PI * 2);
  g.fill();
  drawLettering(g, '1', { x: x + 38 * s, y: y + 12 * s, size: 48 * s, style: 'label', align: 'center', seed: 12, colors: { fill: INK, shadow: 'rgba(45,42,50,0.2)' } });
}

function goldRule(g, cx, y, w) {
  g.save();
  g.strokeStyle = GOLD_INK;
  g.fillStyle = GOLD_INK;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(cx - w / 2, y); g.lineTo(cx - 34, y);
  g.moveTo(cx + 34, y); g.lineTo(cx + w / 2, y);
  g.stroke();
  g.beginPath();
  g.moveTo(cx, y - 15); g.lineTo(cx + 15, y); g.lineTo(cx, y + 15); g.lineTo(cx - 15, y);
  g.closePath();
  g.fill();
  for (const dx of [-26, 26]) { g.beginPath(); g.arc(cx + dx, y, 4.5, 0, Math.PI * 2); g.fill(); }
  g.restore();
}

// Gold foil text: the stamped face, a dark edge where the tool pressed into the cloth, a faint catch-light.
function goldText(g, text, x, y, size, spacing) {
  g.save();
  g.font = `800 ${size}px system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  if ('letterSpacing' in g) g.letterSpacing = `${spacing}px`;
  g.fillStyle = 'rgba(8,20,24,0.7)';
  g.fillText(text, x + 2, y + 3);
  g.fillStyle = GOLD_INK;
  g.fillText(text, x, y);
  g.globalAlpha = 0.35;
  g.fillStyle = '#fff0c0';
  g.fillText(text, x - 1, y - 1);
  g.restore();
}

export function paintCover(aspect, seed = 17) {
  const W = 1152, H = Math.round(W / aspect);
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const rand = mulberry32(seed);
  // bookcloth: plain weave, a little rubbed toward the edges
  g.fillStyle = CLOTH;
  g.fillRect(0, 0, W, H);
  g.save();
  g.globalAlpha = 0.08;
  g.fillStyle = '#000';
  for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
  g.fillStyle = '#fff';
  g.globalAlpha = 0.045;
  for (let x = 0; x < W; x += 3) g.fillRect(x, 0, 1, H);
  g.restore();
  g.save();
  g.globalAlpha = 0.05;
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rand() < 0.5 ? '#000' : '#fff';
    g.fillRect(rand() * W, rand() * H, 2 + rand() * 5, 1);
  }
  g.restore();
  const vg = g.createRadialGradient(W * 0.55, H * 0.45, W * 0.3, W * 0.55, H * 0.45, W * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.26)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
  // the hinge groove beside the spine
  const hx = W * 0.075;
  g.fillStyle = 'rgba(8,20,24,0.45)';
  g.fillRect(hx - 5, 0, 7, H);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(hx + 2, 0, 4, H);
  const sp = g.createLinearGradient(0, 0, hx, 0);
  sp.addColorStop(0, 'rgba(0,0,0,0.35)');
  sp.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sp;
  g.fillRect(0, 0, hx, H);

  // gold-stamped double frame with corner lozenges
  const fx0 = W * 0.13, fx1 = W * 0.94, fy0 = H * 0.045, fy1 = H * 0.955;
  g.save();
  g.strokeStyle = 'rgba(8,20,24,0.6)';
  g.lineWidth = 6;
  g.strokeRect(fx0 + 2, fy0 + 3, fx1 - fx0, fy1 - fy0);
  g.strokeStyle = GOLD_INK;
  g.lineWidth = 5;
  g.strokeRect(fx0, fy0, fx1 - fx0, fy1 - fy0);
  g.lineWidth = 2.5;
  g.strokeRect(fx0 + 16, fy0 + 16, fx1 - fx0 - 32, fy1 - fy0 - 32);
  g.fillStyle = GOLD_INK;
  for (const [cx, cy] of [[fx0, fy0], [fx1, fy0], [fx0, fy1], [fx1, fy1]]) {
    g.beginPath();
    g.moveTo(cx, cy - 22); g.lineTo(cx + 22, cy); g.lineTo(cx, cy + 22); g.lineTo(cx - 22, cy);
    g.closePath();
    g.fill();
  }
  g.restore();

  const cx = (fx0 + fx1) / 2;
  goldText(g, 'AÇILIR KİTAP YARIŞI', cx, H * 0.125, 34, 11);
  goldRule(g, cx, H * 0.155, W * 0.42);
  const fills = ['#f2c14e', '#d9483b', '#8fb3d9', '#e56b6f', '#faf4e4', '#9cc56b', '#f2c14e', '#d9483b', '#8fb3d9'];
  drawLettering(g, 'Kâğıt', { x: cx, y: H * 0.37, size: 214, style: 'cut', align: 'center', seed: 7,
    colors: { fill: fills.slice(0, 5), shadow: '#10232a' } });
  drawLettering(g, 'Kart', { x: cx + 12, y: H * 0.535, size: 214, style: 'cut', align: 'center', seed: 8,
    colors: { fill: fills.slice(5), shadow: '#10232a' } });
  goldRule(g, cx, H * 0.595, W * 0.5);
  kartCollage(g, cx + 20, H * 0.775, 1.12);
  goldText(g, '4 BÖLÜM · 8 SÜRÜCÜ', cx, H * 0.915, 26, 8);
  return c;
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
