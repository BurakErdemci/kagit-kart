// Cut-paper display lettering, generated entirely in code (ARCHITECTURE.md §13).
//
// Outlines are authored in font units: cap height 700, 1 em = 1000, y up from the baseline.
// Curves are deliberately faceted (scissors cut straight). Every drawn letter is a deterministic
// "cut" of its outline keyed by seed + glyph + position in the string: jittered vertices, long
// cuts bent where the scissors were re-seated, overshoot slits at inside corners, diacritics as
// separately glued pieces, a tilt from a fixed cycle and a hard offset shadow.
//
// Canvas output goes through a per-letter sprite cache (a HUD redraw is a few drawImage calls);
// DOM output is one inline SVG sized in em.

const EM = 1000;
const CAP = 700;
const SB = 45;
const FACET = 95;          // target length of one straight cut along a curve, font units
const ASC = 0.95;          // nominal line box above the baseline (tops of Â Ğ İ Ö Ü), em
const DESC = 0.24;         // below the baseline (Ç Ş cedillas, Q tail, comma), em
const TAB = 0.63;          // tabular digit advance, em
const DEG = Math.PI / 180;
const SPRITE_BUDGET = 6e6; // cached sprite pixels (≈24 MB)
const SPRITE_MAX = 1.5e6;  // a single larger sprite is drawn but not kept

// ------------------------------------------------------------------ outline helpers

function arc(cx, cy, rx, ry, a0, a1) {
  const span = Math.abs(a1 - a0);
  const n = Math.max(2, Math.ceil(span / 30), Math.round(span * DEG * (rx + ry) * 0.5 / FACET));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + (a1 - a0) * i / n) * DEG;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

function P(...n) {
  const pts = [];
  for (let i = 0; i < n.length; i += 2) pts.push([n[i], n[i + 1]]);
  return pts;
}

// Joins points and point lists into one closed contour, dropping repeated points.
function C(...parts) {
  const pts = [];
  const push = (p) => {
    const q = pts[pts.length - 1];
    if (!q || Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) > 0.5) pts.push(p);
  };
  for (const part of parts) {
    if (typeof part[0] === 'number') push(part);
    else for (const p of part) push(p);
  }
  const a = pts[0], z = pts[pts.length - 1];
  if (pts.length > 1 && Math.abs(a[0] - z[0]) + Math.abs(a[1] - z[1]) <= 0.5) pts.pop();
  return pts;
}

const out = (pts) => ({ pts, hole: false });
const hole = (pts) => ({ pts, hole: true });
const poly = (...n) => out(P(...n));
const loop = (e) => C(arc(...e, 0, 360));
const ring = (e, ei) => [out(loop(e)), hole(loop(ei))];
// Open stroke between two concentric ellipses (e = [cx, cy, rx, ry]).
const band = (e, ei, a0, a1) => out(C(arc(...e, a0, a1), arc(...ei, a1, a0)));
const onE = (e, a) => [e[0] + e[2] * Math.cos(a * DEG), e[1] + e[3] * Math.sin(a * DEG)];
const angleOn = (e, p) => Math.atan2((p[1] - e[1]) / e[3], (p[0] - e[0]) / e[2]) / DEG;

function inE(e, p) {
  const u = (p[0] - e[0]) / e[2], v = (p[1] - e[1]) / e[3];
  return u * u + v * v - 1;
}

// Angle on ellipse `a`, between a0 and a1 degrees, where it crosses ellipse `b`.
function meet(a, b, a0, a1) {
  let f0 = inE(b, onE(a, a0));
  for (let i = 0; i < 40; i++) {
    const m = (a0 + a1) / 2, fm = inE(b, onE(a, m));
    if ((fm < 0) === (f0 < 0)) { a0 = m; f0 = fm; } else a1 = m;
  }
  return (a0 + a1) / 2;
}

function seg(x0, y0, x1, y1, w) {
  const L = Math.hypot(x1 - x0, y1 - y0), nx = -(y1 - y0) / L * w / 2, ny = (x1 - x0) / L * w / 2;
  return poly(x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny);
}

const mapC = (cs, f) => cs.map((c) => ({ hole: c.hole, pts: c.pts.map(f) }));

// ------------------------------------------------------------------ glyphs

const GLYPHS = new Map();

function glyph(ch, w, base, marks = [], lsb = SB, rsb = SB) {
  GLYPHS.set(ch, { w, lsb, rsb, pieces: [base, ...marks], kernAs: ch });
}

function compose(ch, from, ...marks) {
  const g = GLYPHS.get(from);
  GLYPHS.set(ch, { ...g, pieces: [...g.pieces, ...marks], kernAs: from });
}

// Diacritics are separate cut pieces; each gets its own small glue-on tilt when drawn.
const dot = (cx) => [poly(cx - 73, 775, cx + 70, 772, cx + 75, 915, cx - 70, 919)];
const breve = (cx) => [band([cx, 912, 165, 142], [cx, 912, 80, 56], 180, 360)];
const circumflex = (cx) => [poly(cx - 195, 770, cx - 92, 770, cx, 856, cx + 92, 770, cx + 195, 770, cx + 58, 935, cx - 58, 935)];
const cedilla = (cx) => {
  const eo = [cx + 15, -130, 95, 88], ei = [cx + 15, -130, 32, 28];
  return [out(C([cx - 42, -24], [cx + 24, -24], arc(...eo, 72, -150), arc(...ei, -150, 100), [cx - 10, -92]))];
};

glyph('A', 640, [poly(0, 0, 157, 0, 210, 170, 430, 170, 483, 0, 640, 0, 420, 700, 220, 700), hole(P(250, 295, 390, 295, 320, 519))]);

{
  const lo = [300, 215, 245, 215], up = [280, 505, 215, 195];
  const a = meet(lo, up, 20, 85), p = onE(lo, a), b = angleOn(up, p);
  glyph('B', 545, [
    out(C([0, 0], [300, 0], arc(...lo, -90, a - 4), [p[0] - 20, p[1]], arc(...up, b + 4, 90), [0, 700])),
    hole(C([150, 125], [300, 125], arc(300, 212.5, 95, 87.5, -90, 90), [150, 300])),
    hole(C([150, 420], [280, 420], arc(280, 497.5, 65, 77.5, -90, 90), [150, 575])),
  ]);
}

glyph('C', 550, [band([315, 350, 315, 350], [315, 350, 165, 225], 42, 318)]);

glyph('D', 580, [
  out(C([0, 0], [280, 0], arc(280, 350, 300, 350, -90, 90), [0, 700])),
  hole(C([150, 125], [280, 125], arc(280, 350, 150, 225, -90, 90), [150, 575])),
]);

