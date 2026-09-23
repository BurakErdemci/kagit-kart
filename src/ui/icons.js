// Inline-SVG artwork. Every drawing is "printed": flat colour plates offset a little from the ink
// linework, like a two-pass print slightly out of register.

const INK = '#2d2a32';
const PAPER = '#fbf6e9';

const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const ring = (cx, cy, r, r2) => `${circ(cx, cy, r)}${circ(cx, cy, r2)}`;

// shapes: [{ d, fill, t?, line?: false, rule? }]; lines: extra ink-only path markup.
function printed(shapes, lines = '', { sw = 2.6, rot = 0, off = '1.7 1.4', view = 64 } = {}) {
  const g = rot ? ` transform="rotate(${rot} ${view / 2} ${view / 2})"` : '';
  const tr = (s) => (s.t ? ` transform="${s.t}"` : '');
  const rule = (s) => (s.rule ? ` fill-rule="${s.rule}"` : '');
  const plate = shapes.map((s) => `<path${tr(s)}${rule(s)} d="${s.d}" fill="${s.fill}"/>`).join('');
  const line = shapes.filter((s) => s.line !== false).map((s) => `<path${tr(s)} d="${s.d}"/>`).join('');
  return `<svg viewBox="0 0 ${view} ${view}" aria-hidden="true"><g transform="translate(${off})"><g${g}>${plate}</g></g>` +
    `<g${g} fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round">${line}${lines}</g></svg>`;
}

// The rocket is the fountain pen the kart carries in the world (items/shapes.js penGeometry): navy
// barrel, gold band, black grip, gold nib with its slit, steel clip.
const fountainPen = (t = '') => [
  { t, d: 'M25 13Q25 4 32 4Q39 4 39 13V35H25Z', fill: '#2b3a6b' },
  { t, d: 'M25 30H39V35H25Z', fill: '#e0b44c' },
  { t, d: 'M27.5 35H36.5V43H27.5Z', fill: '#1d1b22' },
  { t, d: 'M26.5 43H37.5Q37 51 32 61Q27 51 26.5 43Z', fill: '#e0b44c' },
  { t, d: 'M36 7H40V23Q40 25.5 38 25.5Q36 25.5 36 23Z', fill: '#c9ced6' },
  { t, d: 'M32 50V58', fill: 'none' },
  { t, d: circ(32, 49, 1.6), fill: INK, line: false },
];

export const ITEMS = {
  rocket: {
    name: 'Roket Kalem',
    svg: printed(fountainPen(), '', { rot: 45 }),
  },
  rocket3: {
    name: 'Üçlü Roket',
    svg: printed([
      ...fountainPen('translate(-6 10) scale(.62) rotate(-18 32 32)'),
      ...fountainPen('translate(26 10) scale(.62) rotate(18 32 32)'),
      ...fountainPen('translate(10 2) scale(.66)'),
    ], '', { rot: 30, sw: 2.2 }),
  },
  gum: {
    name: 'Sakız',
    svg: printed([
      { d: 'M8 46L30 38L36 54L14 62Z', fill: '#6c8ead' },
      { d: 'M13 48L31 42', fill: 'none', line: true },
      { d: circ(38, 28, 20), fill: '#f3a5b8' },
      { d: circ(38, 28, 11), fill: '#f7c4d1' },
    ], '<path d="M28 18q4-5 10-5" stroke="#fbf6e9" stroke-width="3.2"/>'),
  },
  plane: {
    name: 'Kâğıt Uçak',
    svg: printed([
      { d: 'M5 33L59 11L30 53L26 38Z', fill: PAPER },
      { d: 'M26 38L30 53L19 43Z', fill: '#d8ccaa' },
    ], '<path d="M26 38L59 11"/>'),
  },
  homing: {
    name: 'Güdümlü Uçak',
    svg: printed([
      { d: ring(18, 18, 13, 7), fill: '#f2c14e', rule: 'evenodd' },
      { d: 'M9 37L61 15L33 57L29 42Z', fill: '#e56b6f' },
      { d: 'M29 42L33 57L22 47Z', fill: '#b8474f' },
    ], '<path d="M29 42L61 15M18 2v6M18 28v6M2 18h6M28 18h6" />'),
  },
  ink: {
    name: 'Mürekkep',
    svg: printed([
      { d: 'M17 30Q17 25 22 25H42Q47 25 47 30V55Q47 60 42 60H22Q17 60 17 55Z', fill: '#34467a' },
      { d: 'M26 15H38V25H26Z', fill: '#4d6099' },
      { d: 'M27 5H37V15H27Z', fill: '#c89b6d' },
      { d: 'M22 36H42V50H22Z', fill: PAPER },
      { d: 'M49 36q5 9 0 12q-5-3 0-12Z', fill: '#34467a' },
    ], '<path d="M26 43h12"/>'),
  },
  foil: {
    name: 'Yaldız',
    svg: printed([
      { d: 'M32 4L39 23L59 24L43 36L49 56L32 44L15 56L21 36L5 24L25 23Z', fill: '#e0b64a' },
      { d: 'M32 17L35 29L46 30L37 35', fill: '#f5dc8c', line: false },
    ], '<path d="M32 18v14l-9 6M32 32l10 5"/><path d="M52 6l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fbf6e9"/>'),
  },
  scissors: {
    name: 'Makas',
    svg: printed([
      { d: 'M30 37L13 5Q22 8 37 31Z', fill: '#cfd3da' },
      { d: 'M34 37L51 5Q42 8 27 31Z', fill: '#cfd3da' },
      { d: ring(20, 49, 10, 5), fill: '#d9483b', rule: 'evenodd' },
      { d: ring(44, 49, 10, 5), fill: '#d9483b', rule: 'evenodd' },
    ], '<path d="M27 42L30 37M37 42L34 37"/><circle cx="32" cy="33" r="1.6" fill="#2d2a32"/>'),
  },
};

