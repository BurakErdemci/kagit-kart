// The eight papercraft karts + drivers. Local frame (§10.7): origin at the ground contact centre,
// +Z forward, +Y up, +X is the kart's LEFT. Shared chassis family, per-character hull, driver and
// one signature ornament. Everything is one skinned mesh; bones carry the animated parts.
import * as THREE from 'three';
import { PaperBuilder, ngon, vec } from './paperkit.js';

const { add, sub, mul, norm, lerp } = vec;

export const FRAME = {
  front: { x: 0.6, y: 0.27, z: 0.72, r: 0.27, w: 0.2 },
  rear: { x: 0.62, y: 0.31, z: -0.66, r: 0.31, w: 0.26 },
  seatZ: -0.3,
  steer: [0, 0.84, 0.14],
  steerN: norm([0, 0.55, -0.83]),
  exhaust: [0, 0.68, -1.14],
};

const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

// Hull presets: rings [z, y, rx, ry], rear to nose. Shared limits every preset keeps: the real half
// width (rx scaled by the polygon's corner factor) stays ≤ 0.48 over the wheel spans (rear z −0.97..−0.35,
// front z 0.45..0.99) so no tyre pokes through, and the top stays ≤ 0.72 over the cockpit (z −0.55..0.3)
// so the steering wheel and the driver stay in view. Shape identity lives in the nose, planform and height.
const HULLS = {
  // long, low, pointed
  dart: { sides: 6, phase: 0, rings: [[-1.0, 0.44, 0.44, 0.17], [-0.62, 0.45, 0.48, 0.22], [0.28, 0.43, 0.48, 0.2], [0.8, 0.36, 0.3, 0.12], [1.12, 0.3, 0.1, 0.05]] },
  // lower than the dart, a flat blade nose down near the road
  wedge: { sides: 6, phase: 0, rings: [[-1.0, 0.4, 0.44, 0.15], [-0.62, 0.41, 0.48, 0.19], [0.25, 0.37, 0.48, 0.15], [0.75, 0.27, 0.34, 0.08], [1.16, 0.17, 0.22, 0.02]] },
  // a box: flat sides, fat pontoons between the wheels, a blunt high front
  tub: { sides: 4, phase: Math.PI / 4, rings: [[-1.02, 0.44, 0.52, 0.22], [-0.72, 0.45, 0.62, 0.26], [-0.3, 0.46, 0.85, 0.34], [0.4, 0.46, 0.85, 0.34], [0.52, 0.46, 0.66, 0.32], [0.96, 0.45, 0.64, 0.3], [1.04, 0.44, 0.52, 0.22]] },
  // flat and wide with a round front, like a leaf on water
  pad: { sides: 10, phase: 0, rings: [[-0.98, 0.37, 0.42, 0.11], [-0.72, 0.38, 0.48, 0.14], [-0.3, 0.38, 0.64, 0.15], [0.38, 0.38, 0.64, 0.15], [0.5, 0.37, 0.48, 0.14], [0.94, 0.35, 0.46, 0.12], [1.06, 0.34, 0.36, 0.09], [1.12, 0.335, 0.16, 0.05]] },
  // a low deck whose nose curls up like a toboggan
  sled: { sides: 6, phase: 0, rings: [[-1.0, 0.42, 0.44, 0.15], [-0.6, 0.43, 0.48, 0.2], [0.35, 0.41, 0.48, 0.16], [0.8, 0.41, 0.4, 0.12], [0.98, 0.5, 0.34, 0.08], [1.07, 0.64, 0.3, 0.05], [1.1, 0.76, 0.27, 0.03]] },
  // a round fuselage ending in a cowling for the propeller (wings are added by the owl)
  plane: { sides: 8, phase: Math.PI / 8, rings: [[-1.0, 0.46, 0.34, 0.2], [-0.62, 0.47, 0.5, 0.25], [0.3, 0.46, 0.5, 0.26], [0.72, 0.44, 0.4, 0.24], [0.96, 0.43, 0.28, 0.2], [1.02, 0.42, 0.16, 0.13]] },
  // a short egg: the shortest hull, fattest in the middle
  bubble: { sides: 8, phase: Math.PI / 8, rings: [[-0.98, 0.44, 0.36, 0.16], [-0.78, 0.46, 0.5, 0.23], [-0.3, 0.47, 0.6, 0.26], [0.36, 0.46, 0.6, 0.26], [0.5, 0.45, 0.5, 0.24], [0.8, 0.43, 0.46, 0.2], [0.96, 0.4, 0.32, 0.14], [1.02, 0.38, 0.12, 0.06]] },
  // round, with a swollen bow taller than the cockpit
  sub: { sides: 8, phase: Math.PI / 8, rings: [[-1.02, 0.47, 0.3, 0.2], [-0.8, 0.48, 0.5, 0.28], [-0.4, 0.46, 0.52, 0.25], [0.3, 0.44, 0.52, 0.26], [0.66, 0.46, 0.5, 0.31], [0.92, 0.47, 0.38, 0.27], [1.04, 0.47, 0.2, 0.15], [1.08, 0.47, 0.06, 0.05]] },
};

// Top of what the chassis bone carries so far at (x, z); lets parts sit on any hull.
function hullTop(b, x, z, fallback) {
  const hit = b.surface([x, 2, z], [0, -1, 0], 'chassis');
  return hit ? hit.p[1] : fallback;
}

// Mudguard strip over a wheel, on the chassis: arc from angle a0 to a1 (0 = forward, π/2 = up).
function fender(b, W, gap, halfW, a0, a1, sw, sw2) {
  const R = W.r + gap, n = 7;
  const rings = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (i / (n - 1));
    rings.push({ c: [W.x, W.y + Math.sin(a) * R, W.z + Math.cos(a) * R], rx: 0.022, ry: halfW / Math.SQRT1_2 });
  }
  // sides 4 at π/4: k = 1 is the outer (radial) face
  b.loft(rings, { sides: 4, phase: Math.PI / 4, up: [1, 0, 0], sw: (i, k) => (k === 1 ? sw : sw2), cap0: sw2, cap1: sw2, crease: 0.008 });
}

