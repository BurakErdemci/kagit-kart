// Paper cut-outs merged into one mesh per material. Each piece is hinged at its base (a card) or
// collapses like a paper box, and springs upright; positions are rewritten on the CPU only while a
// piece moves, so a still stage costs nothing per frame. The paper material derives flat normals
// from screen derivatives; normals are still rotated for the shadow normal bias.
import * as THREE from 'three';

const TAU = Math.PI * 2;
// Unfold: under-damped (ζ 0.5 at 2.2 Hz, ≈16 % overshoot, settled in ≈0.5 s) — the same feel as the
// track pop-ups. Fold: critically damped so nothing swings through the page.
const UP_W = TAU * 2.2, UP_Z = 0.5;
const DOWN_W = TAU * 2.4, DOWN_Z = 1;
const EDGE = '#f7f0de';

const c1 = new THREE.Color(), c2 = new THREE.Color(), c3 = new THREE.Color();

export function circlePts(r, n = 20, cx = 0, cy = 0, ry = r) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * ry]); }
  return out;
}

export function starPts(points, rOut, rIn, cx = 0, cy = 0, rot = Math.PI / 2) {
  const out = [];
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i / (points * 2)) * TAU, r = i % 2 ? rIn : rOut;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

export function flowerPts(petals, rOut, rIn, cx = 0, cy = 0, per = 5) {
  const out = [];
  const n = petals * per;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = Math.abs(Math.sin((i / per) * Math.PI));
    const r = rIn + (rOut - rIn) * Math.pow(k, 0.7);
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

export function rectPts(w, h, cx = 0, cy = 0) {
  return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
}

// Silhouette whose top edge follows f(x) over [x0, x1]; the bottom sits at y = floor.
export function ridgePts(x0, x1, f, floor = -0.6, n = 40) {
  const out = [[x0, floor]];
  for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n; out.push([x, f(x)]); }
  out.push([x1, floor]);
  return out;
}

// Collects the layers of one piece in piece-local space: x right, y up from the hinge line,
// +z = the side facing the reader.
export class PieceBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.uv = [];
  }

  // A cut card extruded from 2D points; front face coloured (optionally darker toward the base),
  // back face a paler plate, cut edges white paper.
  card(points, color, { z = 0, t = 0.04, back = null, edge = EDGE, shade = null, shadeH = 1.5 } = {}) {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 4 });
    geo.translate(0, 0, z - t / 2);
    let minY = Infinity;
    for (const [, y] of points) minY = Math.min(minY, y);
    this.#absorb(geo, (nx, ny, nz, x, y) => {
      if (nz > 0.5) {
        c1.set(color);
        if (shade) {
          const k = Math.min(1, Math.max(0, (y - minY) / shadeH));
          c1.lerp(c2.set(shade), 1 - k * k * (3 - 2 * k));
        }
        return c1;
      }
      if (nz < -0.5) return back ? c1.set(back) : c1.set(color).lerp(c3.set('#e9dcc0'), 0.55);
      return c1.set(edge);
    });
    geo.dispose();
    return this;
  }

  // Axis-aligned box with its base on y = 0; faceUV(face) → [u0, v0, u1, v1] or null.
  box(w, h, d, color, { x = 0, z = 0, top = null, faceUV = null, front = null } = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(x, h / 2, z);
    const uv = geo.attributes.uv;
    // BoxGeometry faces: +x, -x, +y, -y, +z, -z (4 vertices each)
    if (faceUV) {
      for (let f = 0; f < 6; f++) {
        const r = faceUV(f);
        for (let k = 0; k < 4; k++) {
          const i = f * 4 + k;
          const u = uv.getX(i), v = uv.getY(i);
          uv.setXY(i, r[0] + (r[2] - r[0]) * u, r[1] + (r[3] - r[1]) * v);
        }
      }
    }
    const flat = geo.toNonIndexed();
    geo.dispose();
    this.#absorb(flat, (nx, ny, nz) => {
      if (ny > 0.5 && top) return c1.set(top);
      if (nz > 0.5 && front) return c1.set(front);
      return c1.set(color);
    });
    flat.dispose();
    return this;
  }

  // Any non-indexed geometry, coloured by colorOf(nx, ny, nz, x, y, z) → THREE.Color.
  mesh(geo, colorOf) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    this.#absorb(g, colorOf);
    if (g !== geo) g.dispose();
    return this;
  }

  #absorb(geo, colorOf) {
    const p = geo.attributes.position, n = geo.attributes.normal, u = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
      this.pos.push(x, y, z);
      this.nrm.push(nx, ny, nz);
      const c = colorOf(nx, ny, nz, x, y, z);
      this.col.push(c.r, c.g, c.b);
      if (u) this.uv.push(u.getX(i), u.getY(i)); else this.uv.push(0.98, 0.98);
    }
  }
}

