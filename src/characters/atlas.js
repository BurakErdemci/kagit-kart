// Per-character paper atlas: one cell per swatch. Each cell = printed interior + a crease strip
// (base colour at the top fading to a darker fold at the bottom) that paperkit maps onto the band
// along every fold. Prints use two plates (colour fill, ink key line) deliberately out of register.
import * as THREE from 'three';

const SIZE = 512;
const CELL = 64;
const GRID = SIZE / CELL;
const GUT = 3;
const MISREG = [1.7, 1.2];

function rgb(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}
// THREE.Color stores linear values; convert back to sRGB bytes for canvas painting.
function css(hex, k = 1) {
  const c = new THREE.Color(hex);
  c.r *= 1; // keep linear
  const s = c.clone().convertLinearToSRGB();
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * 255 * k)));
  return `rgb(${f(s.r)},${f(s.g)},${f(s.b)})`;
}
function cssMix(a, b, t) {
  const A = new THREE.Color(a).convertLinearToSRGB(), B = new THREE.Color(b).convertLinearToSRGB();
  const f = (x, y) => Math.round((x + (y - x) * t) * 255);
  return `rgb(${f(A.r, B.r)},${f(A.g, B.g)},${f(A.b, B.b)})`;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const INK = '#2b2830';

// ---- print patterns: (g, x, y, w, h, s, rnd) with s = cell scale (1 for a 64 px cell) ----

function star(g, cx, cy, r, points = 5, inner = 0.45) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
}

// Two-plate print: fill (offset) then key line.
function plates(g, path, fill, lineAlpha = 0.55, lw = 1) {
  g.save();
  g.translate(MISREG[0], MISREG[1]);
  path(); g.fillStyle = fill; g.fill();
  g.restore();
  path(); g.globalAlpha = lineAlpha; g.strokeStyle = INK; g.lineWidth = lw; g.stroke(); g.globalAlpha = 1;
}