function swatches(ch, K) {
  const c = ch.colors;
  return {
    kart: { color: c.kart },
    kartP: { color: c.kart, pattern: K.pattern, p2: K.p2, cw: 2, ch: 2 },
    kart2: { color: K.kart2 || shade(c.kart, 0.62) },
    body: { color: c.body },
    accent: { color: c.accent },
    detail: { color: c.detail },
    dark: { color: '#2e2b33', crease: 0.25 },
    white: { color: '#f8f4ea' },
    edge: { color: '#f1e8d2', crease: 0.1 },
    tire: { color: '#3b3841', crease: 0.3 },
    tread: { color: '#3b3841', pattern: 'tread', p2: '#2b2930', crease: 0.3 },
    hub: { color: '#3b3841', art: 'hub', a: c.kart, b: K.hubB || '#efe7d4' },
    steerArt: { color: '#3b3841', art: 'steer', a: c.kart, b: '#d9d2c2' },
    metal: { color: K.metal || '#c9c2b2' },
    vent: { color: K.metal || '#c9c2b2', pattern: 'tread', p2: '#6f6a62' },
    emblem: { color: K.kart2 || shade(c.kart, 0.62), art: 'emblem', symbol: K.emblem, band: K.band || c.accent, disc: '#f8f4ea', a: K.emblemInk || c.kart, cw: 2, ch: 1 },
    ...(K.extra || {}),
  };
}

// ---------------------------------------------------------------- shared chassis

function skeleton(b) {
  const F = FRAME.front, R = FRAME.rear;
  b.bone('root', null, [0, 0, 0]);
  b.bone('chassis', 'root', [0, 0.32, 0]);
  b.bonePair('wF', 'root', [F.x, F.y, F.z]);
  b.bone('wFLs', 'wFL', [F.x, F.y, F.z]);
  b.bone('wFRs', 'wFR', [-F.x, F.y, F.z]);
  b.bonePair('wR', 'root', [R.x, R.y, R.z]);
  b.bone('steer', 'chassis', FRAME.steer);
  b.bone('torso', 'chassis', [0, 0.55, FRAME.seatZ]);
  b.bone('head', 'torso', [0, 1.0, FRAME.seatZ + 0.02]);
  b.bonePair('arm', 'torso', [0.23, 0.9, FRAME.seatZ]);
}

function wheel(b, bone, W, hubSw) {
  b.use(bone);
  const x0 = W.x - W.w / 2, x1 = W.x + W.w / 2, r = W.r;
  b.loft([
    { c: [x0, W.y, W.z], rx: r * 0.82, ry: r * 0.82 },
    { c: [x0 + 0.035, W.y, W.z], rx: r, ry: r },
    { c: [x1 - 0.035, W.y, W.z], rx: r, ry: r },
    { c: [x1, W.y, W.z], rx: r * 0.82, ry: r * 0.82 },
  ], { sides: 10, axis: [1, 0, 0], up: [0, 1, 0], sw: (i) => (i === 1 ? 'tread' : 'tire'), cap0: 'tire', cap1: hubSw, capFit: 'cover', crease: 0.012, capCrease: 0.012 });
}

function chassis(b, K) {
  const H = HULLS[K.hull] || HULLS.dart;
  b.use('chassis');
  const hullSw = K.hullSw || ((i, k, a) => {
    const s = Math.sin(a);
    if (s > 0.85) return 'kartP';
    if (s > -0.1) return 'kart';
    return 'kart2';
  });
  b.loft(H.rings.map(([z, y, rx, ry]) => ({ c: [0, y, z], rx, ry })), {
    sides: H.sides, phase: H.phase, up: [0, 1, 0], sw: hullSw, cap0: 'emblem', cap1: 'kart2', capFit: 'cover', capCrease: 0.018,
  });
  // side pods between the wheels
  b.both(() => b.box([0.5, 0.31, 0.05], [0.16, 0.2, 0.74], { all: 'kart2', py: 'kart' }));
  // engine block + exhaust (the exhaust anchor sits at its mouth)
  b.box([0, 0.67, -0.77], [0.4, 0.15, 0.28], { all: 'kart2', py: 'vent', nz: 'dark', pz: null });
  const E = FRAME.exhaust;
  b.loft([{ c: [E[0], E[1] - 0.02, -0.88], rx: 0.065, ry: 0.065 }, { c: [E[0], E[1], E[2] + 0.02], rx: 0.08, ry: 0.08 }],
    { sides: 6, axis: [0, 0, -1], up: [0, 1, 0], sw: 'metal', cap1: 'dark', crease: 0.01 });
  // steering column + wheel; the column starts just under the hull skin, whatever its height
  const colY = Math.min(0.62, hullTop(b, 0, 0.44, 0.62) - 0.02);
  b.loft([{ c: [0, colY, 0.44], rx: 0.02, ry: 0.02 }, { c: FRAME.steer, rx: 0.02, ry: 0.02 }], { sides: 5, sw: 'dark', crease: 0 });
  b.use('steer');
  b.slab(ngon(8, 0.12, 0.12, Math.PI / 8), FRAME.steer, [-1, 0, 0], [0, 0.83, 0.55], 0.03, 'steerArt', 'kart2', 'dark', { fit: 'cover' });
  // wheels
  const F = FRAME.front, R = FRAME.rear;
  b.both((s) => {
    wheel(b, 'wF' + s + 's', F, 'hub');
    wheel(b, 'wR' + s, R, 'hub');
  });
}

// ---------------------------------------------------------------- driver helpers

function vloft(b, z, rings, o = {}) {
  b.loft(rings.map(([y, rx, rz, x = 0, dz = 0]) => ({ c: [x, y, z + dz], rx, ry: rz })), {
    sides: o.sides ?? 8, phase: o.phase ?? Math.PI / 8, up: [0, 0, 1], sw: o.sw || 'body', cap0: o.cap0 ?? null, cap1: o.cap1 ?? 'body', crease: o.crease, capFit: o.capFit,
  });
}

const front = (hi, lo) => (i, k, a) => (Math.sin(a) > 0.55 ? hi : lo);