glyph('E', 470, [poly(0, 0, 470, 0, 470, 125, 150, 125, 150, 295, 420, 295, 420, 415, 150, 415, 150, 575, 460, 575, 460, 700, 0, 700)]);
glyph('F', 460, [poly(0, 0, 150, 0, 150, 280, 410, 280, 410, 400, 150, 400, 150, 575, 460, 575, 460, 700, 0, 700)]);

{
  const eo = [310, 350, 310, 350], ei = [310, 350, 160, 225];
  const a = 360 + Math.asin(-100 / 225) / DEG; // inner curve level with the bar's underside
  glyph('G', 620, [out(C(arc(...eo, 40, 360), [620, 370], [340, 370], [340, 250], onE(ei, a), arc(...ei, a, 40)))]);
}

glyph('H', 570, [poly(0, 0, 150, 0, 150, 290, 420, 290, 420, 0, 570, 0, 570, 700, 420, 700, 420, 415, 150, 415, 150, 700, 0, 700)]);
glyph('I', 150, [poly(0, 0, 150, 0, 150, 700, 0, 700)]);
glyph('J', 440, [out(C([290, 700], [440, 700], [440, 230], arc(220, 230, 220, 230, 0, -180), [0, 280], [150, 280], arc(220, 230, 70, 105, 180, 360)))]);
glyph('K', 590, [poly(0, 0, 150, 0, 150, 700, 0, 700), poly(60, 142, 590, 700, 380, 700, 60, 363), poly(410, 0, 590, 0, 308, 470, 128, 470)]);
glyph('L', 450, [poly(0, 0, 450, 0, 450, 125, 150, 125, 150, 700, 0, 700)]);
glyph('M', 720, [poly(0, 0, 150, 0, 150, 410, 300, 150, 420, 150, 570, 410, 570, 0, 720, 0, 720, 700, 575, 700, 360, 320, 145, 700, 0, 700)]);
glyph('N', 600, [poly(0, 0, 150, 0, 150, 440, 430, 0, 600, 0, 600, 700, 450, 700, 450, 260, 170, 700, 0, 700)]);
glyph('O', 640, ring([320, 350, 320, 355], [320, 350, 170, 230]));

glyph('P', 520, [
  out(C([0, 0], [150, 0], [150, 250], [290, 250], arc(290, 475, 230, 225, -90, 90), [0, 700])),
  hole(C([150, 375], [290, 375], arc(290, 475, 80, 100, -90, 90), [150, 575])),
]);

glyph('Q', 640, [...ring([320, 350, 320, 355], [320, 350, 170, 230]), seg(420, 200, 630, -70, 145)]);

glyph('R', 560, [
  out(C([0, 0], [150, 0], [150, 260], [280, 260], arc(280, 480, 240, 220, -90, 90), [0, 700])),
  hole(C([150, 385], [280, 385], arc(280, 480, 90, 95, -90, 90), [150, 575])),
  poly(380, 0, 560, 0, 400, 300, 220, 300),
]);

{
  const E1 = [260, 500, 250, 200], E2 = [260, 500, 100, 75], E3 = [260, 212.5, 260, 212.5], E4 = [260, 212.5, 110, 87.5];
  glyph('S', 520, [out(C(arc(...E1, 25, 270), arc(...E4, 90, -155), arc(...E3, -155, 90), arc(...E2, 270, 25)))]);
}

glyph('T', 560, [poly(205, 0, 355, 0, 355, 575, 560, 575, 560, 700, 0, 700, 0, 575, 205, 575)]);
glyph('U', 580, [out(C([0, 700], [0, 260], arc(290, 260, 290, 260, 180, 360), [580, 700], [430, 700], [430, 260], arc(290, 260, 140, 135, 360, 180), [150, 700]))]);
glyph('V', 620, [poly(0, 700, 230, 0, 390, 0, 620, 700, 460, 700, 310, 190, 160, 700)]);
glyph('W', 880, [poly(0, 700, 170, 0, 320, 0, 440, 390, 560, 0, 710, 0, 880, 700, 735, 700, 640, 250, 515, 640, 365, 640, 240, 250, 145, 700)]);
glyph('X', 600, [poly(0, 0, 165, 0, 300, 215, 435, 0, 600, 0, 390, 355, 590, 700, 425, 700, 300, 495, 175, 700, 10, 700, 210, 355)]);
glyph('Y', 600, [poly(225, 0, 375, 0, 375, 300, 600, 700, 435, 700, 300, 445, 165, 700, 0, 700, 225, 300)]);
glyph('Z', 520, [poly(0, 0, 520, 0, 520, 125, 195, 125, 515, 580, 515, 700, 15, 700, 15, 575, 320, 575, 0, 120)]);

glyph('0', 520, ring([260, 350, 260, 355], [260, 350, 110, 230]));
glyph('1', 300, [poly(145, 0, 300, 0, 300, 700, 185, 700, 0, 590, 42, 460, 145, 520)], [], 20, 60);

{
  const eo = [260, 470, 255, 230], ei = [260, 470, 105, 105];
  glyph('2', 520, [out(C([0, 0], [520, 0], [520, 125], [215, 125], arc(...eo, -30, 165), arc(...ei, 165, -35), [0, 125]))]);
}

{
  const E1 = [250, 502.5, 245, 197.5], E2 = [250, 502.5, 95, 72.5], E3 = [255, 215, 255, 215], E4 = [255, 215, 105, 90];
  const a1 = meet(E1, E3, -10, -80), p = onE(E1, a1), a3 = angleOn(E3, p);
  glyph('3', 510, [out(C(arc(...E1, 160, a1 + 5), [p[0] - 30, p[1]], arc(...E3, a3 - 5, -155), arc(...E4, -155, 90),
    [120, 305], [120, 430], arc(...E2, -90, 160)))]);
}

glyph('4', 560, [poly(330, 0, 480, 0, 480, 170, 560, 170, 560, 295, 480, 295, 480, 700, 320, 700, 0, 300, 0, 170, 330, 170), hole(P(175, 295, 330, 295, 330, 490))]);

{
  const eo = [255, 235, 255, 235], ei = [255, 235, 105, 110];
  const aL = Math.acos((45 - 255) / 255) / DEG, aT = Math.acos((195 - 255) / 255) / DEG;
  glyph('5', 510, [out(C([45, 700], onE(eo, aL), arc(...ei, 145, -155), arc(...eo, -155, aT), [195, 575], [480, 575], [480, 700]))]);
}

{
  const E1 = [260, 235, 260, 235], E2 = [260, 235, 110, 110], E3 = [280, 400, 280, 300], E4 = [280, 400, 130, 175];
  const a4 = meet(E4, E1, 150, 175), p = onE(E4, a4), a1 = angleOn(E1, p);
  const six = [out(C(arc(...E3, 45, 180), [0, 235], arc(...E1, 180, 360 + a1), arc(...E4, a4, 45))), hole(loop(E2))];
  glyph('6', 520, six);
  glyph('9', 520, mapC(six, ([x, y]) => [520 - x, 700 - y]));
}