const PATTERNS = {
  dots(g, x, y, w, h, s, rnd, sp) {
    const step = 13 * s;
    for (let j = 0, yy = y + step / 2; yy < y + h + step; yy += step, j++) {
      for (let xx = x + (j % 2 ? step / 2 : 0); xx < x + w + step; xx += step) {
        plates(g, () => { g.beginPath(); g.arc(xx, yy, 3.4 * s, 0, Math.PI * 2); }, sp.p2);
      }
    }
  },
  stripes(g, x, y, w, h, s, rnd, sp) {
    g.save(); g.translate(MISREG[0], MISREG[1]); g.fillStyle = sp.p2;
    for (let k = -h; k < w + h; k += 16 * s) {
      g.beginPath(); g.moveTo(x + k, y + h); g.lineTo(x + k + 6 * s, y + h); g.lineTo(x + k + 6 * s + h, y); g.lineTo(x + k + h, y); g.closePath(); g.fill();
    }
    g.restore();
  },
  chevrons(g, x, y, w, h, s, rnd, sp) {
    const step = 14 * s;
    for (let yy = y + step * 0.8; yy < y + h + step; yy += step) {
      plates(g, () => {
        g.beginPath();
        g.moveTo(x + w * 0.18, yy + 5 * s); g.lineTo(x + w / 2, yy - 4 * s); g.lineTo(x + w * 0.82, yy + 5 * s);
        g.lineTo(x + w * 0.82, yy + 9 * s); g.lineTo(x + w / 2, yy); g.lineTo(x + w * 0.18, yy + 9 * s); g.closePath();
      }, sp.p2, 0.45);
    }
  },
  hex(g, x, y, w, h, s, rnd, sp) {
    const r = 7 * s, dx = r * Math.sqrt(3), dy = r * 1.5;
    for (let j = 0, yy = y; yy < y + h + r; yy += dy, j++) {
      for (let xx = x + (j % 2 ? dx / 2 : 0); xx < x + w + r; xx += dx) {
        const path = () => {
          g.beginPath();
          for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; g.lineTo(xx + Math.cos(a) * r * 0.9, yy + Math.sin(a) * r * 0.9); }
          g.closePath();
        };
        if (rnd() < 0.35) plates(g, path, sp.p2, 0.5);
        else { path(); g.globalAlpha = 0.4; g.strokeStyle = INK; g.lineWidth = 1; g.stroke(); g.globalAlpha = 1; }
      }
    }
  },
  stars(g, x, y, w, h, s, rnd, sp) {
    const n = Math.round((w * h) / (190 * s * s));
    for (let i = 0; i < n; i++) {
      const cx = x + rnd() * w, cy = y + rnd() * h, r = (2.5 + rnd() * 3) * s;
      plates(g, () => star(g, cx, cy, r), sp.p2, 0.5);
    }
  },
  snow(g, x, y, w, h, s, rnd, sp) {
    const step = 15 * s;
    for (let j = 0, yy = y + step / 2; yy < y + h + step; yy += step, j++) {
      for (let xx = x + (j % 2 ? step / 2 : 0); xx < x + w + step; xx += step) {
        const r = 4.2 * s;
        g.save(); g.translate(MISREG[0], MISREG[1]);
        g.strokeStyle = sp.p2; g.lineWidth = 1.8 * s; g.beginPath();
        for (let i = 0; i < 3; i++) { const a = (i * Math.PI) / 3; g.moveTo(xx - Math.cos(a) * r, yy - Math.sin(a) * r); g.lineTo(xx + Math.cos(a) * r, yy + Math.sin(a) * r); }
        g.stroke(); g.restore();
      }
    }
  },
  paws(g, x, y, w, h, s, rnd, sp) {
    const step = 17 * s;
    for (let j = 0, yy = y + step / 2; yy < y + h + step; yy += step, j++) {
      for (let xx = x + (j % 2 ? step / 2 : 0); xx < x + w + step; xx += step) {
        plates(g, () => {
          g.beginPath(); g.ellipse(xx, yy + 1.5 * s, 3.2 * s, 2.6 * s, 0, 0, Math.PI * 2);
          for (let k = 0; k < 4; k++) { const a = -Math.PI * (0.2 + k * 0.2); const cx = xx + Math.cos(a) * 5 * s, cy = yy + Math.sin(a) * 5 * s; g.moveTo(cx + 1.3 * s, cy); g.arc(cx, cy, 1.3 * s, 0, Math.PI * 2); }
        }, sp.p2, 0.35);
      }
    }
  },
  bubbles(g, x, y, w, h, s, rnd, sp) {
    const n = Math.round((w * h) / (150 * s * s));
    for (let i = 0; i < n; i++) {
      const cx = x + rnd() * w, cy = y + rnd() * h, r = (1.5 + rnd() * 4) * s;
      g.save(); g.translate(MISREG[0], MISREG[1]); g.strokeStyle = sp.p2; g.lineWidth = 1.6 * s;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); g.restore();
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(cx - r * 0.35, cy - r * 0.35, Math.max(0.8, r * 0.25), 0, Math.PI * 2); g.fill();
    }
  },
  ripples(g, x, y, w, h, s, rnd, sp) {
    for (let i = 0; i < 3; i++) {
      const cx = x + rnd() * w, cy = y + rnd() * h;
      g.save(); g.translate(MISREG[0], MISREG[1]); g.strokeStyle = sp.p2; g.lineWidth = 1.7 * s;
      for (let r = 4 * s; r < 26 * s; r += 6 * s) { g.beginPath(); g.arc(cx, cy, r, 0.2, Math.PI * 1.3); g.stroke(); }
      g.restore();
    }
  },
  feathers(g, x, y, w, h, s, rnd, sp) {
    const step = 10 * s;
    for (let j = 0, yy = y + 4 * s; yy < y + h + step; yy += step * 0.8, j++) {
      for (let xx = x + (j % 2 ? step / 2 : 0); xx < x + w + step; xx += step) {
        g.save(); g.translate(MISREG[0], MISREG[1]); g.strokeStyle = sp.p2; g.lineWidth = 1.5 * s;
        g.beginPath(); g.arc(xx, yy, step / 2, 0.1, Math.PI - 0.1); g.stroke(); g.restore();
      }
    }
  },
  tread(g, x, y, w, h, s, rnd, sp) {
    g.fillStyle = sp.p2;
    for (let yy = y + 3 * s; yy < y + h; yy += 9 * s) g.fillRect(x, yy, w, 3 * s);
  },
  spots(g, x, y, w, h, s, rnd, sp) {
    const n = Math.round((w * h) / (220 * s * s));
    for (let i = 0; i < n; i++) {
      const cx = x + rnd() * w, cy = y + rnd() * h, r = (2 + rnd() * 3.5) * s;
      plates(g, () => { g.beginPath(); g.ellipse(cx, cy, r, r * (0.7 + rnd() * 0.3), rnd() * 3, 0, Math.PI * 2); }, sp.p2, 0.25);
    }
  },
  ridges(g, x, y, w, h, s, rnd, sp) {
    g.strokeStyle = sp.p2; g.lineWidth = 1.5 * s;
    for (let yy = y + 5 * s; yy < y + h; yy += 7 * s) {
      const x0 = x + rnd() * w * 0.4, x1 = x0 + w * (0.25 + rnd() * 0.35);
      g.beginPath(); g.moveTo(x0, yy); g.lineTo(x1, yy + rnd() * 2 * s); g.stroke();
    }
  },
  veins(g, x, y, w, h, s, rnd, sp) {
    const cx = x + w / 2, cy = y + h / 2;
    g.strokeStyle = sp.p2; g.lineWidth = 1.4 * s;
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * w, cy + Math.sin(a) * h); g.stroke();
    }
  },
  suckers(g, x, y, w, h, s, rnd, sp) {
    const step = 11 * s;
    for (let j = 0, yy = y + step / 2; yy < y + h + step; yy += step, j++) {
      for (let xx = x + (j % 2 ? step / 2 : 0); xx < x + w + step; xx += step) {
        plates(g, () => { g.beginPath(); g.arc(xx, yy, 3.2 * s, 0, Math.PI * 2); }, sp.p2, 0.3);
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.arc(xx + MISREG[0], yy + MISREG[1], 1.2 * s, 0, Math.PI * 2); g.fill();
      }
    }
  },
};