function arms(b, sw, pawSw, o = {}) {
  const sh = o.shoulder || [0.23, 0.9, FRAME.seatZ];
  const hand = o.hand || [0.12, 0.89, 0.12];
  const r0 = o.r0 ?? 0.075, r1 = o.r1 ?? 0.055;
  b.both((s) => {
    b.use('arm' + s);
    const mid = add(lerp(sh, hand, 0.5), [0.03, -0.05, 0]);
    b.loft([{ c: sh, rx: r0, ry: r0 }, { c: mid, rx: (r0 + r1) / 2, ry: (r0 + r1) / 2 }, { c: hand, rx: r1, ry: r1 }], { sides: 5, up: [0, 1, 0], sw, cap0: sw, crease: 0.012 });
    const p = o.paw ?? 0.065;
    b.loft([
      { c: add(hand, [0, 0, -0.04]), rx: p * 0.7, ry: p * 0.7 },
      { c: add(hand, [0, 0.005, 0.02]), rx: p, ry: p * 0.92 },
      { c: add(hand, [0, 0, 0.075]), rx: p * 0.62, ry: p * 0.6 },
    ], { sides: 6, axis: [0, 0, 1], up: [0, 1, 0], sw: pawSw, cap0: pawSw, cap1: pawSw, crease: 0.01 });
  });
}

// Eye = white (or coloured) cut-out + pupil + glint, facing n. pupil: [rx, ry, dx, dy, sides]
function eye(b, c, n, rw, rh, o = {}) {
  n = norm(n);
  const white = o.white ?? 'white';
  if (white) b.cutout(ngon(o.sides ?? 8, rw, rh, o.phase ?? 0), c, n, 0.018, white, 'dark', 'edge');
  const pc = add(c, mul(n, white ? 0.014 : 0));
  const [prx, pry, pdx, pdy, ps] = o.pupil || [rw * 0.55, rh * 0.62, 0, 0, 8];
  b.cutout(ngon(ps, prx, pry, 0, pdx, pdy), pc, n, 0.012, o.pupilSw || 'dark', 'dark', 'dark');
  if (o.glint !== false) {
    const g = Math.max(0.009, Math.min(prx, pry) * 0.34);
    b.cutout(ngon(5, g, g, 0, pdx - prx * 0.35, pdy + pry * 0.4), add(pc, mul(n, 0.009)), n, 0.004, 'white', null, null);
  }
}

function eyeOn(b, x, y, rw, rh, o = {}) {
  const s = b.stick(x, y, o.bone || 'head', o.lift ?? 0.008, o.front ?? 0.45);
  eye(b, s.c, s.n, rw, rh, o);
  return s;
}

// Pyramid ear: base centre, apex, base radius; inner face (front) swatch.
function pyramidEar(b, base, apex, r, outer, inner, tip) {
  const t = norm(sub(apex, base));
  const mid = lerp(base, apex, 0.72);
  b.loft([
    { c: base, rx: r, ry: r * 0.8 },
    { c: mid, rx: r * 0.34, ry: r * 0.28 },
    { c: apex, rx: 0, ry: 0 },
  ], { sides: 3, phase: -Math.PI / 2, up: [0, 0, 1], sw: (i, k, a) => (i >= 1 && tip ? tip : Math.sin(a) > 0.8 ? inner : outer), crease: 0.012 });
  return t;
}

// Streamer chain: rings along a path with weights blended at the joints.
function chainLoft(b, path, radii, bones, o = {}) {
  const rings = path.map((p, i) => {
    const f = (i / (path.length - 1)) * (bones.length - 1);
    const j = Math.min(bones.length - 1, Math.floor(f));
    const t = f - j;
    const w = t < 0.02 || j === bones.length - 1 ? b.weights(bones[j]) : b.blend(bones[j], bones[j + 1], t);
    const r = radii[i];
    return { c: p, rx: Array.isArray(r) ? r[0] : r, ry: Array.isArray(r) ? r[1] : r, w };
  });
  b.loft(rings, { sides: o.sides ?? 6, phase: o.phase ?? 0, up: o.up ?? [1, 0, 0], sw: o.sw || 'body', cap0: o.cap0 ?? null, cap1: o.cap1 ?? null, crease: o.crease ?? 0.014 });
}

function chainBones(b, names, parent, pivots) {
  names.forEach((n, i) => b.bone(n, i === 0 ? parent : names[i - 1], pivots[i]));
}

function chainBonesPair(b, stem, parent, pivots) {
  for (const s of ['L', 'R']) {
    pivots.forEach((p, i) => b.bone(stem + s + i, i === 0 ? parent : stem + s + (i - 1), s === 'L' ? p : [-p[0], p[1], p[2]]));
  }
}

// ---------------------------------------------------------------- characters

const Z = FRAME.seatZ;