// kind: 'hinge' (card rotating about its base line), 'box' (collapses backwards like a paper box),
// 'static' (never moves). yaw turns local +z toward that heading (ARCHITECTURE §4 convention).
export function createPopupBatch(name, material, { cast = true, receive = true } = {}) {
  const pieces = [];
  let geometry = null, mesh = null;
  let posAttr = null, nrmAttr = null;

  function add(builder, { kind = 'hinge', x = 0, y = 0, z = 0, yaw = 0, open = 1, tag = null } = {}) {
    const piece = {
      kind, tag, x, y, z, yaw, cy: Math.cos(yaw), sy: Math.sin(yaw),
      local: new Float32Array(builder.pos), localN: new Float32Array(builder.nrm),
      col: builder.col, uv: builder.uv,
      start: 0, count: builder.pos.length / 3,
      u: open, v: 0, target: open, delay: 0, dirty: true,
    };
    pieces.push(piece);
    return piece;
  }

  function build() {
    let n = 0;
    for (const p of pieces) { p.start = n; n += p.count; }
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    for (const p of pieces) {
      col.set(p.col, p.start * 3);
      uv.set(p.uv, p.start * 2);
      p.col = null;
      p.uv = null;
    }
    geometry = new THREE.BufferGeometry();
    posAttr = new THREE.BufferAttribute(pos, 3);
    nrmAttr = new THREE.BufferAttribute(nrm, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    nrmAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', posAttr);
    geometry.setAttribute('normal', nrmAttr);
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.name = name;
    for (const p of pieces) write(p);
    geometry.computeBoundingSphere();
    mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    // Folding pieces leave the build-time bounds; the stage is always in view anyway.
    mesh.frustumCulled = false;
    return mesh;
  }

  function write(p) {
    const P = posAttr.array, N = nrmAttr.array, L = p.local, LN = p.localN;
    const o = p.start * 3;
    const th = p.u * (Math.PI / 2);
    const s = Math.sin(th), c = Math.cos(th);
    const cy = p.cy, sy = p.sy;
    for (let i = 0; i < p.count * 3; i += 3) {
      const lx = L[i], ly = L[i + 1], lz = L[i + 2];
      let yy, zz;
      if (p.kind === 'hinge') { yy = ly * s + lz * c; zz = -ly * c + lz * s; }
      else if (p.kind === 'box') { yy = ly * Math.max(s, 0.03); zz = lz - ly * c; }
      else { yy = ly; zz = lz; }
      P[o + i] = p.x + lx * cy + zz * sy;
      P[o + i + 1] = p.y + yy;
      P[o + i + 2] = p.z - lx * sy + zz * cy;
      const nx = LN[i], ny = LN[i + 1], nz = LN[i + 2];
      let my = ny, mz = nz;
      if (p.kind !== 'static') { my = ny * s + nz * c; mz = -ny * c + nz * s; }
      N[o + i] = nx * cy + mz * sy;
      N[o + i + 1] = my;
      N[o + i + 2] = -nx * sy + mz * cy;
    }
    p.dirty = false;
  }

  // target 0 = folded flat, 1 = upright. delay in seconds; snap skips the spring.
  function set(piece, target, { delay = 0, snap = false } = {}) {
    if (snap) {
      piece.u = target;
      piece.v = 0;
      piece.target = target;
      piece.delay = 0;
      piece.dirty = true;
      return;
    }
    if (piece.target === target && piece.delay <= 0) return;
    piece.target = target;
    piece.delay = delay;
  }

  function update(dt, reducedMotion) {
    let any = false;
    for (const p of pieces) {
      if (p.kind !== 'static' && (p.u !== p.target || p.v !== 0)) {
        if (p.delay > 0) { p.delay -= dt; }
        else if (reducedMotion) { p.u = p.target; p.v = 0; p.dirty = true; }
        else {
          const up = p.target > p.u;
          const w = up ? UP_W : DOWN_W, zeta = up ? UP_Z : DOWN_Z;
          let left = dt;
          while (left > 1e-6) {
            const h = Math.min(left, 1 / 120);
            const a = w * w * (p.target - p.u) - 2 * zeta * w * p.v;
            p.v += a * h;
            p.u += p.v * h;
            left -= h;
          }
          if (p.target === 0 && p.u < 0) { p.u = 0; p.v = 0; }
          if (Math.abs(p.u - p.target) < 1e-3 && Math.abs(p.v) < 1e-2) { p.u = p.target; p.v = 0; }
          p.dirty = true;
        }
      }
      if (p.dirty) { write(p); any = true; }
    }
    if (any) {
      posAttr.needsUpdate = true;
      nrmAttr.needsUpdate = true;
    }
  }

  function dispose() {
    mesh?.parent?.remove(mesh);
    geometry?.dispose();
  }

  return { pieces, add, build, set, update, dispose, get mesh() { return mesh; } };
}