export const ITEM_IDS = ['rocket', 'rocket3', 'gum', 'plane', 'homing', 'ink', 'foil', 'scissors'];

export const MODE_ART = {
  gp: printed([
    { d: 'M20 10H44V24Q44 39 32 41Q20 39 20 24Z', fill: '#e0b64a' },
    { d: 'M29 41H35V49H29Z', fill: '#c8693a' },
    { d: 'M20 49H44V56H20Z', fill: '#c8693a' },
    { d: 'M32 16l2.4 5 5.4.6-4 3.7 1.1 5.3-4.9-2.7-4.9 2.7 1.1-5.3-4-3.7 5.4-.6Z', fill: PAPER },
  ], '<path d="M20 14Q9 14 11 23Q13 30 21 30M44 14Q55 14 53 23Q51 30 43 30"/>'),
  single: printed([
    { d: 'M17 9Q30 3 40 9T61 9V33Q51 27 40 33T17 33Z', fill: PAPER },
    { d: 'M17 9Q23 6 28 7V19Q23 18 17 21ZM28 19Q34 20 40 21V33Q34 30 28 31ZM40 9Q45 12 50 11V23Q45 24 40 21ZM50 23Q56 22 61 21V33Q56 30 50 30Z', fill: INK, line: false },
  ], '<path d="M15 6V60"/>'),
  tt: printed([
    { d: 'M41 17Q41 6 51 6Q61 6 61 17V31L58 28L55 31L52 28L49 31L46 28L43 31L41 29Z', fill: '#c9d8ec' },
    { d: circ(28, 38, 21), fill: PAPER },
    { d: 'M24 8H32V14H24Z', fill: '#c8693a' },
  ], '<path d="M28 38V25M28 38l8 5"/><circle cx="49" cy="17" r="1.4" fill="#2d2a32"/><circle cx="55" cy="17" r="1.4" fill="#2d2a32"/>'),
};

// ------------------------------------------------------------------ animal portraits

const FALLBACK_COLORS = {
  tilki: { body: '#e07a3a', accent: '#fbf6e9', detail: '#2d2a32' },
  kurbaga: { body: '#7fb35a', accent: '#f2e6b8', detail: '#e56b6f' },
  penguen: { body: '#39435a', accent: '#fbf6e9', detail: '#f2a33a' },
  ayi: { body: '#9a6a47', accent: '#e8cfa6', detail: '#2d2a32' },
  kedi: { body: '#b9a0c9', accent: '#fbf6e9', detail: '#e88fa4' },
  baykus: { body: '#8c6f5a', accent: '#f3ead3', detail: '#f2c14e' },
  tavsan: { body: '#ece2d0', accent: '#f3a5b8', detail: '#2d2a32' },
  ahtapot: { body: '#d9677a', accent: '#f6c3cb', detail: '#2d2a32' },
};

