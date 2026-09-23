// Paper-prop geometry kit. Every part is painted with vertex colours and merged, so a whole prop
// type is one geometry drawn by one InstancedMesh with the shared vertex-colour paper material.
// Local frame of a prop: origin at the base centre on the page, +Y up, +Z faces the road; the
// pop-up hinge is the local X axis through the origin.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _col = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mixHex(a, b, t) {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

function paintRange(geo, color, start, count) {
  _col.set(color);
  const c = geo.attributes.color.array;
  for (let i = start; i < start + count; i++) { c[i * 3] = _col.r; c[i * 3 + 1] = _col.g; c[i * 3 + 2] = _col.b; }
}

// Non-indexed, uv-free, coloured copy (mergeGeometries needs matching attributes).
function prepare(geo, color) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
  paintRange(g, color, 0, g.attributes.position.count);
  return g;
}

function place(g, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  return g;
}

// ------------------------------------------------------------------ 2D outlines

export function circlePts(r, n = 16, cx = 0, cy = 0) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}

export function flowerPts(petals, rOut, rIn, perPetal = 5, cx = 0, cy = 0) {
  const out = [];
  const n = petals * perPetal;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = Math.abs(Math.sin((a * petals) / 2));
    const r = rIn + (rOut - rIn) * Math.pow(k, 0.6);
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

export function starPts(points, rOut, rIn, cx = 0, cy = 0, rot = Math.PI / 2) {
  const out = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? rIn : rOut;
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

export function roundRectPts(w, h, r, n = 4, cx = 0, cy = 0) {
  const out = [];
  const corners = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 1], [-w / 2 + r, -h / 2 + r, 2], [w / 2 - r, -h / 2 + r, 3]];
  for (const [x, y, q] of corners) {
    for (let i = 0; i <= n; i++) {
      const a = (q + i / n) * Math.PI / 2;
      out.push([cx + x + Math.cos(a) * r, cy + y + Math.sin(a) * r]);
    }
  }
  return out;
}

// Lens-shaped leaf from (0, 0) along +X.
export function leafPts(len, width, n = 6) {
  const out = [];
  for (let i = 0; i <= n; i++) { const f = i / n; out.push([f * len, Math.sin(f * Math.PI) * width / 2]); }
  for (let i = n - 1; i > 0; i--) { const f = i / n; out.push([f * len, -Math.sin(f * Math.PI) * width / 2]); }
  return out;
}

// Upper half-ellipse (hills, domes, arches), base on y = 0.
export function archPts(w, h, n = 14, cx = 0) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = Math.PI * (1 - i / n); out.push([cx + Math.cos(a) * w / 2, Math.sin(a) * h]); }
  return out;
}

// Puffy outline from a row of circles (clouds, bushes, smoke): max radius over sample angles.
export function blobPts(circles, n = 40) {
  let cx = 0, cy = 0;
  for (const [x, y] of circles) { cx += x; cy += y; }
  cx /= circles.length; cy /= circles.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    let best = 0;
    for (const [x, y, r] of circles) {
      const ox = x - cx, oy = y - cy;
      const b = ox * dx + oy * dy;
      const disc = b * b - (ox * ox + oy * oy - r * r);
      if (disc >= 0) best = Math.max(best, b + Math.sqrt(disc));
    }
    out.push([cx + dx * best, cy + dy * best]);
  }
  return out;
}

function shapeOf(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

// ------------------------------------------------------------------ parts

export class Parts {
  constructor() { this.list = []; }

  add(geo, color, tr) { this.list.push(place(prepare(geo, color), tr)); return this; }

  // Box with its base at `y`.
  box(w, h, d, color, tr = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    return this.add(g, color, tr);
  }

  // Gable roof: triangle w × h extruded along z by d, base at `y`.
  roof(w, h, d, color, tr = {}, eave = 0) {
    const s = shapeOf([[-w / 2 - eave, 0], [w / 2 + eave, 0], [0, h]]);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    return this.add(g, color, tr);
  }

  cyl(rTop, rBot, h, color, tr = {}, seg = 8, open = false) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
    g.translate(0, h / 2, 0);
    return this.add(g, color, tr);
  }

  cone(r, h, color, tr = {}, seg = 8) {
    const g = new THREE.ConeGeometry(r, h, seg);
    g.translate(0, h / 2, 0);
    return this.add(g, color, tr);
  }

  ball(r, color, tr = {}, detail = 0) {
    return this.add(new THREE.IcosahedronGeometry(r, detail), color, tr);
  }

  // Die-cut card: outline pts (x, y) in the XY plane, `t` thick, pale card core on the cut edge.
  card(pts, t, face, edge, tr = {}) {
    const g = new THREE.ExtrudeGeometry(shapeOf(pts), { depth: t, bevelEnabled: false, curveSegments: 4 });
    g.translate(0, 0, -t / 2);
    const groups = g.groups.map((gr) => ({ ...gr }));
    const pg = prepare(g, face);
    for (const gr of groups) if (gr.materialIndex === 1) paintRange(pg, edge, gr.start, gr.count);
    this.list.push(place(pg, tr));
    return this;
  }

  // Two-faced cut sheet without side walls, for small props drawn by the hundred.
  sheet(pts, color, tr = {}, t = 0.03) {
    const front = new THREE.ShapeGeometry(shapeOf(pts), 2);
    front.translate(0, 0, t / 2);
    const back = new THREE.ShapeGeometry(shapeOf(pts), 2);
    back.rotateY(Math.PI);
    back.translate(0, 0, -t / 2);
    this.list.push(place(prepare(front, color), tr), place(prepare(back, color), tr));
    return this;
  }

  // Flat shape lying on the page (XZ plane), facing up, at height y.
  flat(pts, color, tr = {}) {
    const g = new THREE.ShapeGeometry(shapeOf(pts), 4);
    g.rotateX(-Math.PI / 2);
    return this.add(g, color, tr);
  }

  // Thin straight strip between two 3D points (cables, strings, wires), square section.
  strip(a, b, w, color) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1e-3;
    const g = new THREE.BoxGeometry(w, w, len);
    const gg = prepare(g, color);
    // lookAt(eye, target, up) aims local +Z from target to eye. It writes only the rotation, so the
    // shared matrix would keep the translation of whatever part was placed last.
    const up = Math.abs(dy) > 0.999 * len ? _p.set(1, 0, 0) : _p.set(0, 1, 0);
    _m.lookAt(_s.set(dx, dy, dz), new THREE.Vector3(), up);
    _m.setPosition(0, 0, 0);
    gg.applyMatrix4(_m);
    gg.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    this.list.push(gg);
    return this;
  }

  merge(parts) { for (const g of parts.list) this.list.push(g.clone()); return this; }

  build() {
    const g = mergeGeometries(this.list, false);
    for (const p of this.list) p.dispose();
    this.list.length = 0;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