// ---- art: (g, x, y, w, h, sp) painted into the interior rect ----

function symbol(g, name, cx, cy, r) {
  g.beginPath();
  switch (name) {
    case 'flame': // fox: a leaping flame / brush tip
      g.moveTo(cx, cy - r);
      g.bezierCurveTo(cx + r * 0.9, cy - r * 0.2, cx + r * 0.7, cy + r * 0.9, cx, cy + r);
      g.bezierCurveTo(cx - r * 0.7, cy + r * 0.9, cx - r * 0.9, cy + r * 0.1, cx - r * 0.3, cy - r * 0.2);
      g.bezierCurveTo(cx - r * 0.2, cy + r * 0.2, cx + r * 0.1, cy + r * 0.1, cx, cy - r);
      break;
    case 'drop':
      g.moveTo(cx, cy - r);
      g.bezierCurveTo(cx + r * 0.2, cy - r * 0.4, cx + r * 0.8, cy + r * 0.1, cx + r * 0.75, cy + r * 0.45);
      g.arc(cx, cy + r * 0.4, r * 0.75, 0, Math.PI);
      g.bezierCurveTo(cx - r * 0.8, cy + r * 0.1, cx - r * 0.2, cy - r * 0.4, cx, cy - r);
      break;
    case 'snow':
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3, c = Math.cos(a), s = Math.sin(a);
        const px = -s * r * 0.14, py = c * r * 0.14;
        g.moveTo(cx + px, cy + py); g.lineTo(cx + c * r + px, cy + s * r + py); g.lineTo(cx + c * r - px, cy + s * r - py); g.lineTo(cx - px, cy - py);
      }
      break;
    case 'hex':
      for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.95); }
      g.closePath();
      break;
    case 'fish':
      g.ellipse(cx - r * 0.15, cy, r * 0.7, r * 0.42, 0, 0, Math.PI * 2);
      g.moveTo(cx + r * 0.45, cy); g.lineTo(cx + r, cy - r * 0.45); g.lineTo(cx + r, cy + r * 0.45); g.closePath();
      break;
    case 'moon':
      g.arc(cx, cy, r, Math.PI * 0.35, Math.PI * 1.65);
      g.arc(cx + r * 0.45, cy - r * 0.1, r * 0.78, Math.PI * 1.45, Math.PI * 0.55, true);
      g.closePath();
      break;
    case 'carrot':
      g.moveTo(cx - r * 0.35, cy - r * 0.45); g.lineTo(cx + r * 0.35, cy - r * 0.45); g.lineTo(cx, cy + r); g.closePath();
      g.moveTo(cx, cy - r * 0.45); g.lineTo(cx - r * 0.35, cy - r); g.lineTo(cx - r * 0.05, cy - r * 0.5);
      g.lineTo(cx + r * 0.3, cy - r * 1.0); g.lineTo(cx + r * 0.1, cy - r * 0.45); g.closePath();
      break;
    case 'swirl': {
      const turns = 2.2, steps = 40;
      for (let i = 0; i <= steps; i++) { const t = i / steps, a = t * turns * Math.PI * 2, rr = r * t; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      for (let i = steps; i >= 0; i--) { const t = i / steps, a = t * turns * Math.PI * 2, rr = r * t * 0.72; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      g.closePath();
      break;
    }
    default:
      star(g, cx, cy, r);
  }
}