glyph('7', 500, [poly(0, 575, 0, 700, 500, 700, 500, 585, 250, 0, 85, 0, 330, 575)]);
glyph('8', 520, [...ring([260, 502.5, 240, 197.5], [260, 502.5, 90, 72.5]), ...ring([260, 210, 260, 210], [260, 210, 110, 85])]);

glyph('.', 165, [poly(5, 0, 165, 8, 160, 168, 0, 160)]);
glyph(',', 165, [poly(0, 165, 160, 165, 160, 20, 55, -125, 5, -100, 70, 0, 0, 0)]);
glyph(':', 160, [poly(0, 0, 160, 0, 160, 160, 0, 160)], [[poly(0, 380, 160, 380, 160, 540, 0, 540)]]);
glyph('/', 390, [poly(0, -40, 150, -40, 390, 740, 240, 740)]);
glyph('!', 170, [poly(0, 700, 170, 700, 138, 240, 32, 240)], [[poly(10, 0, 160, 0, 160, 150, 10, 150)]]);

{
  const eo = [240, 505, 240, 195], ei = [240, 505, 90, 70];
  glyph('?', 480, [out(C(arc(...eo, 160, -55), [320, 250], [170, 250], [170, 380], arc(...ei, -90, 160)))], [[poly(170, 0, 320, 0, 320, 150, 170, 150)]]);
}

glyph('-', 320, [poly(0, 290, 320, 290, 320, 410, 0, 410)]);
glyph("'", 150, [poly(30, 450, 120, 450, 150, 700, 0, 700)]);
glyph('+', 480, [poly(165, 110, 315, 110, 315, 285, 480, 285, 480, 415, 315, 415, 315, 590, 165, 590, 165, 415, 0, 415, 0, 285, 165, 285)]);

{
  const c = Math.SQRT1_2;
  const plus = P(-245, -68, -68, -68, -68, -245, 68, -245, 68, -68, 245, -68, 245, 68, 68, 68, 68, 245, -68, 245, -68, 68, -245, 68);
  glyph('×', 442, [out(plus.map(([x, y]) => [221 + (x - y) * c, 350 + (x + y) * c]))]);
}

{
  const paren = [band([320, 350, 320, 440], [320, 350, 180, 370], 118, 242)];
  glyph('(', 240, paren);
  glyph(')', 240, mapC(paren, ([x, y]) => [240 - x, y]));
}

glyph('%', 620, [...ring([135, 545, 135, 155], [135, 545, 58, 78]), ...ring([485, 155, 135, 155], [485, 155, 58, 78]), poly(70, 0, 210, 0, 550, 700, 410, 700)]);
GLYPHS.set(' ', { w: 280, lsb: 0, rsb: 0, pieces: [], kernAs: ' ' });

compose('Â', 'A', circumflex(320));
compose('Ç', 'C', cedilla(315));
compose('Ğ', 'G', breve(310));
compose('İ', 'I', dot(75));
compose('Ö', 'O', dot(185), dot(455));
compose('Ş', 'S', cedilla(260));
compose('Ü', 'U', dot(165), dot(415));

const ALIAS = { '’': "'", '‘': "'", 'ʼ': "'", '`': "'", '–': '-', '—': '-', '‐': '-', '·': '.', '\n': ' ', '\t': ' ', ' ': ' ' };

const KERN = new Map(Object.entries({
  AV: -70, VA: -70, AW: -45, WA: -45, AY: -70, YA: -70, AT: -60, TA: -60,
  LT: -80, LV: -70, LY: -80, LW: -50, FA: -50, PA: -55, RT: -20, RV: -25, RY: -30,
  AC: -20, AG: -20, AO: -20, AQ: -20, AU: -15, OA: -25, DA: -25, KO: -20,
  TO: -25, OT: -25, TC: -25, TG: -25, VO: -20, OV: -20, YO: -30, OY: -30,
  'T.': -70, 'Y.': -70, 'V.': -60, 'W.': -40, 'P.': -60, 'F.': -50, '1.': -30, '7.': -60,
  'T,': -70, 'Y,': -70, 'V,': -60, 'P,': -60,
}));

function kern(a, b) {
  return KERN.get(GLYPHS.get(a).kernAs + GLYPHS.get(b).kernAs) || 0;
}

/** Every character the lettering can draw (after Turkish upper-casing). */
export const LETTERING_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÂÇĞİÖŞÜ0123456789' +
  [...GLYPHS.keys()].filter((c) => !/[A-Z0-9ÂÇĞİÖŞÜ]/.test(c)).join('');

// ------------------------------------------------------------------ styles

const STYLES = {
  cut: {
    name: 'cut', jitter: 11, subdiv: 210, slit: 0.5, tilt: 1, wobble: 1, markTilt: 7, markShift: 10, distort: 1, tone: 1,
    shadow: [0.045, 0.06], edge: true, rim: true, plate: [-0.024, -0.018], halftone: true, tracking: 0.035, bleed: 0,
  },
  label: {
    name: 'label', jitter: 3.5, subdiv: 0, slit: 0, tilt: 0.35, wobble: 0.35, markTilt: 3, markShift: 4, distort: 0.3, tone: 0.5,
    shadow: [0.03, 0.04], edge: false, rim: false, plate: [-0.014, -0.01], halftone: false, tracking: 0.025, bleed: 0,
  },
  stamp: {
    name: 'stamp', jitter: 7, subdiv: 90, slit: 0, tilt: 0.6, wobble: 0, markTilt: 2, markShift: 3, distort: 0, tone: 0,
    shadow: null, edge: false, plate: null, halftone: false, tracking: 0.03, bleed: 0.024,
  },
};

const DEFAULTS = { fill: '#d8452c', shadow: '#2a2320', ink: '#2a2320', stamp: '#b3342a' };

// Tilt cycle, degrees: every entry within ±1–6°, signs alternating so neighbours lean apart.
const TILT = [-2.6, 3.8, -1.3, 5.4, -4.2, 1.7, -5.8, 2.5, -3.4, 4.6, -1.9, 6.0];
const WOBBLE = [0.012, -0.016, 0.004, -0.007, 0.018, -0.011, 0.008, -0.019, 0.014, -0.003];

// ------------------------------------------------------------------ determinism

function hash(a, b, c, d) {
  let h = 0x811c9dc5 ^ a;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) ^ b;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) ^ c;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) ^ d;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function seedOf(s) {
  if (typeof s === 'number' && Number.isFinite(s)) return Math.floor(Math.abs(s)) % 100000;
  if (typeof s === 'string') {
    let h = 7;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 100000;
  }
  return 1;
}

// ------------------------------------------------------------------ cutting

const prepared = new Map();

function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