function eyes(y = 32, dx = 8, r = 2.6) {
  return `<circle cx="${32 - dx}" cy="${y}" r="${r}" fill="${INK}" stroke="none"/><circle cx="${32 + dx}" cy="${y}" r="${r}" fill="${INK}" stroke="none"/>`;
}

const ANIMALS = {
  tilki: (c) => printed([
    { d: 'M13 27L17 5L31 18Z', fill: c.body },
    { d: 'M51 27L47 5L33 18Z', fill: c.body },
    { d: 'M18 20L19 11L25 17Z', fill: INK, line: false },
    { d: 'M46 20L45 11L39 17Z', fill: INK, line: false },
    { d: 'M9 30Q11 16 32 16Q53 16 55 30L32 57Z', fill: c.body },
    { d: 'M15 35Q32 28 49 35L32 57Z', fill: c.accent },
  ], `${eyes(31, 9)}<circle cx="32" cy="54" r="3" fill="${INK}"/>`),
  kurbaga: (c) => printed([
    { d: circ(20, 21, 9), fill: c.body },
    { d: circ(44, 21, 9), fill: c.body },
    { d: 'M7 40Q7 23 32 23Q57 23 57 40Q57 55 32 55Q7 55 7 40Z', fill: c.body },
    { d: circ(20, 21, 5), fill: c.accent },
    { d: circ(44, 21, 5), fill: c.accent },
  ], `<circle cx="20" cy="21" r="2.4" fill="${INK}"/><circle cx="44" cy="21" r="2.4" fill="${INK}"/><path d="M20 42Q32 50 44 42"/><circle cx="14" cy="42" r="3" fill="${c.detail}" stroke="none" opacity=".7"/><circle cx="50" cy="42" r="3" fill="${c.detail}" stroke="none" opacity=".7"/>`),
  penguen: (c) => printed([
    { d: circ(32, 34, 23), fill: c.body },
    { d: 'M15 36Q15 21 30 26Q32 28 34 26Q49 21 49 36Q49 53 32 55Q15 53 15 36Z', fill: c.accent },
    { d: 'M26 38L32 47L38 38Z', fill: c.detail },
  ], eyes(33, 8)),
  ayi: (c) => printed([
    { d: circ(15, 16, 8), fill: c.body },
    { d: circ(49, 16, 8), fill: c.body },
    { d: circ(32, 36, 22), fill: c.body },
    { d: 'M21 45Q21 36 32 36Q43 36 43 45Q43 53 32 53Q21 53 21 45Z', fill: c.accent },
  ], `<circle cx="15" cy="16" r="3.5" fill="${c.accent}" stroke="none"/><circle cx="49" cy="16" r="3.5" fill="${c.accent}" stroke="none"/>${eyes(30, 9)}<ellipse cx="32" cy="41" rx="4" ry="3" fill="${INK}"/><path d="M32 44v4"/>`),
  kedi: (c) => printed([
    { d: 'M11 29L13 5L28 16Z', fill: c.body },
    { d: 'M53 29L51 5L36 16Z', fill: c.body },
    { d: 'M9 37Q9 16 32 16Q55 16 55 37Q55 57 32 57Q9 57 9 37Z', fill: c.body },
    { d: 'M29 40H35L32 44Z', fill: c.detail },
  ], `<path d="M19 33q4-3 8 0M37 33q4-3 8 0"/><path d="M32 44v4M4 42l14 1M4 49l14-3M60 42l-14 1M60 49l-14-3" stroke-width="1.8"/>`),
  baykus: (c) => printed([
    { d: 'M12 21L19 7L28 16Q32 14 36 16L45 7L52 21Q57 37 50 48Q42 58 32 58Q22 58 14 48Q7 37 12 21Z', fill: c.body },
    { d: circ(23, 31, 10), fill: c.accent },
    { d: circ(41, 31, 10), fill: c.accent },
    { d: 'M28 39L32 47L36 39Z', fill: c.detail },
  ], `<circle cx="23" cy="31" r="4" fill="${INK}"/><circle cx="41" cy="31" r="4" fill="${INK}"/>`),
  tavsan: (c) => printed([
    { d: 'M19 30Q10 4 19 2Q28 4 27 30Z', fill: c.body },
    { d: 'M45 30Q54 4 45 2Q36 4 37 30Z', fill: c.body },
    { d: 'M20 26Q16 10 20 7Q24 10 24 26Z', fill: c.accent, line: false },
    { d: 'M44 26Q48 10 44 7Q40 10 40 26Z', fill: c.accent, line: false },
    { d: circ(32, 41, 19), fill: c.body },
    { d: 'M29 42H35L32 45Z', fill: c.accent },
    { d: 'M29 48H35V53H29Z', fill: PAPER },
  ], `${eyes(36, 8)}<path d="M32 45v3"/>`),
  ahtapot: (c) => printed([
    { d: 'M12 34Q10 44 5 50Q14 51 18 42Q20 51 24 57Q29 51 28 42Q32 53 36 57Q39 49 38 42Q42 51 48 54Q49 46 46 40Q52 47 59 48Q54 41 52 34Z', fill: c.body },
    { d: 'M11 35Q11 7 32 7Q53 7 53 35Z', fill: c.body },
    { d: circ(22, 17, 3), fill: c.accent, line: false },
    { d: circ(42, 14, 2.4), fill: c.accent, line: false },
  ], `<circle cx="24" cy="28" r="5" fill="${PAPER}"/><circle cx="40" cy="28" r="5" fill="${PAPER}"/><circle cx="25" cy="29" r="2.3" fill="${INK}" stroke="none"/><circle cx="41" cy="29" r="2.3" fill="${INK}" stroke="none"/>`),
};