const SPECS = {
  tilki: {
    kart: { hull: 'dart', pattern: 'chevrons', p2: '#fbf1df', emblem: 'flame', extra: {} },
    headTop: [0, 1.46, -0.36],
    bones(b) {
      b.bonePair('ear', 'head', [0.13, 1.4, -0.34]);
      chainBones(b, ['tail0', 'tail1', 'tail2'], 'torso', [[0, 0.7, -0.5], [0, 1.02, -0.8], [0, 1.3, -0.98]]);
      chainBones(b, ['flag0', 'flag1'], 'chassis', [[-0.42, 1.08, -0.9], [-0.42, 1.38, -0.92]]);
    },
    build(b) {
      b.use('torso');
      vloft(b, Z, [[0.5, 0.23, 0.19], [0.78, 0.24, 0.19], [0.98, 0.17, 0.15]], { sw: front('accent', 'body') });
      b.use('head');
      b.loft([
        { c: [0, 1.22, -0.52], rx: 0.16, ry: 0.16 },
        { c: [0, 1.24, -0.38], rx: 0.27, ry: 0.23 },
        { c: [0, 1.22, -0.17], rx: 0.25, ry: 0.2 },
        { c: [0, 1.15, 0.0], rx: 0.12, ry: 0.095 },
        { c: [0, 1.13, 0.11], rx: 0.045, ry: 0.04 },
      ], { sides: 8, phase: Math.PI / 8, up: [0, 1, 0], sw: (i, k, a) => (i >= 1 && Math.sin(a) < -0.2 ? 'accent' : 'body'), cap0: 'body', cap1: 'dark' });
      b.both((s) => {
        eyeOn(b, 0.1, 1.285, 0.036, 0.047, { white: null, pupil: [0.036, 0.047, 0, 0, 8], lift: 0.01 });
        b.use('ear' + s);
        pyramidEar(b, [0.13, 1.39, -0.34], [0.2, 1.68, -0.37], 0.1, 'body', 'accent', 'dark');
        b.use('head');
      });
      b.use('tail0');
      chainLoft(b,
        [[0, 0.7, -0.5], [0, 0.9, -0.68], [0, 1.1, -0.86], [0, 1.28, -0.98], [0, 1.42, -1.04], [0, 1.52, -1.06]],
        [0.06, 0.13, 0.18, 0.16, 0.1, 0],
        ['tail0', 'tail1', 'tail2'], { sw: (i) => (i >= 3 ? 'accent' : 'body') });
      arms(b, 'body', 'dark');
      // pennant on a whippy mast, rear right
      b.use('chassis');
      b.loft([{ c: [-0.42, 0.6, -0.88], rx: 0.018, ry: 0.018 }, { c: [-0.42, 1.08, -0.9], rx: 0.016, ry: 0.016 }], { sides: 5, sw: 'dark', crease: 0 });
      b.use('flag0');
      b.loft([{ c: [-0.42, 1.08, -0.9], rx: 0.016, ry: 0.016 }, { c: [-0.42, 1.46, -0.92], rx: 0.012, ry: 0.012 }], { sides: 5, sw: 'dark', cap1: 'dark', crease: 0 });
      b.use('flag1');
      b.slab([[0, 0.06], [0, -0.16], [0.4, -0.05]], [-0.42, 1.4, -0.92], [0, 0, -1], [0, 1, 0], 0.012, 'flag', 'flag', 'edge');
    },
    extra: (c) => ({ flag: { color: c.accent, pattern: 'chevrons', p2: c.kart } }),
    chains: [
      { bones: ['earL'], kind: 'ear', side: 1 }, { bones: ['earR'], kind: 'ear', side: -1 },
      { bones: ['tail0', 'tail1', 'tail2'], kind: 'tail' },
      { bones: ['flag0', 'flag1'], kind: 'flag' },
    ],
  },

  kurbaga: {
    kart: { hull: 'pad', pattern: 'ripples', p2: '#9fe0a4', emblem: 'drop' },
    headTop: [0, 1.5, -0.2],
    bones(b) {},
    build(b, ch) {
      b.use('torso');
      vloft(b, Z, [[0.5, 0.27, 0.22], [0.74, 0.29, 0.23], [0.92, 0.23, 0.19]], { sw: front('accent', 'body') });
      b.use('head');
      vloft(b, Z + 0.03, [[0.9, 0.22, 0.18], [1.0, 0.32, 0.25], [1.14, 0.34, 0.27], [1.26, 0.26, 0.2]], {
        sw: (i, k, a) => { const s = Math.sin(a); if (i === 1 && s > 0.95) return 'mouth'; if (i === 0 && s > 0.3) return 'accent'; return 'body'; },
      });
      b.both(() => {
        vloft(b, Z + 0.06, [[1.18, 0.1, 0.1, 0.15], [1.3, 0.12, 0.115, 0.15], [1.41, 0.1, 0.095, 0.15], [1.47, 0.055, 0.05, 0.15]], { sides: 7, phase: Math.PI / 14 });
        eyeOn(b, 0.155, 1.355, 0.075, 0.068, { pupil: [0.048, 0.03, 0, -0.004, 8], front: 0.3 });
      });
      arms(b, 'body', 'accent', { r0: 0.08 });
      // lily-pad wing on a stem, lotus on the nose
      b.use('chassis');
      b.loft([{ c: [0, 0.74, -0.8], rx: 0.03, ry: 0.03 }, { c: [0, 0.99, -0.89], rx: 0.03, ry: 0.03 }], { sides: 5, sw: 'kart2', crease: 0 });
      b.slab(ngon(11, 0.46, 0.37, 0.3), [0, 1.0, -0.9], [1, 0, 0], [0, 0.25, -0.97], 0.03, 'lily', 'kart2', 'edge');
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        const dir = [Math.cos(a), 0, Math.sin(a)];
        const n = norm([dir[0], 1.4, dir[2]]);
        const c = add([0, 0.55, 0.86], mul(dir, 0.06));
        b.cutout([[-0.045, -0.02], [0.045, -0.02], [0.03, 0.09], [0, 0.12], [-0.03, 0.09]], c, n, 0.012, 'detail', 'detail', 'edge', { upHint: [dir[0], 0, dir[2]] });
      }
      b.loft([{ c: [0, 0.5, 0.86], rx: 0.04, ry: 0.04 }, { c: [0, 0.6, 0.86], rx: 0.035, ry: 0.035 }], { sides: 6, axis: [0, 1, 0], up: [0, 0, 1], sw: 'lotusC', cap1: 'lotusC' });
    },
    extra: (c, K) => ({ mouth: { color: c.body, art: 'mouth', cheek: '#f39ab8' }, lily: { color: '#4fae4f', pattern: 'veins', p2: '#2f7f3a' }, lotusC: { color: '#f5d34a' } }),
    chains: [],
  },

  penguen: {
    kart: { hull: 'sled', pattern: 'snow', p2: '#f4fbff', emblem: 'snow', band: '#e2383f' },
    headTop: [0, 1.5, -0.28],
    bones(b) {
      chainBonesPair(b, 'scarf', 'torso', [[0.06, 1.0, -0.47], [0.08, 0.98, -0.66], [0.1, 0.95, -0.85]]);
    },
    build(b) {
      b.use('torso');
      vloft(b, Z, [[0.5, 0.25, 0.21], [0.8, 0.26, 0.21], [1.0, 0.2, 0.17]], { sw: front('accent', 'body') });
      vloft(b, Z, [[0.94, 0.225, 0.195], [1.05, 0.232, 0.2]], { sw: 'scarf', cap1: null, crease: 0.01 });
      b.use('head');
      vloft(b, Z + 0.02, [[0.98, 0.19, 0.17], [1.1, 0.24, 0.21], [1.28, 0.22, 0.19], [1.42, 0.14, 0.12], [1.5, 0, 0]], {
        sw: (i, k, a) => (i <= 1 && Math.sin(a) > 0.5 ? 'accent' : 'body'), cap1: null,
      });
      b.loft([{ c: [0, 1.16, -0.09], rx: 0.06, ry: 0.04 }, { c: [0, 1.14, 0.08], rx: 0, ry: 0 }], { sides: 4, phase: Math.PI / 4, up: [0, 1, 0], sw: 'beak', cap0: 'beak' });
      b.both((s) => {
        eyeOn(b, 0.085, 1.25, 0.032, 0.038, { white: null, pupil: [0.032, 0.038, 0, 0, 8] });
        b.use('scarf' + s + '0');
        chainLoft(b, [[0.06, 1.0, -0.45], [0.08, 0.98, -0.66], [0.1, 0.95, -0.85], [0.12, 0.92, -1.04]],
          [[0.065, 0.016], [0.065, 0.016], [0.06, 0.015], [0.055, 0.014]], ['scarf' + s + '0', 'scarf' + s + '1', 'scarf' + s + '2'],
          { sides: 4, phase: Math.PI / 4, up: [0, 1, 0], sw: 'scarf', cap1: 'scarfEnd', crease: 0.006 });
        b.use('head');
      });
      arms(b, 'body', 'body', { r0: 0.07, paw: 0.06 });
      b.use('chassis');
      b.both(() => b.slab([[-0.18, 0], [0.26, 0], [0.3, 0.46], [0.18, 0.44]], [0.36, 0.6, -0.84], [0, 0, -1], [0, 1, 0], 0.03, 'ice', 'ice', 'edge'));
    },
    extra: (c) => ({
      scarf: { color: c.detail, pattern: 'stripes', p2: '#fbf6ea' },
      scarfEnd: { color: c.detail },
      beak: { color: '#f4a12c' },
      ice: { color: '#bfe6f5', pattern: 'snow', p2: '#ffffff' },
    }),
    chains: [
      { bones: ['scarfL0', 'scarfL1', 'scarfL2'], kind: 'scarf', side: 1 },
      { bones: ['scarfR0', 'scarfR1', 'scarfR2'], kind: 'scarf', side: -1 },
    ],
  },

  ayi: {
    kart: { hull: 'tub', pattern: 'hex', p2: '#e39a1e', emblem: 'hex', band: '#8b5a34' },
    headTop: [0, 1.51, -0.28],
    bones(b) {
      b.bonePair('ear', 'head', [0.22, 1.44, -0.3]);
      b.bone('pot', 'chassis', [0.32, 0.62, -0.78]);
    },
    build(b) {
      b.use('torso');
      vloft(b, Z, [[0.5, 0.37, 0.29], [0.8, 0.39, 0.3], [1.02, 0.3, 0.24]], { sw: front('accent', 'body') });
      b.use('head');
      vloft(b, Z + 0.02, [[0.98, 0.25, 0.21], [1.1, 0.34, 0.27], [1.3, 0.33, 0.26], [1.46, 0.22, 0.18]]);
      b.loft([{ c: [0, 1.13, -0.06], rx: 0.125, ry: 0.085 }, { c: [0, 1.13, 0.04], rx: 0.1, ry: 0.07 }], { sides: 6, axis: [0, 0, 1], up: [0, 1, 0], sw: 'accent', cap1: 'accent' });
      b.loft([{ c: [0, 1.18, 0.02], rx: 0.05, ry: 0.032 }, { c: [0, 1.175, 0.07], rx: 0.04, ry: 0.026 }], { sides: 6, axis: [0, 0, 1], up: [0, 1, 0], sw: 'dark', cap1: 'dark', crease: 0 });
      b.both((s) => {
        eyeOn(b, 0.105, 1.27, 0.028, 0.032, { white: null, pupil: [0.028, 0.032, 0, 0, 7] });
        b.use('ear' + s);
        b.cutout(ngon(7, 0.1, 0.095), [0.22, 1.46, -0.3], [0.25, 0.25, 1], 0.05, 'body', 'body', 'body', { crease: 0.012 });
        b.cutout(ngon(7, 0.055, 0.05), [0.225, 1.455, -0.27], [0.25, 0.25, 1], 0.012, 'accent', null, 'edge');
        b.use('head');
      });
      arms(b, 'body', 'accent', { r0: 0.1, r1: 0.075, paw: 0.08, shoulder: [0.33, 0.93, Z] });
      // log bumper on two struts, mudguards over the rear wheels
      b.use('chassis');
      b.loft([{ c: [0.58, 0.3, 1.1], rx: 0.075, ry: 0.075 }, { c: [-0.58, 0.3, 1.1], rx: 0.075, ry: 0.075 }], { sides: 7, axis: [-1, 0, 0], up: [0, 1, 0], sw: 'wood', cap0: 'woodEnd', cap1: 'woodEnd', crease: 0.012 });
      b.both(() => {
        b.box([0.3, 0.33, 1.02], [0.06, 0.06, 0.12], 'dark');
        fender(b, FRAME.rear, 0.06, 0.17, 0.45, 2.75, 'kart', 'kart2');
      });
      // honey pot on the rear-left deck
      b.use('pot');
      vloft(b, -0.78, [[0.6, 0.14, 0.14, 0.32], [0.72, 0.2, 0.2, 0.32], [0.86, 0.19, 0.19, 0.32], [0.92, 0.13, 0.13, 0.32], [0.97, 0.16, 0.16, 0.32]], {
        sw: (i) => (i === 1 ? 'potBand' : 'pot'), cap1: 'honey',
      });
      b.cutout([[-0.04, 0.03], [0.04, 0.03], [0.03, -0.08], [0, -0.1], [-0.02, -0.06]], [0.32, 0.93, -0.64], [0, 0.2, 1], 0.012, 'honey', 'honey', 'honey');
      b.loft([{ c: [0.3, 0.9, -0.78], rx: 0.018, ry: 0.018 }, { c: [0.22, 1.18, -0.86], rx: 0.02, ry: 0.02 }], { sides: 5, sw: 'wood', cap1: 'wood', crease: 0 });
    },
    extra: (c) => ({
      pot: { color: '#c46a2b' }, potBand: { color: '#f3e6c8', pattern: 'hex', p2: '#f4c030' },
      honey: { color: '#f6bf2a' }, wood: { color: '#b98a50', pattern: 'ridges', p2: '#8e6536' }, woodEnd: { color: '#e3c08a' },
    }),
    chains: [
      { bones: ['earL'], kind: 'roundEar', side: 1 }, { bones: ['earR'], kind: 'roundEar', side: -1 },
      { bones: ['pot'], kind: 'wobble' },
    ],
  },

  kedi: {
    kart: { hull: 'wedge', pattern: 'paws', p2: '#f6c9cf', emblem: 'fish', band: '#2c2a33', emblemInk: '#d02f3f' },
    headTop: [0, 1.45, -0.28],
    bones(b) {
      b.bonePair('ear', 'head', [0.13, 1.35, -0.3]);
      b.bone('bell', 'torso', [0, 0.97, -0.13]);
      chainBones(b, ['tail0', 'tail1', 'tail2', 'tail3'], 'torso', [[0, 0.64, -0.5], [0, 0.86, -0.8], [0, 1.2, -0.86], [0, 1.44, -0.78]]);
    },
    build(b) {
      b.use('torso');
      vloft(b, Z, [[0.5, 0.22, 0.19], [0.78, 0.22, 0.19], [0.98, 0.16, 0.14]]);
      vloft(b, Z, [[0.93, 0.19, 0.165], [1.0, 0.196, 0.17]], { sw: 'collar', cap1: null, crease: 0.008 });
      b.use('bell');
      b.loft([{ c: [0, 0.9, -0.11], rx: 0.02, ry: 0.02 }, { c: [0, 0.915, -0.11], rx: 0.05, ry: 0.05 }, { c: [0, 0.96, -0.11], rx: 0.055, ry: 0.055 }, { c: [0, 0.99, -0.11], rx: 0.035, ry: 0.035 }],
        { sides: 7, axis: [0, 1, 0], up: [0, 0, 1], sw: 'bell', cap0: 'dark', cap1: 'bell', crease: 0.008 });
      b.use('head');
      vloft(b, Z + 0.02, [[1.0, 0.19, 0.17], [1.12, 0.25, 0.21], [1.28, 0.23, 0.2], [1.38, 0.15, 0.13]]);
      b.cutout([[-0.022, 0.012], [0.022, 0.012], [0, -0.016]], [0, 1.19, -0.075], [0, 0.1, 1], 0.01, 'pink', 'pink', 'pink');
      b.both((s) => {
        eyeOn(b, 0.095, 1.25, 0.058, 0.046, { white: 'accent', sides: 8, pupil: [0.011, 0.04, 0, 0, 6] });
        for (const [dy, tilt] of [[0.0, 0.05], [-0.025, -0.08]]) {
          b.slab([[0, -0.004], [0.2, -0.004 + tilt * 0.2], [0.2, 0.004 + tilt * 0.2], [0, 0.004]], [0.09, 1.17 + dy, -0.07], [1, 0, 0.25], [0, 1, 0], 0.005, 'white', 'white', 'white');
        }
        b.use('ear' + s);
        pyramidEar(b, [0.13, 1.34, -0.31], [0.2, 1.65, -0.32], 0.09, 'body', 'pink', null);
        b.use('head');
      });
      b.use('tail0');
      chainLoft(b, [[0, 0.64, -0.5], [0, 0.76, -0.66], [0, 0.88, -0.8], [0, 1.05, -0.87], [0, 1.22, -0.87], [0, 1.4, -0.82], [0, 1.52, -0.72], [0, 1.56, -0.6]],
        [0.05, 0.055, 0.055, 0.052, 0.05, 0.048, 0.045, 0.02], ['tail0', 'tail1', 'tail2', 'tail3'], { sides: 6, cap1: 'body' });
      arms(b, 'body', 'white', { r0: 0.065, r1: 0.05, paw: 0.058 });
      // cat-ear air scoops on the nose
      b.use('chassis');
      b.both(() => { const y = hullTop(b, 0.2, 0.6, 0.43) - 0.015; pyramidEar(b, [0.2, y, 0.6], [0.25, y + 0.25, 0.55], 0.11, 'kart', 'pink', null); });
    },
    extra: (c) => ({ collar: { color: c.detail }, bell: { color: '#e8b53a' }, pink: { color: '#f3a3b8' } }),
    chains: [
      { bones: ['earL'], kind: 'ear', side: 1 }, { bones: ['earR'], kind: 'ear', side: -1 },
      { bones: ['tail0', 'tail1', 'tail2', 'tail3'], kind: 'catTail' },
      { bones: ['bell'], kind: 'bell' },
    ],
  },

  baykus: {
    kart: { hull: 'plane', pattern: 'stars', p2: '#f0d27a', emblem: 'moon', band: '#d4a13d', metal: '#d4a13d' },
    headTop: [0, 1.5, -0.28],
    bones(b) {
      b.bonePair('ear', 'head', [0.18, 1.38, -0.32]);
      b.bone('prop', 'chassis', [0, 0.42, 1.1]);
    },
    build(b) {
      b.use('torso');
      vloft(b, Z, [[0.5, 0.24, 0.21], [0.7, 0.3, 0.25], [0.96, 0.3, 0.25]], { sw: front('feather', 'bodyP') });
      b.both(() => b.cutout([[0.02, 0.13], [0.11, 0.06], [0.1, -0.17], [0.02, -0.3], [-0.08, -0.21], [-0.1, 0.03]], [0.305, 0.8, -0.36], [1, 0, -0.3], 0.03, 'wing', 'bodyP', 'edge', { crease: 0.012 }));
      b.use('head');
      vloft(b, Z + 0.02, [[0.98, 0.28, 0.24], [1.12, 0.32, 0.27], [1.3, 0.3, 0.26], [1.42, 0.22, 0.19], [1.48, 0.1, 0.09]], { sw: front('body', 'bodyP'), cap1: 'bodyP' });
      vloft(b, Z + 0.02, [[1.2, 0.326, 0.276], [1.28, 0.316, 0.266]], { sw: 'dark', cap1: null, crease: 0 });
      b.loft([{ c: [0, 1.17, -0.05], rx: 0.04, ry: 0.035 }, { c: [0, 1.1, 0.03], rx: 0, ry: 0 }], { sides: 4, phase: Math.PI / 4, up: [0, 0, 1], sw: 'beak', cap0: 'beak' });
      b.both((s) => {
        b.cutout(ngon(9, 0.13, 0.13), [0.1, 1.23, -0.04], [0.25, 0.04, 1], 0.012, 'accent', null, 'edge');
        const n = norm([0.22, 0.04, 1]);
        const p = [0.105, 1.245, -0.035];
        b.loft([{ c: p, rx: 0.088, ry: 0.088 }, { c: add(p, mul(n, 0.06)), rx: 0.085, ry: 0.085 }], { sides: 8, phase: Math.PI / 8, axis: n, up: [0, 1, 0], sw: 'metal', cap1: 'goggle', capFit: 'cover', crease: 0.01, capCrease: 0.01 });
        b.use('ear' + s);
        b.cutout([[-0.065, 0], [0.065, 0], [0.16, 0.29]], [0.18, 1.37, -0.33], [0.15, 0, 1], 0.03, 'body', 'bodyP', 'edge');
        b.use('head');
      });
      arms(b, 'body', 'feather', { r0: 0.08 });
      b.use('chassis');
      b.both(() => b.slab([[0, -0.2], [0.36, -0.12], [0.4, 0.0], [0.36, 0.1], [0, 0.18]], [0.42, 0.52, 0.1], [1, 0, 0], [0, 0, -1], 0.03, 'kartP', 'kart2', 'edge'));
      b.use('prop');
      b.loft([{ c: [0, 0.42, 1.0], rx: 0.07, ry: 0.07 }, { c: [0, 0.42, 1.09], rx: 0.085, ry: 0.085 }, { c: [0, 0.42, 1.17], rx: 0, ry: 0 }], { sides: 6, axis: [0, 0, 1], up: [0, 1, 0], sw: 'spinner' });
      for (const sgn of [1, -1]) {
        b.slab([[-0.035, 0.05], [0.035, 0.05], [0.045, 0.28], [0, 0.34], [-0.04, 0.3]], [0, 0.42, 1.1], [sgn, 0, 0], [0, sgn, 0], 0.016, 'blade', 'blade', 'edge');
      }
    },
    extra: (c) => ({
      feather: { color: c.accent, pattern: 'feathers', p2: '#b3814a' }, beak: { color: '#e59a33' },
      bodyP: { color: c.body, pattern: 'feathers', p2: '#7e552c' }, wing: { color: '#9c6d3b', pattern: 'feathers', p2: '#f1dfb8' },
      goggle: { color: '#bfe4f0', art: 'goggle', glass: '#bfe4f0', iris: '#f2b63a', ch: 1, cw: 1 },
      spinner: { color: '#d8403a' }, blade: { color: '#c89a5a', pattern: 'stripes', p2: '#d8403a' },
    }),
    chains: [
      { bones: ['earL'], kind: 'tuft', side: 1 }, { bones: ['earR'], kind: 'tuft', side: -1 },
    ],
    prop: 'prop',
  },

  tavsan: {
    kart: { hull: 'bubble', pattern: 'dots', p2: '#fff3f8', emblem: 'carrot', band: '#f5f1e8', emblemInk: '#f08a2e' },
    headTop: [0, 1.4, -0.28],
    bones(b) {
      for (const s of ['L', 'R']) {
        const x = s === 'L' ? 1 : -1;
        b.bone('ear' + s, 'head', [0.08 * x, 1.3, -0.3]);
        b.bone('ear' + s + '2', 'ear' + s, [0.1 * x, 1.52, -0.32]);
      }
      b.bone('carrot', 'chassis', [-0.36, 0.6, -0.84]);
    },
    build(b) {
      b.use('torso');
      vloft(b, Z, [[0.5, 0.23, 0.2], [0.78, 0.24, 0.2], [0.96, 0.18, 0.16]]);
      b.use('head');
      vloft(b, Z + 0.02, [[0.98, 0.18, 0.16], [1.08, 0.24, 0.21], [1.24, 0.23, 0.2], [1.34, 0.15, 0.13]]);
      b.cutout([[-0.026, 0.014], [0.026, 0.014], [0, -0.018]], [0, 1.175, -0.078], [0, 0.15, 1], 0.012, 'accent', 'accent', 'accent');
      b.cutout([[-0.025, 0], [0.025, 0], [0.025, -0.04], [-0.025, -0.04]], [0, 1.14, -0.082], [0, 0, 1], 0.008, 'white', 'white', 'edge');
      b.both((s) => {
        eyeOn(b, 0.092, 1.24, 0.038, 0.048, { white: null, pupil: [0.038, 0.048, 0, 0, 8] });
        const ck = b.stick(0.15, 1.17, 'head', 0.006, 0.2);
        b.cutout(ngon(7, 0.035, 0.022), ck.c, ck.n, 0.006, 'accent', null, null);
        chainLoft(b, [[0.08, 1.28, -0.3], [0.1, 1.52, -0.32], [0.12, 1.68, -0.34], [0.13, 1.75, -0.35]],
          [[0.07, 0.028], [0.075, 0.03], [0.055, 0.025], [0, 0]], ['ear' + s, 'ear' + s + '2'],
          { sides: 6, phase: 0, up: [0, 0, 1], sw: (i, k, a) => (Math.sin(a) > 0.8 ? 'accent' : 'body') });
        b.use('head');
      });
      b.use('torso');
      b.loft([{ c: [0, 0.64, -0.49], rx: 0.06, ry: 0.06 }, { c: [0, 0.645, -0.55], rx: 0.09, ry: 0.085 }, { c: [0, 0.65, -0.62], rx: 0.06, ry: 0.055 }], { sides: 6, axis: [0, 0, -1], up: [0, 1, 0], sw: 'white', cap1: 'white' });
      arms(b, 'body', 'white', { r0: 0.068, r1: 0.05 });
      b.use('carrot');
      vloft(b, -0.84, [[0.56, 0.025, 0.025, -0.36], [0.8, 0.07, 0.07, -0.36], [1.06, 0.1, 0.1, -0.36], [1.1, 0.085, 0.085, -0.36]], { sides: 7, sw: 'carrot', cap1: 'carrotTop', crease: 0.014 });
      for (const [a, h] of [[-0.5, 0.26], [0.1, 0.32], [0.7, 0.24]]) {
        const d = [Math.sin(a) * 0.4, 1, 0];
        b.cutout([[-0.035, 0], [0.035, 0], [0.02, h], [-0.015, h + 0.03]], [-0.36 + d[0] * 0.02, 1.1, -0.84], [0, 0, 1], 0.012, 'leaf', 'leaf', 'edge', { upHint: norm(d) });
      }
    },
    extra: (c) => ({ carrot: { color: c.detail, pattern: 'ridges', p2: '#c9621c' }, carrotTop: { color: '#d8731f' }, leaf: { color: '#5aa845' } }),
    chains: [
      { bones: ['earL', 'earL2'], kind: 'longEar', side: 1 }, { bones: ['earR', 'earR2'], kind: 'longEar', side: -1 },
      { bones: ['carrot'], kind: 'wobble' },
    ],
  },

  ahtapot: {
    kart: { hull: 'sub', pattern: 'bubbles', p2: '#e8fbf9', emblem: 'swirl', band: '#8e4cc2', metal: '#f5d547' },
    headTop: [0, 1.72, -0.3],
    bones(b) {
      chainBonesPair(b, 'tb', 'torso', [[0.12, 0.72, -0.5], [0.16, 0.86, -0.82], [0.2, 0.78, -1.12]]);
      chainBonesPair(b, 'ts', 'torso', [[0.28, 0.68, -0.32], [0.48, 0.66, -0.5], [0.54, 0.64, -0.82]]);
      b.bone('peri', 'chassis', [0.36, 0.62, -0.86]);
    },
    build(b) {
      const hw = (t) => b.blend('torso', 'head', t);
      // a bulb, not a tube: narrow face band, mantle swelling behind and above it
      const rings = [[0.5, 0.26, 0.22], [0.7, 0.31, 0.26], [0.88, 0.29, 0.25], [1.06, 0.33, 0.29], [1.28, 0.39, 0.34], [1.48, 0.35, 0.31], [1.62, 0.23, 0.2], [1.7, 0.08, 0.07], [1.72, 0, 0]];
      const ws = [hw(0), hw(0), hw(0.5), hw(1), hw(1), hw(1), hw(1), hw(1), hw(1)];
      b.loft(rings.map(([y, rx, rz], i) => ({ c: [0, y, Z], rx, ry: rz, w: ws[i] })), {
        sides: 8, phase: Math.PI / 8, up: [0, 0, 1], sw: (i, k, a) => (i <= 1 && Math.sin(a) > 0.5 ? 'body' : 'bodyP'),
      });
      b.use('head');
      b.both((s) => {
        eye(b, [0.105, 0.98, -0.05], [0.28, 0.05, 1], 0.085, 0.09, { pupil: [0.06, 0.023, 0, -0.006, 6] });
        b.cutout([[-0.09, 0], [0.09, 0], [0.072, 0.04], [-0.072, 0.04]], [0.105, 1.08, -0.05], [0.28, 0.3, 1], 0.014, 'accent', 'accent', 'edge');
      });
      arms(b, 'body', 'accent', { r0: 0.07, r1: 0.045, paw: 0.05, shoulder: [0.22, 0.8, Z + 0.05] });
      b.both((s) => {
        chainLoft(b, [[0.12, 0.72, -0.48], [0.14, 0.84, -0.66], [0.16, 0.87, -0.84], [0.19, 0.8, -1.04], [0.21, 0.72, -1.22], [0.23, 0.73, -1.36], [0.24, 0.8, -1.42]],
          [0.075, 0.07, 0.062, 0.05, 0.04, 0.03, 0], ['tb' + s + '0', 'tb' + s + '1', 'tb' + s + '2'],
          { sides: 6, up: [0, 1, 0], sw: (i, k, a) => (Math.sin(a) < -0.3 ? 'sucker' : 'body') });
        chainLoft(b, [[0.26, 0.68, -0.3], [0.4, 0.7, -0.4], [0.5, 0.69, -0.54], [0.55, 0.68, -0.74], [0.54, 0.68, -0.92], [0.5, 0.72, -1.06], [0.47, 0.8, -1.1]],
          [0.075, 0.068, 0.058, 0.048, 0.038, 0.028, 0], ['ts' + s + '0', 'ts' + s + '1', 'ts' + s + '2'],
          { sides: 6, up: [0, 1, 0], sw: (i, k, a) => (Math.sin(a) < -0.3 ? 'sucker' : 'body') });
      });
      b.use('peri');
      vloft(b, -0.86, [[0.6, 0.045, 0.045, 0.36], [1.2, 0.04, 0.04, 0.36]], { sides: 6, sw: 'metal', cap1: 'metal', crease: 0.008 });
      b.loft([{ c: [0.36, 1.2, -0.9], rx: 0.055, ry: 0.055 }, { c: [0.36, 1.22, -0.72], rx: 0.06, ry: 0.06 }], { sides: 6, axis: [0, 0, 1], up: [0, 1, 0], sw: 'metal', cap0: 'metal', cap1: 'lens', crease: 0.008 });
    },
    extra: (c) => ({
      bodyP: { color: c.body, pattern: 'spots', p2: '#b88ae0' },
      sucker: { color: c.accent, pattern: 'suckers', p2: '#f3e3fb' },
      lens: { color: '#9fd8f0' },
    }),
    chains: [
      { bones: ['tbL0', 'tbL1', 'tbL2'], kind: 'tentacle', side: 1, phase: 0 },
      { bones: ['tbR0', 'tbR1', 'tbR2'], kind: 'tentacle', side: -1, phase: 1.7 },
      { bones: ['tsL0', 'tsL1', 'tsL2'], kind: 'tentacle', side: 1, phase: 3.1 },
      { bones: ['tsR0', 'tsR1', 'tsR2'], kind: 'tentacle', side: -1, phase: 4.4 },
    ],
    peri: 'peri',
  },
};