// Outline pieces with outers counter-clockwise and holes clockwise (so overlapping parts of
// one glyph union under the nonzero rule), long edges split for the scissor re-seat bends.
function prepare(ch, st) {
  const key = ch + '|' + st.name;
  let p = prepared.get(key);
  if (p) return p;
  p = GLYPHS.get(ch).pieces.map((piece) => {
    let sx = 0, sy = 0, n = 0;
    const contours = piece.map((c) => {
      const pts = c.pts.slice();
      if ((signedArea(pts) < 0) !== c.hole) pts.reverse();
      const xs = [], ys = [], corner = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        xs.push(a[0]); ys.push(a[1]); corner.push(1);
        sx += a[0]; sy += a[1]; n++;
        if (st.subdiv) {
          const k = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / st.subdiv);
          for (let j = 1; j <= k; j++) {
            const t = j / (k + 1);
            xs.push(a[0] + (b[0] - a[0]) * t); ys.push(a[1] + (b[1] - a[1]) * t); corner.push(0);
          }
        }
      }
      return { xs, ys, corner };
    });
    return { contours, cx: sx / n, cy: sy / n };
  });
  prepared.set(key, p);
  return p;
}

const instances = new Map();
let nextId = 1;

function instance(ch, st, seed, pos, tilt, word) {
  const key = st.name + '|' + seed + '|' + pos + '|' + ch + (tilt ? '|t' : '|f') +
    (word ? '|' + word.angle.toFixed(4) + ',' + word.x.toFixed(3) + ',' + word.len.toFixed(3) : '');
  let inst = instances.get(key);
  if (inst) return inst;

  const g = GLYPHS.get(ch);
  const code = ch.codePointAt(0);
  const b = Math.imul(code, 1024) + (pos & 1023);
  const J = st.jitter;
  // A bare stem leaning 6° reads as a slash, so narrow glyphs lean less.
  const narrow = g.w < 200 ? 0.6 : 1;
  const ang = word ? word.angle : tilt ? TILT[(pos + seed) % TILT.length] * st.tilt * narrow * DEG : 0;
  const dy = tilt && !word ? WOBBLE[(pos * 3 + seed) % WOBBLE.length] * st.wobble : 0;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const pvx = (g.lsb + g.w / 2) / EM, pvy = -CAP / 2 / EM;
  // No two hand-cut letters share proportions: a small per-letter scale and shear.
  const D = tilt ? st.distort : 0;
  const kx = 1 + (hash(seed, b, 7, 7) * 2 - 1) * 0.04 * D;
  const ky = 1 + (hash(seed, b, 8, 8) * 2 - 1) * 0.025 * D;
  const shear = (hash(seed, b, 9, 9) * 2 - 1) * 0.045 * D * narrow;
  const gcx = g.w / 2, gcy = CAP / 2;
  const contours = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;

  prepare(ch, st).forEach((piece, pi) => {
    let pa = 0, pdx = 0, pdy = 0;
    if (pi > 0 && tilt) {
      pa = (hash(seed, b, pi, 4) * 2 - 1) * st.markTilt * DEG;
      pdx = (hash(seed, b, pi, 5) * 2 - 1) * st.markShift;
      pdy = (hash(seed, b, pi, 6) * 2 - 1) * st.markShift;
    }
    const pc = Math.cos(pa), ps = Math.sin(pa);
    piece.contours.forEach((c, ci) => {
      const { xs, ys, corner } = c, m = xs.length, base = (pi << 12) + (ci << 9);
      const X = [], Y = [];
      for (let v = 0; v < m; v++) {
        const jx = xs[v] + (hash(seed, b, base + v, 0) * 2 - 1) * J;
        const jy = ys[v] + (hash(seed, b, base + v, 1) * 2 - 1) * J;
        X.push(jx); Y.push(jy);
        if (!st.slit || !corner[v]) continue;
        // Inside corner (path turns right, solid on the left): the scissors overshoot along
        // the incoming cut, leaving a thin slit into the card.
        const pv = (v + m - 1) % m, nv = (v + 1) % m;
        const ix = xs[v] - xs[pv], iy = ys[v] - ys[pv], ox = xs[nv] - xs[v], oy = ys[nv] - ys[v];
        const li = Math.hypot(ix, iy), lo = Math.hypot(ox, oy);
        if ((ix * oy - iy * ox) / (li * lo) > -0.7 || hash(seed, b, base + v, 2) >= st.slit) continue;
        const L = 20 + 26 * hash(seed, b, base + v, 3);
        X.push(jx + ix / li * L); Y.push(jy + iy / li * L);
        X.push(jx + ox / lo * 7); Y.push(jy + oy / lo * 7);
      }
      const f = new Float32Array(X.length * 2);
      for (let i = 0; i < X.length; i++) {
        let x = X[i], y = Y[i];
        if (pa || pdx || pdy) {
          const u = x - piece.cx, w = y - piece.cy;
          x = piece.cx + u * pc - w * ps + pdx;
          y = piece.cy + u * ps + w * pc + pdy;
        }
        if (D) {
          const u = x - gcx, w = y - gcy;
          x = gcx + u * kx + w * shear;
          y = gcy + w * ky;
        }
        const ex = (x + g.lsb) / EM - pvx, ey = -y / EM - pvy;
        const fx = pvx + ex * ca - ey * sa, fy = pvy + ex * sa + ey * ca + dy;
        f[i * 2] = fx; f[i * 2 + 1] = fy;
        if (fx < x0) x0 = fx; if (fx > x1) x1 = fx;
        if (fy < y0) y0 = fy; if (fy > y1) y1 = fy;
      }
      contours.push(f);
    });
  });

  // Each letter is a different scrap of the same paper: -1 a shade darker, 1 a shade lighter.
  const t = hash(seed, b, 10, 10) * 2 - 1;
  const tone = st.tone && tilt ? (t > 0.35 ? 1 : t < -0.35 ? -1 : 0) * st.tone : 0;
  inst = {
    id: nextId++, ch, code, pos, seed, word, contours, tone,
    adv: (g.lsb + g.w + g.rsb) / EM,
    bbox: contours.length ? [x0, y0, x1, y1] : [0, 0, 0, 0],
    path: null, speck: null, last: null,
  };
  if (instances.size > 6000) trim(instances, 1500);
  instances.set(key, inst);
  return inst;
}

function trim(map, n) {
  for (const k of map.keys()) { map.delete(k); if (--n <= 0) break; }
}

function pathOf(inst) {
  if (!inst.path) {
    const p = new Path2D();
    for (const c of inst.contours) {
      p.moveTo(c[0], c[1]);
      for (let i = 2; i < c.length; i += 2) p.lineTo(c[i], c[i + 1]);
      p.closePath();
    }
    inst.path = p;
  }
  return inst.path;
}

