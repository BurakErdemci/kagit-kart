// Papercraft geometry kit: flat folded faces with a baked crease band along every fold, thin card
// slabs with cream cut edges, and rigid (or two-bone blended) skin weights so a whole kart + driver
// is a single SkinnedMesh. Build-time only; nothing here runs per frame.
import * as THREE from 'three';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const vec = { sub, add, mul, dot, cross, len, norm, lerp: lerp3 };

function centroid(pts) {
  const c = [0, 0, 0];
  for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  return mul(c, 1 / pts.length);
}

function newell(pts) {
  const n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return norm(n);
}

// Regular n-gon outline in 2D (for slabs and caps).
export function ngon(n, rx, ry = rx, phase = 0, cx = 0, cy = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

// In-plane axes for a face whose outward normal is n, with ey as close to world up as possible.
export function frameFromNormal(n, up = [0, 1, 0]) {
  n = norm(n);
  if (Math.abs(dot(n, up)) > 0.95) up = [0, 0, 1];
  const ey = norm(sub(up, mul(n, dot(n, up))));
  const ex = cross(ey, n);
  return { ex, ey, n };
}

export class PaperBuilder {
  constructor(atlas) {
    this.atlas = atlas;
    this.P = []; this.N = []; this.UV = []; this.SI = []; this.SW = [];
    this.bones = [];
    this.index = {};
    this.w = [[0, 1]];
    this.sx = 1;
    this.creaseWidth = 0.022;
    this.missing = new Set();
    this.faces = 0;
  }

  bone(name, parent, pivot) {
    const i = this.bones.length;
    this.bones.push({ name, parent: parent == null ? -1 : this.index[parent], pivot: pivot.slice() });
    this.index[name] = i;
    return i;
  }

  // Mirrored bone pair: name+'L' at +x (the kart's left), name+'R' at -x.
  bonePair(name, parent, pivot) {
    const pl = typeof parent === 'function' ? parent('L') : parent;
    const pr = typeof parent === 'function' ? parent('R') : parent;
    this.bone(name + 'L', pl, pivot);
    this.bone(name + 'R', pr, [-pivot[0], pivot[1], pivot[2]]);
  }

  use(name) {
    const i = this.index[name];
    if (i === undefined) throw new Error('unknown bone ' + name);
    this.w = [[i, 1]];
    return this;
  }

  weights(name) {
    return [[this.index[name], 1]];
  }

  blend(a, b, t) {
    return [[this.index[a], 1 - t], [this.index[b], t]];
  }

  // Run fn for the left side, then again mirrored for the right side. fn receives 'L' or 'R'.
  both(fn) {
    const prev = this.sx;
    this.sx = 1; fn('L', 1);
    this.sx = -1; fn('R', -1);
    this.sx = prev;
  }

  rect(sw) {
    const r = this.atlas.rects[sw];
    if (r) return r;
    this.missing.add(sw);
    return this.atlas.rects.__fallback;
  }

  pushVert(p, n, u, v, w) {
    this.P.push(p[0], p[1], p[2]);
    this.N.push(n[0], n[1], n[2]);
    this.UV.push(u, v);
    const a = w[0], b = w[1];
    this.SI.push(a[0], b ? b[0] : 0, 0, 0);
    this.SW.push(a[1], b ? b[1] : 0, 0, 0);
  }

  // One flat face. pts: convex polygon (array of [x,y,z]) in pre-mirror coordinates.
  // o.out: a point inside the solid; the face is turned to face away from it.
  // o.crease: crease band width (m), 0 for cut paper. o.fit: 'cover' keeps the art's aspect.
  // o.w: per-vertex weights aligned with pts. o.up: texture up hint.
  poly(input, sw, o = {}) {
    const sx = this.sx;
    let pts = input.map((p) => [p[0] * sx, p[1], p[2]]);
    let W = o.w ? o.w.slice() : null;
    if (o.out) {
      const out = [o.out[0] * sx, o.out[1], o.out[2]];
      const n0 = newell(pts);
      if (dot(n0, sub(centroid(pts), out)) < 0) { pts.reverse(); if (W) W.reverse(); }
    } else if (sx < 0) { pts.reverse(); if (W) W.reverse(); }
    const m = pts.length;
    if (m < 3) return;
    const n = newell(pts);
    const c = centroid(pts);
    const r = this.rect(sw);
    this.faces++;

    let up = o.up ? [o.up[0] * sx, o.up[1], o.up[2]] : [0, 1, 0];
    if (Math.abs(dot(n, norm(up))) > 0.92) up = o.up2 || [0, 0, 1];
    const e2 = norm(sub(up, mul(n, dot(n, up))));
    const e1 = cross(e2, n);
    let smin = Infinity, smax = -Infinity, tmin = Infinity, tmax = -Infinity;
    for (const p of pts) {
      const d = sub(p, c);
      const s = dot(d, e1), t = dot(d, e2);
      if (s < smin) smin = s; if (s > smax) smax = s;
      if (t < tmin) tmin = t; if (t > tmax) tmax = t;
    }
    const I = r.i;
    let u0 = I[0], v0 = I[1], u1 = I[2], v1 = I[3];
    if (o.fit === 'cover') {
      const faceAspect = (smax - smin) / Math.max(1e-6, tmax - tmin);
      const texAspect = r.aspect;
      if (faceAspect > texAspect) {
        const f = texAspect / faceAspect, mid = (v0 + v1) / 2, h = (v1 - v0) * f / 2;
        v0 = mid - h; v1 = mid + h;
      } else {
        const f = faceAspect / texAspect, mid = (u0 + u1) / 2, h = (u1 - u0) * f / 2;
        u0 = mid - h; u1 = mid + h;
      }
    }
    const uvOf = (p) => {
      const d = sub(p, c);
      const s = (dot(d, e1) - smin) / Math.max(1e-6, smax - smin);
      const t = (dot(d, e2) - tmin) / Math.max(1e-6, tmax - tmin);
      return [u0 + (u1 - u0) * s, v0 + (v1 - v0) * t];
    };
    const wOf = (i) => (W ? W[i] : this.w);

    let d = o.crease ?? this.creaseWidth;
    if (d > 0) {
      let minDist = Infinity;
      for (let i = 0; i < m; i++) {
        const a = pts[i], b = pts[(i + 1) % m];
        const ab = sub(b, a), l = len(ab);
        if (l < 1e-6) continue;
        minDist = Math.min(minDist, len(cross(ab, sub(c, a))) / l);
      }
      d = Math.min(d, 0.34 * minDist);
      if (d < 0.003) d = 0;
    }

    if (!d) {
      const uv0 = uvOf(pts[0]);
      for (let i = 1; i < m - 1; i++) {
        const a = uvOf(pts[i]), b = uvOf(pts[i + 1]);
        this.pushVert(pts[0], n, uv0[0], uv0[1], wOf(0));
        this.pushVert(pts[i], n, a[0], a[1], wOf(i));
        this.pushVert(pts[i + 1], n, b[0], b[1], wOf(i + 1));
      }
      return;
    }

    const q = [];
    for (let i = 0; i < m; i++) {
      const p = pts[i], a = pts[(i - 1 + m) % m], b = pts[(i + 1) % m];
      const ua = norm(sub(a, p)), ub = norm(sub(b, p));
      let bis = add(ua, ub);
      if (len(bis) < 1e-4) bis = cross(n, ub);
      bis = norm(bis);
      if (dot(bis, sub(c, p)) < 0) bis = mul(bis, -1);
      const sinHalf = len(cross(ua, bis));
      let off = d / Math.max(sinHalf, 0.25);
      off = Math.min(off, 0.7 * len(sub(c, p)));
      q.push(add(p, mul(bis, off)));
    }
    const C = r.c;
    const qu = q.map(uvOf);
    for (let i = 1; i < m - 1; i++) {
      this.pushVert(q[0], n, qu[0][0], qu[0][1], wOf(0));
      this.pushVert(q[i], n, qu[i][0], qu[i][1], wOf(i));
      this.pushVert(q[i + 1], n, qu[i + 1][0], qu[i + 1][1], wOf(i + 1));
    }
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      // Ring quad: the fold edge samples the dark end of the swatch's crease strip.
      this.pushVert(pts[i], n, C[0], C[1], wOf(i));
      this.pushVert(pts[j], n, C[2], C[1], wOf(j));
      this.pushVert(q[j], n, C[2], C[3], wOf(j));
      this.pushVert(pts[i], n, C[0], C[1], wOf(i));
      this.pushVert(q[j], n, C[2], C[3], wOf(j));
      this.pushVert(q[i], n, C[0], C[3], wOf(i));
    }
  }

  // Oriented box: centre, axes [ex, ey, ez] (unit), half sizes [hx, hy, hz].
  // sw: swatch name or { px, nx, py, ny, pz, nz } (+x is the kart's left).
  obox(c, axes, h, sw, o = {}) {
    const [ex, ey, ez] = axes;
    const P = (sx, sy, sz) => add(add(add(c, mul(ex, sx * h[0])), mul(ey, sy * h[1])), mul(ez, sz * h[2]));
    const pick = (k) => (typeof sw === 'string' ? sw : k in sw ? sw[k] : sw.all);
    const faces = {
      px: [P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)],
      nx: [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)],
      py: [P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1)],
      ny: [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)],
      pz: [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)],
      nz: [P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1)],
    };
    for (const k in faces) {
      const s = pick(k);
      if (!s) continue;
      this.poly(faces[k], s, { out: c, crease: o.crease, fit: (o.fit && o.fit[k]) || undefined });
    }
  }

  box(c, size, sw, o) {
    this.obox(c, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [size[0] / 2, size[1] / 2, size[2] / 2], sw, o);
  }

  // Lofted solid through rings. ring: { c, rx, ry, w?, twist? }; rx/ry = 0 makes a point.
  // o.sides, o.phase, o.up (frame reference, not parallel to the path), o.sw (string or
  // (ringIndex, side, midAngle, faceCount) => swatch), o.cap0 / o.cap1 (swatch or null), o.crease.
  // Angle 0 points along side = tangent × up; angle π/2 along up.
  loft(rings, o = {}) {
    const N = o.sides ?? 8, phase = o.phase ?? 0, up = o.up ?? [0, 1, 0];
    const R = [], T = [];
    for (let i = 0; i < rings.length; i++) {
      const a = rings[Math.max(0, i - 1)].c, b = rings[Math.min(rings.length - 1, i + 1)].c;
      let t = o.axis ? norm(o.axis) : norm(sub(b, a));
      T.push(t);
      let side = cross(t, up);
      if (len(side) < 1e-4) side = cross(t, [0, 0, 1]);
      side = norm(side);
      const upp = cross(side, t);
      const rg = rings[i];
      const pts = [];
      for (let k = 0; k < N; k++) {
        const ang = phase + (rg.twist || 0) + (k / N) * Math.PI * 2;
        pts.push(add(rg.c, add(mul(side, Math.cos(ang) * rg.rx), mul(upp, Math.sin(ang) * rg.ry))));
      }
      R.push(pts);
    }
    const W = (i) => rings[i].w || this.w;
    for (let i = 0; i < rings.length - 1; i++) {
      const A = R[i], B = R[i + 1];
      const aPt = rings[i].rx === 0 && rings[i].ry === 0, bPt = rings[i + 1].rx === 0 && rings[i + 1].ry === 0;
      const out = lerp3(rings[i].c, rings[i + 1].c, 0.5);
      for (let k = 0; k < N; k++) {
        const k2 = (k + 1) % N;
        const mid = phase + ((k + 0.5) / N) * Math.PI * 2;
        const s = typeof o.sw === 'function' ? o.sw(i, k, mid, N) : o.sw;
        if (!s) continue;
        const wa = W(i), wb = W(i + 1);
        if (aPt) this.poly([A[0], B[k2], B[k]], s, { out, crease: o.crease, w: [wa, wb, wb], up: o.faceUp });
        else if (bPt) this.poly([A[k], A[k2], B[0]], s, { out, crease: o.crease, w: [wa, wa, wb], up: o.faceUp });
        else this.poly([A[k], A[k2], B[k2], B[k]], s, { out, crease: o.crease, w: [wa, wa, wb, wb], up: o.faceUp });
      }
    }
    const last = rings.length - 1;
    if (o.cap0 && rings[0].rx > 0) {
      this.poly(R[0], o.cap0, { out: add(rings[0].c, mul(T[0], 0.05)), crease: o.capCrease ?? o.crease, fit: o.capFit, w: R[0].map(() => W(0)), up: o.capUp });
    }
    if (o.cap1 && rings[last].rx > 0) {
      this.poly(R[last], o.cap1, { out: sub(rings[last].c, mul(T[last], 0.05)), crease: o.capCrease ?? o.crease, fit: o.capFit, w: R[last].map(() => W(last)), up: o.capUp });
    }
  }

  // Flat cut-out with thickness: outline is 2D in the plane (origin, ex, ey); front normal = ex × ey.
  slab(outline, origin, ex, ey, thick, swFront, swBack = swFront, swEdge = 'edge', o = {}) {
    const n = norm(cross(ex, ey));
    const h = thick / 2;
    const F = [], B = [];
    for (const [s, t] of outline) {
      const p = add(origin, add(mul(ex, s), mul(ey, t)));
      F.push(add(p, mul(n, h)));
      B.push(sub(p, mul(n, h)));
    }
    const up = o.up || ey;
    if (swFront) this.poly(F, swFront, { out: origin, crease: o.crease ?? 0, fit: o.fit, up });
    if (swBack) this.poly(B.slice().reverse(), swBack, { out: origin, crease: o.crease ?? 0, fit: o.fit, up });
    if (swEdge) {
      for (let i = 0; i < F.length; i++) {
        const j = (i + 1) % F.length;
        this.poly([F[i], B[i], B[j], F[j]], swEdge, { out: origin, crease: 0 });
      }
    }
  }

  // Slab facing direction n at centre c (texture up = world up projected).
  cutout(outline, c, n, thick, swFront, swBack, swEdge = 'edge', o = {}) {
    const f = frameFromNormal(n, o.upHint);
    this.slab(outline, c, f.ex, f.ey, thick, swFront, swBack === undefined ? swFront : swBack, swEdge, o);
  }

  // Ray-cast against the faces emitted so far (optionally only those bound to one bone), in
  // pre-mirror coordinates. Lets printed features be glued onto a faceted head instead of guessing
  // its surface. Returns { p, n } of the nearest hit or null.
  surface(origin, dir, boneName) {
    const sx = this.sx;
    const o = [origin[0] * sx, origin[1], origin[2]];
    const d = norm([dir[0] * sx, dir[1], dir[2]]);
    const bi = boneName === undefined ? -1 : this.index[boneName];
    const P = this.P, SI = this.SI;
    let best = Infinity, bn = null;
    for (let v = 0; v < P.length / 3; v += 3) {
      if (bi >= 0 && SI[v * 4] !== bi) continue;
      const a = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
      const b = [P[v * 3 + 3], P[v * 3 + 4], P[v * 3 + 5]];
      const c = [P[v * 3 + 6], P[v * 3 + 7], P[v * 3 + 8]];
      const e1 = sub(b, a), e2 = sub(c, a);
      const pv = cross(d, e2);
      const det = dot(e1, pv);
      if (Math.abs(det) < 1e-9) continue;
      const inv = 1 / det;
      const tv = sub(o, a);
      const u = dot(tv, pv) * inv;
      if (u < 0 || u > 1) continue;
      const qv = cross(tv, e1);
      const w = dot(d, qv) * inv;
      if (w < 0 || u + w > 1) continue;
      const t = dot(e2, qv) * inv;
      if (t > 1e-5 && t < best) { best = t; bn = norm(cross(e1, e2)); }
    }
    if (!bn) return null;
    if (dot(bn, d) > 0) bn = mul(bn, -1);
    const p = add(o, mul(d, best));
    return { p: [p[0] * sx, p[1], p[2]], n: [bn[0] * sx, bn[1], bn[2]] };
  }

  // Point on the front of a part at (x, y), nudged out along a normal blended toward +Z.
  stick(x, y, boneName, lift = 0.006, towardFront = 0.45) {
    const hit = this.surface([x, y, 3], [0, 0, -1], boneName);
    if (!hit) return { c: [x, y, 0], n: [0, 0, 1] };
    const n = norm(lerp3(hit.n, [0, 0, 1], towardFront));
    return { c: add(hit.p, mul(n, lift)), n };
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.UV, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.SW, 4));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  // Plain typed arrays so the model can be rebuilt into a fresh BufferGeometry per race without
  // repeating the build (GPU objects are ref-counted; this data is not GPU memory).
  toArrays() {
    return {
      position: new Float32Array(this.P),
      normal: new Float32Array(this.N),
      uv: new Float32Array(this.UV),
      skinIndex: new Uint16Array(this.SI),
      skinWeight: new Float32Array(this.SW),
    };
  }
}

export function geometryFromArrays(a) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(a.skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(a.skinWeight, 4));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