export function portrait(character) {
  const id = character?.id;
  const fb = FALLBACK_COLORS[id] || FALLBACK_COLORS.tilki;
  const c = { ...fb, ...(character?.colors || {}) };
  const draw = ANIMALS[id] || ANIMALS.tilki;
  return draw(c);
}

// Pencil sketch of a track outline from its definition points (closed Catmull–Rom, sampled).
export function trackSketch(points, size = 100, pad = 8) {
  if (!Array.isArray(points) || points.length < 3) return '';
  const pts = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    for (let k = 0; k < 6; k++) {
      const t = k / 6, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c2, d) => 0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
      pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[2], p1[2], p2[2], p3[2])]);
    }
  }
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const s = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ, 1);
  const ox = (size - (maxX - minX) * s) / 2, oz = (size - (maxZ - minZ) * s) / 2;
  const d = pts.map(([x, z], i) => `${i ? 'L' : 'M'}${((x - minX) * s + ox).toFixed(1)} ${((z - minZ) * s + oz).toFixed(1)}`).join('') + 'Z';
  const [sx, sz] = pts[0];
  const start = [((sx - minX) * s + ox).toFixed(1), ((sz - minZ) * s + oz).toFixed(1)];
  return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-opacity=".22" stroke-width="7" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width="1" transform="translate(1.2 -.8)"/>` +
    `<circle cx="${start[0]}" cy="${start[1]}" r="3.2" fill="#d9483b"/></svg>`;
}

export const ROTATE_PHONE = `<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"><rect x="20" y="8" width="24" height="40" rx="4" fill="${PAPER}"/><path d="M50 40a18 18 0 0 1-18 18M36 54l-4 4 4 4"/></g></svg>`;

export const WRONG_SIGN = `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 3L97 50L50 97L3 50Z" fill="#f2c14e" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M50 12L88 50L50 88L12 50Z" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/><g fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M58 70V44a10 10 0 0 0-20 0v6"/><path d="M29 43l9 10 9-10"/></g></svg>`;

export const SPEAKER = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 9h4l5-4.2v14.4l-5-4.2h-4z" fill="${INK}"/><path d="M15.5 9.2q1.8 2.8 0 5.6M18 6.6q3.8 5.4 0 10.8" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/></svg>`;

export const PAUSE_GLYPH = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="${INK}"/></svg>`;