// Missing-ink speckles of a stamp impression: [x, y, r] triples in em, letter-local.
function specklesOf(inst) {
  if (!inst.speck) {
    const [bx0, by0, bx1, by1] = inst.bbox, bw = bx1 - bx0, bh = by1 - by0;
    const b = Math.imul(inst.code, 1024) + inst.pos;
    // A few broad pale patches, then small crisp voids.
    const patches = Math.max(2, Math.round(bw * bh * 14)), voids = Math.round(bw * bh * 90);
    const n = patches + voids;
    const s = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const h = hash(inst.seed, b, i, 22);
      s[i * 3] = bx0 + bw * hash(inst.seed, b, i, 20);
      s[i * 3 + 1] = by0 + bh * hash(inst.seed, b, i, 21);
      s[i * 3 + 2] = i < patches ? 0.03 + 0.05 * h : 0.003 + 0.011 * h * h;
    }
    inst.speck = s;
  }
  return inst.speck;
}

// ------------------------------------------------------------------ layout

const layouts = new Map();

function toChars(text) {
  const s = String(text ?? '').normalize('NFC').toLocaleUpperCase('tr');
  const chars = [];
  for (let ch of s) {
    ch = ALIAS[ch] ?? ch;
    chars.push(GLYPHS.has(ch) ? ch : ' ');
  }
  return chars;
}

function layoutOf(text, st, opts) {
  const seed = seedOf(opts.seed);
  const tilt = opts.tilt !== false;
  const tabular = opts.tabular === true;
  const tracking = typeof opts.tracking === 'number' ? opts.tracking : st.tracking;
  const key = st.name + '|' + seed + '|' + (tilt ? 't' : 'f') + (tabular ? 't' : 'f') + '|' + tracking + '|' + text;
  let L = layouts.get(key);
  if (L) return L;

  const chars = toChars(text);
  const items = [];
  let x = 0, prev = null, fillIndex = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i], g = GLYPHS.get(ch);
    const digit = ch >= '0' && ch <= '9';
    let adv = (g.lsb + g.w + g.rsb) / EM, shift = 0;
    if (tabular && digit) { shift = (TAB - adv) / 2; adv = TAB; }
    if (prev && !(tabular && digit && prev >= '0' && prev <= '9')) x += kern(prev, ch) / EM;
    items.push({ ch, pos: i, x: x + shift, y: 0, adv: (g.lsb + g.w + g.rsb) / EM, inst: null, fillIndex: ch === ' ' ? 0 : fillIndex });
    if (ch !== ' ') fillIndex++;
    x += adv + (i < chars.length - 1 ? tracking : 0);
    prev = ch;
  }
  const advance = Math.max(0, x);

  let angle = 0;
  if (st.name === 'stamp' && tilt) {
    // A stamp is one rigid block: the whole impression turns, letters do not lean individually.
    angle = TILT[seed % TILT.length] * st.tilt * DEG;
    const cx = advance / 2, cy = -CAP / EM / 2, c = Math.cos(angle), s = Math.sin(angle);
    for (const it of items) {
      const px = it.x + it.adv / 2 - cx, py = -CAP / EM / 2 - cy;
      it.x = cx + px * c - py * s - it.adv / 2;
      it.y = cy + px * s + py * c + CAP / EM / 2;
    }
  }

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of items) {
    if (it.ch === ' ') continue;
    const word = st.name === 'stamp' ? { angle, x: it.x, len: advance } : null;
    it.inst = instance(it.ch, st, seed, it.pos, tilt, word);
    const bb = it.inst.bbox;
    x0 = Math.min(x0, bb[0] + it.x); y0 = Math.min(y0, bb[1] + it.y);
    x1 = Math.max(x1, bb[2] + it.x); y1 = Math.max(y1, bb[3] + it.y);
  }
  if (x0 === Infinity) { x0 = 0; x1 = advance; y0 = -CAP / EM; y1 = 0; }

  L = { items, advance, ink: [x0, y0, x1, y1], angle };
  if (layouts.size > 400) trim(layouts, 100);
  layouts.set(key, L);
  return L;
}

// ------------------------------------------------------------------ paint

function paintOf(opts, st) {
  const c = opts.colors || {};
  const stamp = st.name === 'stamp';
  const fills = stamp ? [c.ink ?? c.fill ?? DEFAULTS.stamp] : Array.isArray(c.fill) && c.fill.length ? c.fill : [c.fill ?? DEFAULTS.fill];
  let sh = st.shadow;
  const so = opts.shadowOffset;
  if (!stamp && so !== undefined) sh = !so ? null : typeof so === 'number' ? [so * 0.75, so] : [so.x ?? 0, so.y ?? 0];
  const plateColor = stamp ? null : c.plate ?? null;
  let pl = null;
  if (plateColor) {
    const m = opts.misregister;
    pl = m === false || m === 0 ? null : typeof m === 'number' ? [-m, -m * 0.75] : st.plate;
  }
  const shadowColor = c.shadow ?? DEFAULTS.shadow;
  const ink = c.ink ?? DEFAULTS.ink;
  const halftone = !stamp && (opts.halftone ?? st.halftone);
  const key = fills.join(',') + '|' + shadowColor + '|' + ink + '|' + plateColor + '|' + sh + '|' + pl + '|' + (halftone ? 1 : 0) + st.name;
  const rim = !stamp && (opts.rim ?? st.rim);
  return { fills, shadowColor, ink, plateColor, sh, pl, halftone, edge: st.edge, rim, stamp, bleed: st.bleed, key: key + (rim ? 'r' : '') };
}

// Offsets snap to whole device pixels so the shadow edge stays hard; never below one pixel.
function px(v, S) {
  if (!v) return 0;
  const r = Math.round(v * S);
  return r === 0 ? Math.sign(v) : r;
}

// ------------------------------------------------------------------ sprites

const sprites = new Map();
const dotTiles = new Map();
let spritePixels = 0;

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

function dotTile(pitch, color) {
  const key = pitch + '|' + color;
  let t = dotTiles.get(key);
  if (!t) {
    t = makeCanvas(pitch, pitch);
    const g = t.getContext('2d');
    g.fillStyle = color;
    g.beginPath();
    g.arc(pitch / 2, pitch / 2, pitch * 0.3, 0, Math.PI * 2);
    g.fill();
    dotTiles.set(key, t);
  }
  return t;
}