const ARTS = {
  hub(g, x, y, w, h, sp) {
    const cx = x + w / 2, cy = y + h / 2, R = Math.min(w, h) / 2;
    plates(g, () => { g.beginPath(); g.arc(cx, cy, R * 0.8, 0, Math.PI * 2); }, sp.a, 0.7, 1.2);
    plates(g, () => { g.beginPath(); g.arc(cx, cy, R * 0.52, 0, Math.PI * 2); }, sp.b, 0.6);
    g.save(); g.translate(MISREG[0] * 0.5, 0); g.strokeStyle = INK; g.lineWidth = 2.2;
    for (let i = 0; i < 5; i++) { const a = (i * Math.PI * 2) / 5; g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.18, cy + Math.sin(a) * R * 0.18); g.lineTo(cx + Math.cos(a) * R * 0.5, cy + Math.sin(a) * R * 0.5); g.stroke(); }
    g.restore();
    g.fillStyle = INK; g.beginPath(); g.arc(cx, cy, R * 0.16, 0, Math.PI * 2); g.fill();
  },
  steer(g, x, y, w, h, sp) {
    const cx = x + w / 2, cy = y + h / 2, R = Math.min(w, h) / 2;
    g.fillStyle = INK; g.beginPath(); g.arc(cx, cy, R * 0.95, 0, Math.PI * 2); g.fill();
    g.fillStyle = sp.b; g.beginPath(); g.arc(cx, cy, R * 0.72, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK; g.lineWidth = 4;
    for (let i = 0; i < 3; i++) { const a = Math.PI / 2 + (i * Math.PI * 2) / 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R * 0.75, cy + Math.sin(a) * R * 0.75); g.stroke(); }
    plates(g, () => { g.beginPath(); g.arc(cx, cy, R * 0.26, 0, Math.PI * 2); }, sp.a, 0.8);
  },
  emblem(g, x, y, w, h, sp) {
    const cx = x + w / 2, cy = y + h / 2, R = Math.min(w, h) * 0.46;
    // paper roundel on a printed band
    g.fillStyle = sp.band; g.fillRect(x, cy - R * 0.5, w, R);
    plates(g, () => { g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); }, sp.disc, 0.8, 1.5);
    plates(g, () => symbol(g, sp.symbol, cx, cy, R * 0.66), sp.a, 0.85, 1.4);
  },
  goggle(g, x, y, w, h, sp) {
    const cx = x + w / 2, cy = y + h / 2, R = Math.min(w, h) / 2;
    g.fillStyle = sp.glass; g.fillRect(x, y, w, h);
    plates(g, () => { g.beginPath(); g.arc(cx, cy + R * 0.05, R * 0.66, 0, Math.PI * 2); }, sp.iris, 0.7, 1.4);
    g.fillStyle = INK; g.beginPath(); g.arc(cx + 1, cy + R * 0.1, R * 0.36, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(cx - R * 0.3, cy - R * 0.28, R * 0.2, R * 0.12, -0.6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R * 0.86, -2.6, -1.9); g.stroke();
  },
  mouth(g, x, y, w, h, sp) {
    g.strokeStyle = INK; g.lineWidth = 2.6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x + w * 0.04, y + h * 0.5); g.quadraticCurveTo(x + w * 0.5, y + h * 0.95, x + w * 0.96, y + h * 0.5); g.stroke();
    g.fillStyle = INK;
    g.beginPath(); g.arc(x + w * 0.42, y + h * 0.18, 1.6, 0, Math.PI * 2); g.arc(x + w * 0.58, y + h * 0.18, 1.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = sp.cheek; g.globalAlpha = 0.5;
    g.beginPath(); g.ellipse(x + w * 0.1, y + h * 0.3, w * 0.07, h * 0.12, 0, 0, Math.PI * 2); g.ellipse(x + w * 0.9, y + h * 0.3, w * 0.07, h * 0.12, 0, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
  },
  porthole(g, x, y, w, h, sp) {
    const cx = x + w / 2, cy = y + h / 2, R = Math.min(w, h) * 0.34;
    for (const dx of [-w * 0.28, 0, w * 0.28]) {
      plates(g, () => { g.beginPath(); g.arc(cx + dx, cy, R, 0, Math.PI * 2); }, sp.a, 0.8, 1.4);
      g.fillStyle = sp.glass; g.beginPath(); g.arc(cx + dx, cy, R * 0.66, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.arc(cx + dx - R * 0.25, cy - R * 0.25, R * 0.18, 0, Math.PI * 2); g.fill();
    }
  },
};

function grain(g, x, y, w, h, rnd) {
  const n = Math.round((w * h) / 22);
  for (let i = 0; i < n; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.07)';
    g.fillRect(x + rnd() * w, y + rnd() * h, 1, 1);
  }
  g.globalAlpha = 0.08;
  g.strokeStyle = '#ffffff';
  for (let i = 0; i < Math.max(1, (w * h) / 900); i++) {
    const x0 = x + rnd() * w, y0 = y + rnd() * h, a = rnd() * Math.PI;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(a) * 7, y0 + Math.sin(a) * 7); g.stroke();
  }
  g.globalAlpha = 1;
}

