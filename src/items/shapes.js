// Procedural geometry and the box face atlas for the item visuals. Everything is built in code (§2).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { drawLettering } from '../ui/lettering.js';

const _c = new THREE.Color();

function paint(geo, hex) {
  _c.set(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function merge(parts) {
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return g;
}

// Deterministic hash in [0,1) for designed irregularity.
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// --------------------------------------------------------------------------------------------
// Origami item box: a cube standing on y = 0 with faces 0 bottom, 1 +z, 2 -z, 3 +x, 4 -x, 5 top.
// `aFace` lets the vertex shader unfold it into a cross-shaped net on the page. Opposite faces share
// one of three atlas cells, like a three-colour sonobe cube.

const FACES = [
  { n: [0, -1, 0], v: [0, 0, 1], cell: 1 },
  { n: [0, 0, 1], v: [0, 1, 0], cell: 0 },
  { n: [0, 0, -1], v: [0, 1, 0], cell: 0 },
  { n: [1, 0, 0], v: [0, 1, 0], cell: 2 },
  { n: [-1, 0, 0], v: [0, 1, 0], cell: 2 },
  { n: [0, 1, 0], v: [0, 0, -1], cell: 1 },
];

export function boxGeometry(h) {
  const pos = [], uv = [], face = [];
  const N = new THREE.Vector3(), V = new THREE.Vector3(), U = new THREE.Vector3(), C = new THREE.Vector3(), P = new THREE.Vector3();
  const pad = 4 / 768;
  FACES.forEach((f, id) => {
    N.fromArray(f.n);
    V.fromArray(f.v);
    U.crossVectors(V, N);
    C.set(0, h, 0).addScaledVector(N, h);
    const u0 = f.cell / 3 + pad, u1 = (f.cell + 1) / 3 - pad;
    const corner = (a, b) => {
      P.copy(C).addScaledVector(U, a * h).addScaledVector(V, b * h);
      pos.push(P.x, P.y, P.z);
      uv.push(u0 + (u1 - u0) * (a + 1) / 2, 0.016 + 0.968 * (b + 1) / 2);
      face.push(id);
    };
    corner(-1, -1); corner(1, -1); corner(1, 1);
    corner(-1, -1); corner(1, 1); corner(-1, 1);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFace', new THREE.Float32BufferAttribute(face, 1));
  g.computeVertexNormals();
  return g;
}

// 768×256: three face designs (one per paper colour) with a fold, a printed frame and a cut-paper "?".
export function boxAtlas(colors, ink, paper, bodyFont) {
  const cv = document.createElement('canvas');
  cv.width = 768;
  cv.height = 256;
  const g = cv.getContext('2d');
  for (let i = 0; i < 3; i++) {
    const x0 = i * 256;
    g.save();
    g.beginPath();
    g.rect(x0, 0, 256, 256);
    g.clip();
    g.fillStyle = colors[i % colors.length];
    g.fillRect(x0, 0, 256, 256);
    // one half of the face sits a fold deeper; the crease catches the light
    g.fillStyle = 'rgba(45, 42, 50, 0.13)';
    g.beginPath();
    if (i % 2 === 0) { g.moveTo(x0, 0); g.lineTo(x0 + 256, 256); g.lineTo(x0, 256); }
    else { g.moveTo(x0 + 256, 0); g.lineTo(x0 + 256, 256); g.lineTo(x0, 256); }
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(255, 250, 235, 0.6)';
    g.lineWidth = 3;
    g.beginPath();
    if (i % 2 === 0) { g.moveTo(x0, 0); g.lineTo(x0 + 256, 256); }
    else { g.moveTo(x0 + 256, 0); g.lineTo(x0, 256); }
    g.stroke();
    g.strokeStyle = ink;
    g.globalAlpha = 0.55;
    g.lineWidth = 5;
    g.strokeRect(x0 + 22, 22, 212, 212);
    g.globalAlpha = 1;
    let drawn = false;
    try {
      drawLettering(g, '?', {
        x: x0 + 128, y: 128, size: 170, align: 'center', baseline: 'middle', seed: 11 + i * 7,
        colors: { fill: paper, shadow: ink, ink },
      });
      drawn = true;
    } catch (e) { /* lettering missing: fall back to the body font */ }
    if (!drawn) {
      g.font = `bold 190px ${bodyFont}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = ink;
      g.fillText('?', x0 + 136, 142);
      g.fillStyle = paper;
      g.fillText('?', x0 + 128, 134);
    }
    g.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// --------------------------------------------------------------------------------------------
// Gum blob: a smooth lumpy unit ball, flat underneath, with a printed sheen stripe (a narrow crescent
// towards the light) and a hot spot. Drawn with smooth shading, so it reads as soft, not faceted.

function smoothBall(ws, hs) {
  const s = new THREE.SphereGeometry(1, ws, hs);
  s.deleteAttribute('uv');
  s.deleteAttribute('normal');
  const g = mergeVertices(s);
  s.dispose();
  return g;
}

// Colours each vertex: shine on the crescent band / hot spot, shade underneath, base elsewhere.
function sheen(g, base, shine, shade, L, band, spot, under) {
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const cB = new THREE.Color(base), cS = new THREE.Color(shine), cD = new THREE.Color(shade);
  const n = new THREE.Vector3();
  const side = new THREE.Vector3(L.z, 0, -L.x).normalize();
  for (let i = 0; i < p.count; i++) {
    n.fromBufferAttribute(p, i).normalize();
    const d = n.dot(L);
    const onBand = d > band[0] && d < band[1] && n.dot(side) > -0.15;
    const k = d > spot || onBand ? cS : n.y < under ? cD : cB;
    col[i * 3] = k.r; col[i * 3 + 1] = k.g; col[i * 3 + 2] = k.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

export function blobGeometry(base, shine, shade) {
  const g = smoothBall(22, 14);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const r = 1 + 0.07 * Math.sin(v.x * 3.1 + 1.3) * Math.sin(v.z * 2.7 + 0.4) + 0.05 * Math.sin(v.y * 4.2 + v.x * 1.7);
    v.multiplyScalar(r);
    if (v.y < -0.45) v.y = -0.45 - (v.y + 0.45) * 0.1;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  sheen(g, base, shine, shade, new THREE.Vector3(-0.35, 0.85, 0.4).normalize(), [0.8, 0.9], 0.975, -0.35);
  g.computeVertexNormals();
  return g;
}

// Chewed gum: a soft wad with a lobed outline, two tooth dents on top and a flat underside. `aBub` keeps
// the unit sphere it was pressed from, so the gum material can blow the same mesh up into a bubble
// (per instance). Creases, gores and gloss are printed by that material; the colours here only shade
// the underside.
export function gumGeometry() {
  const g = smoothBall(30, 18);
  const p = g.attributes.position;
  g.setAttribute('aBub', new THREE.BufferAttribute(p.array.slice(), 3));
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x);
    const r = 1 + 0.11 * Math.sin(a * 5 + 0.7) + 0.05 * Math.sin(a * 3 - 1.2) + 0.04 * Math.sin(v.y * 5 + a * 2);
    v.x *= r;
    v.z *= r;
    if (v.y > 0) {
      // tooth dents: two shallow bites across the top
      const bite = Math.exp(-((v.x - 0.25) ** 2 + (v.z + 0.1) ** 2) * 9) + 0.8 * Math.exp(-((v.x + 0.35) ** 2 + (v.z - 0.3) ** 2) * 10);
      v.y *= 1 - 0.28 * bite;
    }
    if (v.y < -0.5) v.y = -0.5 - (v.y + 0.5) * 0.08;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  sheen(g, '#f55fa3', '#f55fa3', '#c8457f', new THREE.Vector3(0, 1, 0), [2, 3], 2, -0.45);
  g.computeVertexNormals();
  return g;
}

// Designed crease cells for the gum print: a golden-angle spiral of points on the unit sphere.
export function gumSeeds(n = 9) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.39996 + 0.4;
    out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return out;
}

// Ink drop: a teardrop with its tip along +y (the visuals point the tip against the drop's motion).
export function dropGeometry() {
  const prof = [];
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2 + 0.55);
    prof.push(new THREE.Vector2(Math.max(0.001, 0.5 * Math.cos(a)), 0.5 * Math.sin(a)));
  }
  prof.push(new THREE.Vector2(0.001, 1.25));
  const lathe = new THREE.LatheGeometry(prof, 10);
  lathe.deleteAttribute('uv');
  lathe.deleteAttribute('normal');
  const g = mergeVertices(lathe);
  lathe.dispose();
  sheen(g, '#1f3a8a', '#b9ccf5', '#132659', new THREE.Vector3(-0.5, 0.35, 0.8).normalize(), [0.72, 0.86], 0.96, -0.6);
  g.computeVertexNormals();
  return g;
}

// Landed ink: a flat lobed splat (unit radius, domed a little) with a few satellite dots and a
// printed gloss crescent.
export function splatGeometry() {
  const pos = [], col = [];
  const base = new THREE.Color('#1f3a8a'), rim = new THREE.Color('#172e70'), shine = new THREE.Color('#9fb6ee');
  const push = (x, y, z, c) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); };
  const blot = (cx, cz, R, lobes, seed, gloss) => {
    const N = 28;
    const rad = (i) => {
      const a = (i / N) * Math.PI * 2;
      return R * (0.8 + 0.2 * Math.sin(a * lobes + seed) + 0.1 * (hash3(i, seed, 3) - 0.5));
    };
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      const r0 = rad(i), r1 = rad((i + 1) % N);
      const o0x = cx + Math.cos(a0) * r0, o0z = cz + Math.sin(a0) * r0;
      const o1x = cx + Math.cos(a1) * r1, o1z = cz + Math.sin(a1) * r1;
      const i0x = cx + Math.cos(a0) * r0 * 0.62, i0z = cz + Math.sin(a0) * r0 * 0.62;
      const i1x = cx + Math.cos(a1) * r1 * 0.62, i1z = cz + Math.sin(a1) * r1 * 0.62;
      const h = 0.12 * R;
      const g = gloss && Math.cos(a0 - 2.4) > 0.55 ? shine : base;
      push(cx, h * 1.3, cz, base); push(i1x, h, i1z, g); push(i0x, h, i0z, g);
      push(i0x, h, i0z, base); push(i1x, h, i1z, base); push(o1x, 0, o1z, rim);
      push(i0x, h, i0z, base); push(o1x, 0, o1z, rim); push(o0x, 0, o0z, rim);
    }
  };
  blot(0, 0, 1, 7, 0.7, true);
  blot(1.25, 0.35, 0.16, 3, 2.1, false);
  blot(-0.6, 1.12, 0.12, 3, 4.2, false);
  blot(-1.05, -0.75, 0.2, 3, 5.3, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// --------------------------------------------------------------------------------------------
// Paper plane (dart fold), nose +z. `aStripe` marks the bands the homing plane prints red, `aFin` the
// folded nose fin only the homing plane keeps (the shader collapses it for plain planes).

export function flyerGeometry() {
  const pos = [], col = [], stripe = [], fin = [];
  const S = 1.65;
  const Nz = new THREE.Vector3(0, 0.02, 1.0);
  const T = new THREE.Vector3(0, 0, -0.8);
  const WL = new THREE.Vector3(0.62, 0.17, -0.8);
  const WR = new THREE.Vector3(-0.62, 0.17, -0.8);
  const Kb = new THREE.Vector3(0, -0.26, -0.72);
  const white = new THREE.Color('#fbf6e9'), keel = new THREE.Color('#e4d9c2'), crease = new THREE.Color('#8f887c'), red = new THREE.Color('#d9483b');
  const tri = (a, b, c, color, st = 0, fn = 0) => {
    for (const v of [a, b, c]) {
      pos.push(v.x * S, v.y * S, v.z * S);
      col.push(color.r, color.g, color.b);
      stripe.push(st);
      fin.push(fn);
    }
  };
  const lerp = (a, b, t) => a.clone().lerp(b, t);
  const BANDS = [0, 0.22, 0.36, 0.56, 0.7, 1];
  const STRIPED = [0, 1, 0, 1, 0];
  for (const W of [WL, WR]) {
    const flip = W === WR;
    // a hairline strip along the centre fold prints the crease
    const Wc = lerp(T, W, 0.04);
    for (let bi = 0; bi < BANDS.length - 1; bi++) {
      const s0 = BANDS[bi], s1 = BANDS[bi + 1];
      const c0 = lerp(Nz, T, s0), c1 = lerp(Nz, T, s1);
      const e0 = lerp(Nz, W, s0), e1 = lerp(Nz, W, s1);
      const k0 = lerp(Nz, Wc, s0), k1 = lerp(Nz, Wc, s1);
      const st = STRIPED[bi];
      if (bi === 0) {
        flip ? tri(Nz, k1, c1, crease) : tri(Nz, c1, k1, crease);
        flip ? tri(Nz, e1, k1, white, st) : tri(Nz, k1, e1, white, st);
      } else {
        flip ? tri(c0, k0, k1, crease) : tri(c0, k1, k0, crease);
        flip ? tri(c0, k1, c1, crease) : tri(c0, c1, k1, crease);
        flip ? tri(k0, e0, e1, white, st) : tri(k0, e1, e0, white, st);
        flip ? tri(k0, e1, k1, white, st) : tri(k0, k1, e1, white, st);
      }
    }
  }
  tri(Nz, Kb, T, keel);
  tri(Nz, T, Kb, keel);
  // folded nose fin
  const f0 = new THREE.Vector3(0, 0.03, 0.82), f1 = new THREE.Vector3(0, 0.03, 0.38), f2 = new THREE.Vector3(0, 0.3, 0.48);
  tri(f0, f1, f2, red, 1, 1);
  tri(f0, f2, f1, red, 1, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aStripe', new THREE.Float32BufferAttribute(stripe, 1));
  g.setAttribute('aFin', new THREE.Float32BufferAttribute(fin, 1));
  g.computeVertexNormals();
  return g;
}

// --------------------------------------------------------------------------------------------
// Fountain pen along -z: clip end at z = 0, nib tip at z ≈ -1.35, with a binder clip at the clip end.

const along = (geo) => geo.rotateX(Math.PI / 2); // cylinder axis y → z

export function penGeometry() {
  const barrel = '#2b3a6b', barrel2 = '#3b4f8f', gold = '#e0b44c', black = '#1d1b22', steel = '#c9ced6';
  const parts = [
    paint(along(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 4)).rotateZ(Math.PI / 4).scale(1.15, 0.72, 1).translate(0, 0, -0.1), black),
    paint(new THREE.BoxGeometry(0.035, 0.34, 0.035).rotateX(-0.5).translate(0.09, 0.2, 0.02), steel),
    paint(new THREE.BoxGeometry(0.035, 0.34, 0.035).rotateX(-0.5).translate(-0.09, 0.2, 0.02), steel),
    paint(along(new THREE.CylinderGeometry(0.13, 0.13, 0.42, 8)).translate(0, 0, -0.26), barrel),
    paint(new THREE.BoxGeometry(0.04, 0.03, 0.34).translate(0, 0.14, -0.24), gold),
    paint(along(new THREE.CylinderGeometry(0.138, 0.138, 0.05, 8)).translate(0, 0, -0.47), gold),
    paint(along(new THREE.CylinderGeometry(0.12, 0.125, 0.46, 8)).translate(0, 0, -0.72), barrel2),
    paint(along(new THREE.CylinderGeometry(0.1, 0.085, 0.16, 8)).translate(0, 0, -1.03), black),
    paint(new THREE.ConeGeometry(0.1, 0.3, 6).rotateX(-Math.PI / 2).scale(1, 0.45, 1).translate(0, 0.01, -1.26), gold),
    paint(new THREE.BoxGeometry(0.012, 0.03, 0.2).translate(0, 0.045, -1.24), black),
  ];
  const g = merge(parts);
  g.computeVertexNormals();
  return g;
}

// Ink bottle, centred on its middle so it tumbles about it.
export function bottleGeometry() {
  const glass = '#26345c', label = '#efe4c8', cap = '#1d1b22', inkBlue = '#2f58a8';
  const parts = [
    paint(new THREE.CylinderGeometry(0.33, 0.37, 0.52, 8).translate(0, 0.26, 0), glass),
    paint(new THREE.CylinderGeometry(0.372, 0.378, 0.24, 8).translate(0, 0.27, 0), label),
    paint(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 6).rotateX(Math.PI / 2).translate(0, 0.28, 0.375), inkBlue),
    paint(new THREE.CylinderGeometry(0.16, 0.33, 0.14, 8).translate(0, 0.59, 0), glass),
    paint(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 8).translate(0, 0.71, 0), glass),
    paint(new THREE.CylinderGeometry(0.17, 0.17, 0.16, 8).translate(0, 0.84, 0), cap),
  ];
  const g = merge(parts).translate(0, -0.42, 0).scale(2, 2, 2);
  g.computeVertexNormals();
  return g;
}

// One half of a pair of scissors lying flat (blade along +z, handle ring towards -z/+x); the other
// half is the same geometry rolled half a turn about z.
export function scissorsHalfGeometry() {
  const steel = '#cdd2da', edge = '#8e96a3', handle = '#e8743b', screw = '#4a4750';
  const blade = new THREE.BoxGeometry(0.22, 0.05, 1.7, 1, 1, 1).translate(0.06, 0.035, 0.85);
  const p = blade.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getZ(i) > 1.0) p.setX(i, 0.05 + (p.getX(i) - 0.05) * 0.12);
  }
  paint(blade, steel);
  const bevel = paint(new THREE.BoxGeometry(0.04, 0.052, 1.5).translate(-0.06, 0.036, 0.7), edge);
  const shank = paint(new THREE.BoxGeometry(0.13, 0.05, 0.5).rotateY(-0.35).translate(0.12, 0.035, -0.24), steel);
  const ring = paint(new THREE.TorusGeometry(0.26, 0.08, 5, 10).rotateX(Math.PI / 2).scale(1, 1, 1.25).translate(0.34, 0.035, -0.72), handle);
  const pin = paint(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 8).translate(0, 0.035, 0), screw);
  const g = merge([blade, bevel, shank, ring, pin]).scale(1.5, 1.5, 1.5);
  g.computeVertexNormals();
  return g;
}

// Flat unit disc on the xz plane (hard ink shadows under hovering items).
export function discGeometry() {
  return new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
}

// --------------------------------------------------------------------------------------------
// Foil: the kart wrapped like a sweet in clear cellophane, twisted shut at both ends into gold-foil
// frills. The body of the wrap encloses kart and driver (y ≈ 0.03 … 1.85) and is drawn see-through,
// so the kart stays readable; `aEnd` is 1 on the gathered ends, which the material prints as opaque gold.

export function foilShellGeometry() {
  const SIDES = 16;
  // [z, radius, twist] from the tail frill to the nose frill
  const RINGS = [
    [-2.02, 0.5, 1.0], [-1.86, 0.15, 0.7], [-1.62, 0.36, 0.35], [-1.3, 0.8, 0.08], [-0.75, 0.97, 0],
    [0, 1.0, 0], [0.75, 0.97, 0], [1.3, 0.8, -0.08], [1.62, 0.36, -0.35], [1.86, 0.15, -0.7], [2.02, 0.5, -1.0],
  ];
  const END = [1, 1, 0.55, 0, 0, 0, 0, 0, 0.55, 1, 1];
  const SX = 1.0, SY = 0.92, CY = 0.9;
  const pos = [];
  const end = [];
  const index = [];
  for (let r = 0; r < RINGS.length; r++) {
    const [z, rad, tw] = RINGS[r];
    const flare = r === 0 || r === RINGS.length - 1;
    for (let s = 0; s < SIDES; s++) {
      const a = (s / SIDES) * Math.PI * 2 + tw;
      let k = 1 + (hash3(r, s, 1) - 0.5) * (flare ? 0.2 : 0.07);
      if (flare) k *= s % 2 ? 0.6 : 1.15; // gathered foil fans out raggedly
      const sy = flare || RINGS[r][1] < 0.5 ? 0.62 : SY;
      const x = Math.cos(a) * rad * k * SX;
      const y = Math.max(0.03, Math.sin(a) * rad * k * sy + CY);
      pos.push(x, y, z + (hash3(s, r, 2) - 0.5) * (flare ? 0.2 : 0.05));
      end.push(END[r]);
    }
  }
  for (let r = 0; r < RINGS.length - 1; r++) {
    for (let s = 0; s < SIDES; s++) {
      const a = r * SIDES + s, b = r * SIDES + ((s + 1) % SIDES);
      const c = a + SIDES, d = b + SIDES;
      index.push(a, b, c, b, d, c);
    }
  }
  // close both ragged ends
  const tail = pos.length / 3;
  pos.push(0, CY, RINGS[0][0] - 0.02);
  end.push(1);
  const nose = tail + 1;
  pos.push(0, CY, RINGS[RINGS.length - 1][0] + 0.02);
  end.push(1);
  const last = (RINGS.length - 1) * SIDES;
  for (let s = 0; s < SIDES; s++) {
    index.push(tail, (s + 1) % SIDES, s);
    index.push(nose, last + s, last + ((s + 1) % SIDES));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aEnd', new THREE.Float32BufferAttribute(end, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