function renderSprite(inst, S, P, fill) {
  const [bx0, by0, bx1, by1] = inst.bbox;
  const sx = P.sh ? px(P.sh[0], S) : 0, sy = P.sh ? px(P.sh[1], S) : 0;
  const edge = P.edge && S >= 30;
  const ex = edge ? px(0.012, S) : 0, ey = edge ? px(0.016, S) : 0;
  const qx = P.pl ? px(P.pl[0], S) : 0, qy = P.pl ? px(P.pl[1], S) : 0;
  const pad = 2 + Math.ceil(P.bleed * S);
  const x0 = Math.floor(bx0 * S) + Math.min(0, sx, ex, qx) - pad;
  const y0 = Math.floor(by0 * S) + Math.min(0, sy, ey, qy) - pad;
  const w = Math.ceil(bx1 * S) + Math.max(0, sx, ex, qx) + pad - x0;
  const h = Math.ceil(by1 * S) + Math.max(0, sy, ey, qy) + pad - y0;
  const canvas = makeCanvas(w, h);
  const g = canvas.getContext('2d');
  g.setTransform(S, 0, 0, S, -x0, -y0);
  const path = pathOf(inst);
  const layer = (dx, dy, color, alpha) => {
    g.save();
    g.translate(dx / S, dy / S);
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.fill(path);
    g.restore();
  };

  if (P.stamp) {
    paintStamp(g, inst, S, fill, P.bleed, path);
  } else {
    if (sx || sy) layer(sx, sy, P.shadowColor, 1);
    if (edge) { layer(ex, ey, fill, 1); layer(ex, ey, P.shadowColor, 0.42); }
    if (qx || qy) layer(qx, qy, P.plateColor, 1);
    const body = (dx, dy) => {
      layer(dx, dy, fill, 1);
      if (inst.tone > 0) layer(dx, dy, '#ffffff', 0.13 * inst.tone);
      else if (inst.tone < 0) layer(dx, dy, P.shadowColor, -0.09 * inst.tone);
    };
    body(0, 0);
    if (P.rim && S >= 40) {
      // The cut edge of the card catches the light: a hard pale band along the upper-left cuts.
      const r = Math.max(1, Math.round(S * 0.011));
      layer(0, 0, '#ffffff', 0.32);
      g.save();
      g.clip(path);
      body(r, r);
      g.restore();
    }
    // A fine printed screen, fixed in device pixels: a texture, never a polka dot.
    if (P.halftone && S >= 56 && typeof DOMMatrix !== 'undefined') {
      const pitch = S >= 160 ? 5 : 4;
      const pat = g.createPattern(dotTile(pitch, P.ink), 'repeat');
      pat.setTransform(new DOMMatrix().scaleSelf(1 / S).rotateSelf(22));
      g.save();
      g.clip(path);
      g.globalAlpha = 0.11;
      g.fillStyle = pat;
      g.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
      g.restore();
    }
  }
  return { canvas, w, h, ox: -x0, oy: -y0 };
}

// Rubber-stamp impression: solid ink with a round-joined bleed, uneven pressure across the word,
// a mottled rubber texture and a few crisp voids. Texture fades out at small sizes so "8." never
// turns into "S.".
function paintStamp(g, inst, S, ink, bleed, path) {
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.lineJoin = 'round';
  g.lineWidth = bleed;
  g.globalAlpha = 0.93;
  g.fill(path);
  g.stroke(path);
  g.globalAlpha = 1;
  if (S < 22) return;
  const [bx0, by0, bx1, by1] = inst.bbox;
  const k = Math.min(1, (S - 22) / 70);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  const w = inst.word;
  if (w) {
    const lightLeft = (inst.seed & 1) === 0;
    const a = lightLeft ? w.len - w.x : -w.x, z = lightLeft ? -w.x : w.len - w.x;
    const gr = g.createLinearGradient(a, 0, z, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(0.6, 'rgba(0,0,0,0.06)');
    gr.addColorStop(1, `rgba(0,0,0,${0.32 * k})`);
    g.fillStyle = gr;
    g.fillRect(bx0 - 0.05, by0 - 0.05, bx1 - bx0 + 0.1, by1 - by0 + 0.1);
  }
  const grainy = S >= 40 && typeof DOMMatrix !== 'undefined';
  const pat = grainy ? g.createPattern(grainTile(), 'repeat') : null;
  if (pat) {
    pat.setTransform(new DOMMatrix().scaleSelf(1 / S));
    g.globalAlpha = 0.75 * k;
    g.fillStyle = pat;
    g.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
  }
  const s = specklesOf(inst);
  for (let i = 0; i < s.length; i += 3) {
    const r = s[i + 2], patch = r > 0.02;
    if (!patch && r * S < 0.9) continue;          // a void only once it is a real pixel
    const b = blob(inst, i, s[i], s[i + 1], r);
    g.beginPath();
    g.moveTo(b[0], b[1]);
    for (let j = 2; j < b.length; j += 2) g.lineTo(b[j], b[j + 1]);
    if (patch) {
      // Where the rubber pressed lightly the ink is thin: a little lighter, much grainier.
      g.globalAlpha = 0.1 * k;
      g.fillStyle = '#000';
      g.fill();
      if (pat) {
        g.save();
        g.clip();
        g.globalAlpha = k;
        g.fillStyle = pat;
        g.translate(r * 0.37, r * 0.61);
        g.fillRect(bx0 - 0.1, by0 - 0.1, bx1 - bx0 + 0.2, by1 - by0 + 0.2);
        g.restore();
      }
    } else {
      g.globalAlpha = k;
      g.fillStyle = '#000';
      g.fill();
    }
  }
  g.restore();
}

// Irregular 7-point blot around (x, y), deterministic per letter and index.
function blob(inst, i, x, y, r) {
  const b = Math.imul(inst.code, 1024) + inst.pos, pts = [];
  const a0 = hash(inst.seed, b, i, 30) * Math.PI * 2, squash = 0.55 + 0.45 * hash(inst.seed, b, i, 31);
  for (let j = 0; j < 7; j++) {
    const a = a0 + j / 7 * Math.PI * 2, rr = r * (0.6 + 0.7 * hash(inst.seed, b, i * 8 + j, 32));
    const u = Math.cos(a) * rr, v = Math.sin(a) * rr * squash;
    pts.push(x + u * Math.cos(a0) - v * Math.sin(a0), y + u * Math.sin(a0) + v * Math.cos(a0));
  }
  return pts;
}

let grain = null;
// 96 px tile of single-pixel voids: the rubber texture of a stamp, fixed in device pixels.
function grainTile() {
  if (!grain) {
    const n = 96;
    grain = makeCanvas(n, n);
    const g = grain.getContext('2d');
    const img = g.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const h = hash(i, 77, 3, 5);
      if (h < 0.16) img.data[i * 4 + 3] = 90 + Math.floor(165 * hash(i, 78, 3, 5));
    }
    g.putImageData(img, 0, 0);
  }
  return grain;
}

function spriteOf(inst, S, P, fill) {
  const l = inst.last;
  if (l && l.S === S && l.key === P.key && l.fill === fill && l.sp.canvas.width) {
    if (l.mapKey) { sprites.delete(l.mapKey); sprites.set(l.mapKey, l.sp); }
    return l.sp;
  }
  const mapKey = inst.id + '|' + S + '|' + P.key + '|' + fill;
  let sp = sprites.get(mapKey), kept = true;
  if (sp) {
    sprites.delete(mapKey);
    sprites.set(mapKey, sp);
  } else {
    sp = renderSprite(inst, S, P, fill);
    kept = sp.w * sp.h <= SPRITE_MAX;
    if (kept) {
      sprites.set(mapKey, sp);
      spritePixels += sp.w * sp.h;
      for (const [k, v] of sprites) {
        if (spritePixels <= SPRITE_BUDGET || sprites.size <= 1) break;
        sprites.delete(k);
        spritePixels -= v.w * v.h;
        v.canvas.width = 0;
      }
    }
  }
  inst.last = { S, key: P.key, fill, sp, mapKey: kept ? mapKey : null };
  return sp;
}