// spec: { name: { color, pattern?, p2?, art?, cw?, ch?, ...artParams } }
export function paintAtlas(spec, seedKey = 'kk') {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext('2d');
  const rnd = mulberry(hash(seedKey));
  const used = new Uint8Array(GRID * GRID);
  const rects = {};
  const entries = Object.entries({ __fallback: { color: '#ff00ff' }, ...spec })
    .sort((a, b) => ((b[1].cw || 1) * (b[1].ch || 1)) - ((a[1].cw || 1) * (a[1].ch || 1)));

  const fits = (cx, cy, cw, ch) => {
    if (cx + cw > GRID || cy + ch > GRID) return false;
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) if (used[(cy + j) * GRID + cx + i]) return false;
    return true;
  };

  for (const [name, sp] of entries) {
    const cw = sp.cw || 1, chh = sp.ch || 1;
    let slot = null;
    for (let cy = 0; cy < GRID && !slot; cy++) for (let cx = 0; cx < GRID && !slot; cx++) if (fits(cx, cy, cw, chh)) slot = [cx, cy];
    if (!slot) throw new Error('atlas full at ' + name);
    for (let j = 0; j < chh; j++) for (let i = 0; i < cw; i++) used[(slot[1] + j) * GRID + slot[0] + i] = 1;
    const X = slot[0] * CELL, Y = slot[1] * CELL, W = cw * CELL, H = chh * CELL;
    const ix0 = X + GUT, ix1 = X + W - GUT, iy0 = Y + GUT, iy1 = Y + Math.round(H * 0.76);
    const cy0 = Y + Math.round(H * 0.8), cy1 = Y + H - GUT;
    const base = sp.color;

    g.fillStyle = css(base);
    g.fillRect(X, Y, W, H);
    g.save();
    g.beginPath(); g.rect(X, Y, W, iy1 + 2 - Y); g.clip();
    const s = Math.min(W, H) / CELL;
    if (sp.pattern && PATTERNS[sp.pattern]) PATTERNS[sp.pattern](g, ix0 - 4, iy0 - 4, ix1 - ix0 + 8, iy1 - iy0 + 8, s, rnd, sp);
    if (sp.art && ARTS[sp.art]) ARTS[sp.art](g, ix0, iy0, ix1 - ix0, iy1 - iy0, sp);
    grain(g, X, Y, W, iy1 - Y, rnd);
    g.restore();

    // crease strip: base colour at the top, fold at the bottom
    const depth = sp.crease ?? 0.4;
    for (let yy = cy0 - 2; yy <= Y + H; yy++) {
      const t = Math.min(1, Math.max(0, (yy - cy0) / (cy1 - cy0)));
      const k = 1 - depth * Math.pow(t, 1.7) - (t > 0.86 ? 0.07 : 0);
      g.fillStyle = css(base, k);
      g.fillRect(X, yy, W, 1);
    }
    grain(g, X, cy0, W, cy1 - cy0, rnd);

    const U = (px) => px / SIZE, V = (py) => 1 - py / SIZE;
    rects[name] = {
      i: [U(ix0 + 0.5), V(iy1 - 0.5), U(ix1 - 0.5), V(iy0 + 0.5)],
      c: [U(X + GUT + 0.5), V(cy1 - 0.5), U(X + W - GUT - 0.5), V(cy0 + 0.5)],
      aspect: (ix1 - ix0) / (iy1 - iy0),
    };
  }
  return { canvas, rects };
}

export const atlasColor = { css, cssMix, rgb };