export function modelSpec(id) {
  return SPECS[id] || SPECS.tilki;
}

export function atlasSpec(ch) {
  const S = modelSpec(ch.id);
  const K = S.kart;
  return swatches(ch, { ...K, extra: S.extra ? S.extra(ch.colors, K) : {} });
}

// Builds the character once: typed arrays + bone table + anchors + animation metadata.
export function buildModel(ch, atlas) {
  const S = modelSpec(ch.id);
  const b = new PaperBuilder(atlas);
  skeleton(b);
  S.bones(b);
  chassis(b, S.kart);
  S.build(b, ch);
  const F = FRAME.rear;
  const idx = (n) => b.index[n];
  const anchors = {
    // rear-wheel contact patch, lifted 0.1 m and just behind it: where drift sparks leave the road
    wheelRL: { bone: idx('root'), pos: [F.x, 0.1, F.z - 0.14] },
    wheelRR: { bone: idx('root'), pos: [-F.x, 0.1, F.z - 0.14] },
    exhaust: { bone: idx('chassis'), pos: FRAME.exhaust.slice() },
    head: { bone: idx('head'), pos: S.headTop.slice() },
  };
  const chains = (S.chains || []).map((c) => ({ ...c, bones: c.bones.map(idx) }));
  const arrays = b.toArrays();
  return {
    arrays,
    bones: b.bones,
    index: { ...b.index },
    anchors,
    chains,
    prop: S.prop ? idx(S.prop) : -1,
    peri: S.peri ? idx(S.peri) : -1,
    missing: [...b.missing],
    triangles: arrays.position.length / 9,
  };
}