// Pixel sizes are stepped so an animated scale does not render a new sprite every frame;
// the ≤ 2 % resample that costs is invisible on hand-cut letters.
function quantize(s) {
  if (s <= 64) return Math.max(4, Math.round(s));
  if (s <= 160) return Math.round(s / 2) * 2;
  return Math.round(s / 4) * 4;
}

// ------------------------------------------------------------------ public API

function styleOf(opts) {
  return STYLES[opts.style] || STYLES.cut;
}

function anchor(opts, L, size) {
  const align = opts.align || 'left';
  const x = (opts.x ?? 0) - (align === 'center' ? L.advance * size / 2 : align === 'right' ? L.advance * size : 0);
  const bl = opts.baseline || 'alphabetic';
  const y = (opts.y ?? 0) + (bl === 'top' ? ASC * size : bl === 'middle' ? CAP / EM / 2 * size : bl === 'bottom' ? -DESC * size : 0);
  return [x, y];
}

function metrics(L, P, size, ax, ay, k) {
  const [ix0, iy0, ix1, iy1] = L.ink;
  let x0 = ix0, y0 = iy0, x1 = ix1, y1 = iy1;
  const S = size * k;
  const grow = (dx, dy) => {
    x0 = Math.min(x0, ix0 + dx); y0 = Math.min(y0, iy0 + dy);
    x1 = Math.max(x1, ix1 + dx); y1 = Math.max(y1, iy1 + dy);
  };
  if (P.sh) grow(px(P.sh[0], S) / S, px(P.sh[1], S) / S);
  if (P.edge && S >= 30) grow(px(0.012, S) / S, px(0.016, S) / S);
  if (P.pl) grow(px(P.pl[0], S) / S, px(P.pl[1], S) / S);
  if (P.bleed) { x0 -= P.bleed / 2; y0 -= P.bleed / 2; x1 += P.bleed / 2; y1 += P.bleed / 2; }
  return {
    width: (x1 - x0) * size, height: (y1 - y0) * size,
    left: ax + x0 * size, top: ay + y0 * size,
    advance: L.advance * size, ascent: ASC * size, descent: DESC * size,
  };
}

/**
 * Draws cut-paper lettering into a 2D canvas context.
 * opts: { x, y, size (px per em, like font-size), colors: { fill (string or array cycled per
 * letter), shadow, ink, plate }, seed, align: 'left'|'center'|'right' (by advance width),
 * baseline: 'alphabetic' (default: y is the baseline)|'top'|'middle' (y = centre of the caps)|'bottom',
 * style: 'cut'|'label'|'stamp', tilt = true, shadowOffset (em; number or {x, y}; 0 = none),
 * misregister (em, with colors.plate), halftone, tabular (fixed-width digits), tracking (em) }.
 * Returns { width, height } of the painted box (ink + shadow) plus { left, top, advance, ascent, descent }.
 */
export function drawLettering(ctx, text, opts = {}) {
  const st = styleOf(opts);
  const size = opts.size > 0 ? opts.size : 48;
  const L = layoutOf(text, st, opts);
  const P = paintOf(opts, st);
  let k = 1, m = null;
  if (typeof ctx.getTransform === 'function') {
    m = ctx.getTransform();
    k = Math.hypot(m.a, m.b) || 1;
    if (m.b !== 0 || m.c !== 0 || m.a <= 0 || m.d <= 0) m = null;
  }
  const S = quantize(size * k);
  const f = size / S;           // ctx units per sprite pixel
  const [ax, ay] = anchor(opts, L, size);
  const items = L.items;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.inst) continue;
    const sp = spriteOf(it.inst, S, P, P.fills[it.fillIndex % P.fills.length]);
    let dx = ax + it.x * size - sp.ox * f, dy = ay + it.y * size - sp.oy * f;
    if (m && S === size * k) {
      dx = (Math.round(m.a * dx + m.e) - m.e) / m.a;
      dy = (Math.round(m.d * dy + m.f) - m.f) / m.d;
    }
    ctx.drawImage(sp.canvas, dx, dy, sp.w * f, sp.h * f);
  }
  return metrics(L, P, size, ax, ay, k);
}

/** Same box drawLettering would paint, relative to the anchor x = y = 0 (opts.x / opts.y ignored). */
export function measureLettering(text, opts = {}) {
  const st = styleOf(opts);
  const size = opts.size > 0 ? opts.size : 48;
  const L = layoutOf(text, st, opts);
  const [ax, ay] = anchor({ ...opts, x: 0, y: 0 }, L, size);
  return metrics(L, paintOf(opts, st), size, ax, ay, 1);
}

const SVGNS = 'http://www.w3.org/2000/svg';
let uid = 0;
const U = 100; // SVG user units per em
const r1 = (v) => Math.round(v * 10) / 10;
const esc = (s) => String(s).replace(/[<>"&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' })[c]);

function dOf(inst, ox, oy) {
  let d = '';
  for (const c of inst.contours) {
    for (let i = 0; i < c.length; i += 2) d += (i ? 'L' : 'M') + r1((c[i] + ox) * U) + ' ' + r1((c[i + 1] + oy) * U);
    d += 'Z';
  }
  return d;
}

/**
 * Inline SVG of the lettering for the DOM. Sized in em, so it follows the CSS font-size of its
 * parent (or opts.size in px when given); sits on the text baseline. role="img", aria-label = text.
 * Colours may be any CSS colour, including var(--x) and currentColor.
 */
export function letteringElement(text, opts = {}) {
  const st = styleOf(opts);
  const L = layoutOf(text, st, opts);
  const P = paintOf(opts, st);
  const id = 'kkl' + (++uid);
  const groups = P.fills.map(() => '');
  let all = '', light = '', dark = '', tone = 0;
  for (const it of L.items) {
    if (!it.inst) continue;
    const d = dOf(it.inst, it.x, it.y);
    all += d;
    groups[it.fillIndex % groups.length] += d;
    if (it.inst.tone > 0) light += d;
    else if (it.inst.tone < 0) dark += d;
    tone = Math.max(tone, Math.abs(it.inst.tone));
  }

  // Offsets in em here (no pixel grid); 0.01 em keeps an 18 px shadow at a visible pixel.
  const sh = P.sh ? [Math.max(P.sh[0], 0.01), Math.max(P.sh[1], 0.01)] : null;
  const pl = P.pl;
  const [ix0, iy0, ix1, iy1] = L.ink;
  let x0 = Math.min(0, ix0), x1 = Math.max(L.advance, ix1), y0 = Math.min(-ASC, iy0), y1 = Math.max(DESC, iy1);
  for (const o of [sh, pl]) {
    if (!o) continue;
    x0 = Math.min(x0, ix0 + o[0]); x1 = Math.max(x1, ix1 + o[0]);
    y0 = Math.min(y0, iy0 + o[1]); y1 = Math.max(y1, iy1 + o[1]);
  }
  const pad = 0.02 + P.bleed;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const vb = [x0 * U, y0 * U, (x1 - x0) * U, (y1 - y0) * U].map(r1);

  const use = (dx, dy, style, extra = '') =>
    `<use href="#${id}g"${dx || dy ? ` x="${r1(dx * U)}" y="${r1(dy * U)}"` : ''} style="${esc(style)}"${extra}/>`;
  let defs = `<path id="${id}g" d="${all}"/>`;
  let body = '';

  if (P.stamp) {
    const ink = P.fills[0];
    const lightLeft = (seedOf(opts.seed) & 1) === 0;
    const [ga, gz] = lightLeft ? [L.advance, 0] : [0, L.advance];
    let sp = '', pale = '';
    for (const it of L.items) {
      if (!it.inst) continue;
      const s = specklesOf(it.inst);
      for (let i = 0; i < s.length; i += 3) {
        const b = blob(it.inst, i, s[i], s[i + 1], s[i + 2]);
        let c = '';
        for (let j = 0; j < b.length; j += 2) c += (j ? 'L' : 'M') + r1((b[j] + it.x) * U) + ' ' + r1((b[j + 1] + it.y) * U);
        if (s[i + 2] > 0.02) pale += c + 'Z'; else sp += c + 'Z';
      }
    }
    defs += `<linearGradient id="${id}p" gradientUnits="userSpaceOnUse" x1="${r1(ga * U)}" y1="0" x2="${r1(gz * U)}" y2="0">` +
      `<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".6" stop-color="#000" stop-opacity=".06"/>` +
      `<stop offset="1" stop-color="#000" stop-opacity=".32"/></linearGradient>` +
      `<mask id="${id}m" maskUnits="userSpaceOnUse" x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}">` +
      `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#fff"/>` +
      `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="url(#${id}p)"/>` +
      `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" filter="url(#${id}n)" opacity=".7"/>` +
      `<path d="${pale}" fill="#000" fill-opacity=".16"/><path d="${sp}" fill="#000"/></mask>` +
      // Rubber grain: thresholded noise, black specks with alpha only where the noise peaks.
      `<filter id="${id}n" filterUnits="userSpaceOnUse" x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}">` +
      `<feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2" seed="${seedOf(opts.seed) % 997}"/>` +
      `<feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 9 0 0 0 -5.4"/></filter>`;
    body += use(0, 0, `fill:${ink};stroke:${ink};stroke-width:${r1(P.bleed * U)};stroke-linejoin:round`, ` mask="url(#${id}m)" opacity=".94"`);
  } else {
    if (sh) body += use(sh[0], sh[1], `fill:${P.shadowColor}`);
    if (P.edge) {
      body += use(0.012, 0.016, `fill:${P.fills[0]}`);
      body += use(0.012, 0.016, `fill:${P.shadowColor}`, ' opacity=".42"');
    }
    if (pl) body += use(pl[0], pl[1], `fill:${P.plateColor}`);
    let paper = P.fills.length === 1 ? use(0, 0, `fill:${P.fills[0]}`)
      : groups.map((d, i) => (d ? `<path d="${d}" style="${esc('fill:' + P.fills[i])}"/>` : '')).join('');
    if (light) paper += `<path d="${light}" fill="#fff" fill-opacity="${r1(13 * tone) / 100}"/>`;
    if (dark) paper += `<path d="${dark}" style="${esc('fill:' + P.shadowColor)}" fill-opacity="${r1(9 * tone) / 100}"/>`;
    body += paper;
    // Same rule as the canvas: the lit cut edge only where it can be a whole pixel.
    if (P.rim && (opts.rim === true || opts.size >= 40)) {
      defs += `<clipPath id="${id}c"><use href="#${id}g"/></clipPath>`;
      body += use(0, 0, 'fill:#fff', ' opacity=".32"') +
        `<g clip-path="url(#${id}c)"><g transform="translate(1.1 1.1)">${paper}</g></g>`;
    }
    const halftone = opts.halftone ?? (st.halftone && opts.size >= 40);
    if (halftone) {
      defs += `<pattern id="${id}h" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(22)">` +
        `<circle cx="2.5" cy="2.5" r="1.5" style="${esc('fill:' + P.ink)}"/></pattern>`;
      body += use(0, 0, `fill:url(#${id}h)`, ' opacity=".14"');
    }
  }

  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', vb.join(' '));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', String(text ?? ''));
  svg.setAttribute('focusable', 'false');
  const s = svg.style;
  s.width = r1(vb[2]) / U + 'em';
  s.height = r1(vb[3]) / U + 'em';
  s.verticalAlign = -r1(y1 * U) / U + 'em';
  s.overflow = 'visible';
  if (opts.size > 0) s.fontSize = opts.size + 'px';
  // Offset the box so the advance origin sits where the text would start.
  if (x0 < 0) s.marginLeft = r1(x0 * U) / U + 'em';
  if (x1 > L.advance) s.marginRight = -r1((x1 - L.advance) * U) / U + 'em';
  svg.innerHTML = `<defs>${defs}</defs>${body}`;
  return svg;
}

/**
 * CanvasTexture (sRGB) with the lettering on a transparent (or opts.background) canvas, for signs
 * in the 3D scene. opts.size is the texture resolution in px per em (default 128).
 * texture.userData.aspect = width / height.
 */
export function letteringTexture(THREE, text, opts = {}) {
  const size = opts.size > 0 ? opts.size : 128;
  const pad = Math.ceil(opts.padding ?? size * 0.1);
  const o = { ...opts, size, align: 'left', baseline: 'alphabetic', x: 0, y: 0 };
  const m = measureLettering(text, o);
  const canvas = makeCanvas(Math.ceil(m.width) + pad * 2, Math.ceil(m.height) + pad * 2);
  const ctx = canvas.getContext('2d');
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  drawLettering(ctx, text, { ...o, x: pad - m.left, y: pad - m.top });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.aspect = canvas.width / canvas.height;
  tex.needsUpdate = true;
  return tex;
}

/** Drops every cached outline, layout and sprite (tests, or after a huge one-off logo). */
export function clearLetteringCache() {
  for (const sp of sprites.values()) sp.canvas.width = 0;
  sprites.clear();
  spritePixels = 0;
  instances.clear();
  layouts.clear();
  prepared.clear();
  dotTiles.clear();
  grain = null;
}
