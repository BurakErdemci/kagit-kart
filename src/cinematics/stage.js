// The out-of-race set: the open pop-up book on the reader's desk. Built once on the first stage
// shot and kept (title, select and podium share it); every GPU resource here is released by dispose().
// World units match the race (a kart is 2.2 m), so the book is a big picture book and the kart a
// paper toy parked on it.
import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { createKartVisual, ROSTER } from '../characters/characters.js';
import { CUP, TRACKS } from '../track/defs/index.js';
import { paintDisc, paintPages, paintWood, toTexture } from './print.js';
import {
  PieceBuilder, circlePts, createPopupBatch, flowerPts, rectPts, ridgePts, starPts,
} from './popups.js';

export const BOOK = { halfW: 12, halfD: 8.25, board: 0.16, margin: 0.45 };
export const DISC = { x: 5.4, z: 0.9, r: 3.3, h: 0.1 };
const CLOTH = '#2e4f58'; // the UI cover's cloth, so the opened cover and this book are one object
const GOLD = '#d8ad4c';
// Honey oak rather than the book theme's walnut: it glows in low sun and its shade stays brown.
const DESK = '#b28d68';
const WALL_Z = -46;

// Height of the top page above the desk at page-local x: pages bulge up from the fore-edge toward
// the spine and dive into the gutter.
export function pageTop(x) {
  const u = Math.min(1, Math.abs(x) / BOOK.halfW);
  return BOOK.board + 1.18 + 0.32 * (1 - u) * (1 - u) - 0.95 * Math.exp(-(u / 0.07) * (u / 0.07));
}

function pageXs(n) {
  const xs = [];
  for (let i = 0; i <= n; i++) xs.push(BOOK.halfW * Math.pow(i / n, 1.7));
  return xs;
}

function gridGeometry(cols, rows, fn) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array((cols + 1) * (rows + 1) * 3);
  const uv = new Float32Array((cols + 1) * (rows + 1) * 2);
  const idx = [];
  const o = { x: 0, y: 0, z: 0, u: 0, v: 0 };
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      fn(c, r, o);
      const i = r * (cols + 1) + c;
      pos[i * 3] = o.x; pos[i * 3 + 1] = o.y; pos[i * 3 + 2] = o.z;
      uv[i * 2] = o.u; uv[i * 2 + 1] = o.v;
      if (c < cols && r < rows) {
        const a = i, b = i + 1, d = i + cols + 1, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Up-facing winding check: flip the index when the first triangle's normal points down.
function faceUp(geo) {
  const p = geo.attributes.position, i = geo.index.array;
  const a = new THREE.Vector3().fromBufferAttribute(p, i[0]);
  const b = new THREE.Vector3().fromBufferAttribute(p, i[1]);
  const c = new THREE.Vector3().fromBufferAttribute(p, i[2]);
  const n = b.sub(a).cross(c.sub(a));
  if (n.y < 0) {
    for (let k = 0; k < i.length; k += 3) { const t = i[k + 1]; i[k + 1] = i[k + 2]; i[k + 2] = t; }
    geo.index.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return geo;
}

function boxWorldUV(geo, s) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    if (ay > 0.5) uv.setXY(i, p.getX(i) / s, p.getZ(i) / s);
    else if (ax > 0.5) uv.setXY(i, p.getZ(i) / s, p.getY(i) / s);
    else uv.setXY(i, p.getX(i) / s, p.getY(i) / s);
  }
  return geo;
}

const col = new THREE.Color();

export function createStage(game) {
  const mats = game.materials;
  const renderer = game.renderer;
  const group = new THREE.Group();
  group.name = 'cinematics:stage';
  const geometries = [];
  const textures = [];
  const materials = [];
  const own = (g) => { geometries.push(g); return g; };
  const ownTex = (t) => { textures.push(t); return t; };
  const ownMat = (m) => { materials.push(m); return m; };
  const add = (geo, mat, name, { cast = false, receive = true } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = receive;
    group.add(m);
    return m;
  };

  const first = TRACKS[CUP[0]] || {};
  const prints = paintPages({ halfDepth: BOOK.halfD, chapter: first.chapter || 1, title: first.name || 'Papatya Çayırı' });
  const texLeft = ownTex(toTexture(prints.left, renderer));
  const texRight = ownTex(toTexture(prints.right, renderer));
  const texUnder = ownTex(toTexture(prints.under, renderer));
  const texDisc = ownTex(toTexture(paintDisc(ROSTER.map((c) => c.colors.kart)), renderer));
  const texWood = ownTex(toTexture(paintWood(DESK), renderer, { repeat: true }));

  // ---- desk ------------------------------------------------------------------------------------
  const deskGeo = own(new THREE.PlaneGeometry(420, 260, 1, 1).rotateX(-Math.PI / 2).translate(0, 0, WALL_Z + 130)); // from the back wall forward
  {
    const p = deskGeo.attributes.position, uv = deskGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 40, p.getZ(i) / 20);
  }
  add(deskGeo, ownMat(mats.paper('#ffffff', { map: texWood, unique: true, grain: 0.7 })), 'desk');

  // ---- cover boards, gold-stamped ------------------------------------------------------------
  const bw = BOOK.halfW + BOOK.margin, bd = BOOK.halfD + BOOK.margin;
  const boardGeo = own(boxWorldUV(new THREE.BoxGeometry(bw * 2, BOOK.board, bd * 2).translate(0, BOOK.board / 2, 0), 1.6));
  add(boardGeo, mats.paper(CLOTH, { overlay: mats.textures.hatch, overlayColor: '#233f47', grain: 1.4 }), 'book:boards', { cast: true });

  // ---- page block: fore-edges and head/tail follow the page profile, printed with page lines ----
  const xs = pageXs(36);
  const edgeB = [];
  {
    const quads = [];
    // fore-edges
    for (const s of [-1, 1]) {
      const x = s * BOOK.halfW, y1 = pageTop(x);
      quads.push([[x, BOOK.board, -BOOK.halfD], [x, BOOK.board, BOOK.halfD], [x, y1, BOOK.halfD], [x, y1, -BOOK.halfD], s]);
    }
    const pos = [], uv = [];
    const lines = 11; // page lines per metre
    for (const [a, b, c, d, s] of quads) {
      const tri = s > 0 ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
      for (const v of tri) { pos.push(...v); uv.push(v[2] / 4, (v[1] - BOOK.board) * lines); }
    }
    // head (z = -halfD) and tail (z = +halfD) faces under the profile
    for (const zs of [-1, 1]) {
      const z = zs * BOOK.halfD;
      const all = [...xs.slice(1).reverse().map((x) => -x), ...xs];
      for (let i = 0; i < all.length - 1; i++) {
        const x0 = all[i], x1 = all[i + 1];
        const a = [x0, BOOK.board, z], b = [x1, BOOK.board, z], c = [x1, pageTop(x1), z], d = [x0, pageTop(x0), z];
        const tri = zs > 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
        for (const v of tri) { pos.push(...v); uv.push(v[0] / 4, (v[1] - BOOK.board) * lines); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    edgeB.push(own(g));
  }
  add(edgeB[0], mats.paper('#ece2c8', { overlay: mats.textures.stripes, overlayColor: '#c5b690', grain: 0.8 }), 'book:edges', { cast: true });

  // ---- page tops: right page (the stage page) and the page under the lifting leaves -------------
  const pageGeo = (side, lift = 0) => faceUp(gridGeometry(xs.length - 1, 2, (c, r, o) => {
    const x = side * xs[c];
    o.x = x;
    o.y = pageTop(x) + lift;
    o.z = -BOOK.halfD + (r / 2) * BOOK.halfD * 2;
    o.u = side > 0 ? x / BOOK.halfW : (x + BOOK.halfW) / BOOK.halfW;
    o.v = 1 - (o.z + BOOK.halfD) / (BOOK.halfD * 2);
  }));
  const pageOpts = { flat: false, grain: 0.9 };
  const matRight = ownMat(mats.paper('#ffffff', { ...pageOpts, map: texRight, unique: true, side: THREE.DoubleSide }));
  const matUnder = ownMat(mats.paper('#ffffff', { ...pageOpts, map: texUnder, unique: true, side: THREE.DoubleSide }));
  const matLeft = ownMat(mats.paper('#ffffff', { ...pageOpts, map: texLeft, unique: true }));
  add(own(pageGeo(-1)), matLeft, 'book:pageLeft', { cast: true });
  add(own(pageGeo(1)), matUnder, 'book:pageUnder', { cast: true });

  // ---- lifting leaves: the right page's front-outer corner rises and settles, the page under it
  // shows through. Only that corner moves; the turntable and pop-ups stand on the still part.
  const LC = 26, LR = 10;
  const leaves = [0, 1].map((k) => {
    const geo = own(gridGeometry(LC, LR, (c, r, o) => {
      const u = c / LC;
      o.x = u * BOOK.halfW;
      o.y = pageTop(o.x) + 0.012 * (2 - k);
      o.z = -BOOK.halfD + (r / LR) * BOOK.halfD * 2;
      o.u = o.x / BOOK.halfW;
      o.v = 1 - (o.z + BOOK.halfD) / (BOOK.halfD * 2);
    }));
    faceUp(geo);
    geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    const mesh = add(geo, k === 0 ? matRight : matUnder, `book:leaf${k}`, { cast: true });
    mesh.frustumCulled = false;
    return { geo, mesh, base: Float32Array.from(geo.attributes.position.array), lift: 0, k };
  });

  function shapeLeaf(leaf, amount) {
    const p = leaf.geo.attributes.position.array, b = leaf.base;
    for (let r = 0; r <= LR; r++) {
      const zw = THREE.MathUtils.smoothstep(r / LR, 0.55, 1);
      for (let c = 0; c <= LC; c++) {
        const i = (r * (LC + 1) + c) * 3;
        const w = Math.pow(THREE.MathUtils.smoothstep(c / LC, 0.64, 1), 1.5) * zw;
        const lift = amount * w;
        p[i] = b[i] - lift * lift * 0.08;
        p[i + 1] = b[i + 1] + lift;
      }
    }
    leaf.geo.attributes.position.needsUpdate = true;
    leaf.geo.computeVertexNormals();
  }

  // ---- pop-ups + desk props, one merged mesh -----------------------------------------------------
  const cutMat = mats.paper('#ffffff', { vertexColors: true });
  const batch = createPopupBatch('cinematics:popups', cutMat);
  const rand = mulberry32(77);
  const placed = []; // pop-up pieces with their unfold order

  // Card bottoms are cut to the page curve so wide V-fold panels meet the gutter without a gap.
  const popup = (builder, x, z, yaw, extra = {}) => {
    const y = pageTop(x) + 0.03;
    const P = builder.pos, cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (let i = 0; i < P.length; i += 3) {
      if (P[i + 1] >= 0) continue;
      const wx = x + P[i] * cy + P[i + 2] * sy;
      P[i + 1] = Math.min(P[i + 1], pageTop(wx) - y - 0.05);
    }
    const p = batch.add(builder, { kind: 'hinge', x, y, z, yaw, open: 0, ...extra });
    placed.push(p);
    return p;
  };

  // Backdrop V-fold, back layer: mountains with snow (the glacier chapter), a far town (the Bosphorus).
  for (const s of [-1, 1]) {
    const b = new PieceBuilder();
    const peaks = s < 0 ? [[-3.6, 4.2], [-1.2, 5.6], [1.8, 4.6], [3.9, 3.8]] : [[-3.8, 4.4], [-0.9, 6.4], [1.6, 5.0], [3.8, 5.8]];
    const f = (x) => {
      let y = 2.2;
      for (const [px, ph] of peaks) y = Math.max(y, ph - Math.abs(x - px) * 1.35);
      return y;
    };
    b.card(ridgePts(-4.8, 4.8, f, -0.2), '#8ea8d8', { shade: '#5a74b0', shadeH: 4.5 });
    for (const [px, ph] of peaks) {
      if (ph < 4.4) continue;
      const w = 0.95;
      b.card([[px - w, ph - w * 1.35 + 0.05], [px - w * 0.45, ph - w * 0.9], [px - w * 0.1, ph - w * 1.2], [px + w * 0.35, ph - w * 0.85], [px + w, ph - w * 1.35 + 0.05], [px, ph + 0.02]], '#fbf6e9', { z: 0.045 });
    }
    if (s < 0) {
      // far town on the left: domes and two minarets
      const town = '#8a7fb3';
      b.card(rectPts(3.4, 1.2, -1.4, 2.7), town, { z: 0.09 });
      b.card(circlePts(0.8, 16, -1.6, 3.3, 0.7), town, { z: 0.09 });
      b.card(circlePts(0.45, 12, -0.3, 3.2, 0.42), town, { z: 0.09 });
      for (const mx of [-2.9, 0.5]) b.card([[mx - 0.12, 2.2], [mx + 0.12, 2.2], [mx + 0.12, 4.6], [mx, 5.2], [mx - 0.12, 4.6]], town, { z: 0.09 });
    }
    popup(b, s * 5.0, -6.5, s * -0.12);
  }
  // the paper sun behind the right mountains
  {
    const b = new PieceBuilder();
    b.card([[-0.08, -0.6], [0.08, -0.6], [0.08, 5.2], [-0.08, 5.2]], '#caa56a');
    b.card(starPts(14, 1.9, 1.35, 0, 6.1), '#f2c14e', { shade: '#e8a23a', shadeH: 2 });
    b.card(circlePts(1.25, 24, 0, 6.1), '#f7d774', { z: 0.045 });
    popup(b, 6.8, -7.4, -0.05);
  }
  // hills, front layer
  for (const s of [-1, 1]) {
    const b = new PieceBuilder();
    const f = s < 0
      ? (x) => 1.7 + Math.sin(x * 0.9 + 0.6) * 0.55 + Math.sin(x * 2.1) * 0.18
      : (x) => 1.6 + Math.sin(x * 0.8 + 2.2) * 0.6 + Math.sin(x * 1.9 + 1) * 0.2;
    b.card(ridgePts(-4.9, 4.9, f, -0.2), '#8cc063', { shade: '#5f9a4a', shadeH: 2.4 });
    // a second, lighter ridge in front for depth
    b.card(ridgePts(-4.7, 4.7, (x) => f(x) - 0.75 + Math.sin(x * 1.3 + 1.7) * 0.25, -0.2), '#a9d27a', { z: 0.05, shade: '#7cb35c', shadeH: 1.6 });
    popup(b, s * 5.2, -5.3, s * -0.09);
  }
  // clouds on stalks
  for (const [x, z, h, w] of [[-6.6, -5.9, 5.4, 1.5], [1.8, -6.1, 6.6, 1.2]]) {
    const b = new PieceBuilder();
    b.card([[-0.05, -0.6], [0.05, -0.6], [0.05, h], [-0.05, h]], '#d9ccb0');
    b.card(circlePts(w, 18, 0, h + 0.25, w * 0.62), '#fbf6e9', { shade: '#dfe7ef', shadeH: w });
    b.card(circlePts(w * 0.7, 16, -w * 0.8, h, w * 0.5), '#fbf6e9', { z: 0.03, shade: '#dfe7ef', shadeH: w });
    b.card(circlePts(w * 0.75, 16, w * 0.85, h + 0.05, w * 0.52), '#fbf6e9', { z: 0.06, shade: '#dfe7ef', shadeH: w });
    popup(b, x, z, 0);
  }
  // trees
  const tree = (h, kind, tint) => {
    const b = new PieceBuilder();
    b.card([[-0.16, -0.3], [0.16, -0.3], [0.12, h * 0.55], [-0.12, h * 0.55]], '#8a5a3b');
    if (kind === 'pine') {
      for (let k = 0; k < 3; k++) {
        const y0 = h * (0.25 + k * 0.22), w = h * (0.36 - k * 0.08);
        b.card([[-w, y0], [w, y0], [0, y0 + h * 0.42]], tint, { z: 0.04 + k * 0.03, shade: '#3f7a4a', shadeH: h * 0.3 });
      }
    } else {
      b.card(circlePts(h * 0.3, 20, 0, h * 0.68, h * 0.34), tint, { z: 0.04, shade: '#4f8a44', shadeH: h * 0.5 });
      b.card(circlePts(h * 0.13, 12, -h * 0.09, h * 0.78), '#b7dc86', { z: 0.08 });
    }
    return b;
  };
  for (const [x, z, h, kind] of [[-10.4, -3.2, 3.1, 'pine'], [-9.0, -2.1, 2.3, 'round'], [9.3, -2.4, 2.8, 'round'], [8.4, -3.7, 3.4, 'pine']]) {
    popup(tree(h, kind, kind === 'pine' ? '#5f9e5a' : '#79b85a'), x, z, (rand() - 0.5) * 0.3);
  }
  // the start arch over the printed road (left page), chequered banner
  let arch = null;
  {
    const b = new PieceBuilder();
    const W = 4.3, H = 3.3;
    b.card(rectPts(0.3, H + 0.5, -W / 2, H / 2 - 0.25), '#d9483b');
    b.card(rectPts(0.3, H + 0.5, W / 2, H / 2 - 0.25), '#d9483b');
    b.card(rectPts(W + 0.4, 0.95, 0, H - 0.1), '#fbf6e9', { z: 0.03 });
    const nx = 10, ny = 2, cw = (W + 0.1) / nx, ch = 0.36;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        if ((i + j) % 2) continue;
        b.card(rectPts(cw, ch, -W / 2 - 0.05 + cw * (i + 0.5), H - 0.1 - ch / 2 + j * ch), '#2d2a32', { z: 0.06, t: 0.02 });
      }
    }
    b.card(starPts(5, 0.34, 0.15, 0, H + 0.62), '#f2c14e', { z: 0.03 });
    arch = popup(b, -5.25, 1.75, 2.23 - Math.PI / 2);
  }
  // daisies, the first chapter's signature
  const daisy = (h, tilt) => {
    const b = new PieceBuilder();
    b.card([[-0.08, -0.3], [0.08, -0.3], [0.08 + tilt, h], [-0.08 + tilt, h]], '#5f9a4a');
    b.card([[0.02, h * 0.3], [0.5, h * 0.52], [0.06, h * 0.42]], '#7cb35c', { z: 0.02 });
    const r = 0.36 + h * 0.12;
    b.card(flowerPts(9, r, r * 0.45, tilt, h), '#fbf6e9', { z: 0.04, shade: '#e6dcc8', shadeH: r });
    b.card(circlePts(r * 0.34, 14, tilt, h), '#f2c14e', { z: 0.08 });
    return b;
  };
  // Kept ≥ 2.5 m inside the fore-edge (shadows off the page drop 1.3 m to the desk and stretch into
  // slivers) and out of the title/select camera corridor in front of the turntable.
  const daisySpots = [[9.3, -0.2, 1.5], [9.1, 1.4, 1.9], [9.5, 2.8, 1.2], [8.6, -1.5, 1.1],
    [-2.0, 4.8, 1.4], [-3.1, 5.6, 1.8], [-1.6, 6.6, 1.1], [-3.9, 7.1, 1.3], [-2.6, 7.6, 0.9]];
  for (const [x, z, h] of daisySpots) {
    // the left-front clump stands in front of the podium's second step: it lies flat for the ceremony
    popup(daisy(h, (rand() - 0.5) * 0.3), x, z, (rand() - 0.5) * 0.5, { tag: x < 0 ? 'podiumFold' : null });
  }

  // ---- desk props (static): mug, pencil, a stack of books, the ribbon ------------------------------
  {
    const b = new PieceBuilder();
    const lathe = new THREE.LatheGeometry([
      new THREE.Vector2(0, 0.02), new THREE.Vector2(3.35, 0.02), new THREE.Vector2(3.45, 0.3), new THREE.Vector2(3.6, 8.4),
      new THREE.Vector2(3.62, 8.7), new THREE.Vector2(3.3, 8.7), new THREE.Vector2(3.2, 7.6), new THREE.Vector2(0, 7.6),
    ], 40);
    b.mesh(lathe, (nx, ny, nz, x, y, z) => {
      const r = Math.hypot(x, z);
      if (y > 7.55 && r < 3.25) return col.set('#4a2c1c');
      if (y > 8.5 || (r < 3.3 && y > 7.5)) return col.set('#f1e8d6');
      if (y > 5.2 && y < 6.5 && r > 3.3) return col.set('#f1e8d6');
      return col.set('#3f6f7a');
    });
    lathe.dispose();
    const handle = new THREE.TorusGeometry(1.9, 0.42, 8, 18, Math.PI).rotateZ(-Math.PI / 2).translate(3.5, 4.4, 0);
    b.mesh(handle, () => col.set('#3f6f7a'));
    handle.dispose();
    batch.add(b, { kind: 'static', x: 19, y: 0, z: -27, yaw: 3.6 });
  }
  {
    const b = new PieceBuilder();
    const L = 15;
    const body = new THREE.CylinderGeometry(0.42, 0.42, L, 6).rotateZ(Math.PI / 2);
    b.mesh(body, (nx, ny, nz) => col.set(ny > 0.7 ? '#f6cf5a' : '#e8b53c'));
    body.dispose();
    const tip = new THREE.ConeGeometry(0.42, 1.9, 6).rotateZ(-Math.PI / 2).translate(L / 2 + 0.95, 0, 0);
    b.mesh(tip, (nx, ny, nz, x) => col.set(x > L / 2 + 1.45 ? '#3a3640' : '#e6c79a'));
    tip.dispose();
    const ferrule = new THREE.CylinderGeometry(0.45, 0.45, 1.0, 12).rotateZ(Math.PI / 2).translate(-L / 2 - 0.5, 0, 0);
    b.mesh(ferrule, () => col.set('#b9b3a4'));
    ferrule.dispose();
    const eraser = new THREE.CylinderGeometry(0.43, 0.43, 1.1, 12).rotateZ(Math.PI / 2).translate(-L / 2 - 1.55, 0, 0);
    b.mesh(eraser, () => col.set('#ef8d8d'));
    eraser.dispose();
    batch.add(b, { kind: 'static', x: -19.5, y: 0.42, z: 11.5, yaw: 0.42 });
  }
  {
    const b = new PieceBuilder();
    const bookBox = (w, h, d, cover, y) => {
      const g = new THREE.BoxGeometry(w, h, d).translate(0, y + h / 2, 0);
      b.mesh(g, (nx, ny, nz) => {
        if (Math.abs(ny) > 0.5 || nx < -0.5) return col.set(cover);
        return col.set('#efe5cc');
      });
      g.dispose();
    };
    bookBox(15, 2.0, 10.5, '#a8413a', 0);
    batch.add(b, { kind: 'static', x: -27.5, y: 0, z: -8.5, yaw: 0.16 });
    const c = new PieceBuilder();
    const g2 = new THREE.BoxGeometry(12, 1.6, 8.6).translate(0, 2.0 + 0.8, 0);
    c.mesh(g2, (nx, ny) => col.set(Math.abs(ny) > 0.5 || nx > 0.5 ? '#d8ad4c' : '#efe5cc'));
    g2.dispose();
    batch.add(c, { kind: 'static', x: -27.0, y: 0, z: -8.8, yaw: -0.05 });
  }
  {
    // bookmark ribbon: out of the gutter at the tail, over the edge, curling on the desk
    const b = new PieceBuilder();
    const path = [];
    for (let i = 0; i <= 6; i++) { const z = 3.6 + (i / 6) * (BOOK.halfD - 3.6); path.push([0.12, pageTop(0.12) + 0.04, z]); }
    path.push([0.14, BOOK.board + 0.4, BOOK.halfD + 0.25]);
    path.push([0.2, 0.012, BOOK.halfD + 0.9]);
    for (let i = 1; i <= 8; i++) { const t = i / 8; path.push([0.2 + Math.sin(t * 1.9) * 2.2, 0.012, BOOK.halfD + 0.9 + t * 5.4]); }
    const W = 0.25;
    const pos = [];
    for (let i = 0; i < path.length - 1; i++) {
      const [x0, y0, z0] = path[i], [x1, y1, z1] = path[i + 1];
      const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
      const px = (-dz / l) * W, pz = (dx / l) * W;
      const onPage = (v) => { if (v[2] <= BOOK.halfD + 1e-3) v[1] = pageTop(v[0]) + 0.04; return v; };
      const a = onPage([x0 - px, y0, z0 - pz]), bb = onPage([x0 + px, y0, z0 + pz]);
      const c = onPage([x1 + px, y1, z1 + pz]), d = onPage([x1 - px, y1, z1 - pz]);
      pos.push(...a, ...bb, ...c, ...a, ...c, ...d);
    }
    const [ex, , ez] = path[path.length - 1];
    const [qx, , qz] = path[path.length - 2];
    const dl = Math.hypot(ex - qx, ez - qz), fx = (ex - qx) / dl, fz = (ez - qz) / dl;
    const tipA = [ex - fz * W + fx * 0.5, 0.012, ez + fx * W + fz * 0.5];
    const tipB = [ex + fz * W + fx * 0.5, 0.012, ez - fx * W + fz * 0.5];
    const notch = [ex + fx * 0.05, 0.012, ez + fz * 0.05];
    pos.push(ex - fz * W, 0.012, ez + fx * W, tipA[0], tipA[1], tipA[2], notch[0], notch[1], notch[2]);
    pos.push(ex + fz * W, 0.012, ez - fx * W, notch[0], notch[1], notch[2], tipB[0], tipB[1], tipB[2]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    b.mesh(g, () => col.set('#d9483b'));
    g.dispose();
    batch.add(b, { kind: 'static', x: 0, y: 0, z: 0, yaw: 0 });
  }
  {
    // gold stamping around the visible board margin
    const b = new PieceBuilder();
    const inset = 0.2, t = 0.07, y = BOOK.board + 0.004;
    const X = bw - inset, Z = bd - inset;
    for (const [cx, cz, w, d] of [[0, -Z, 2 * X, t], [0, Z, 2 * X, t], [-X, 0, t, 2 * Z], [X, 0, t, 2 * Z]]) {
      const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(cx, y, cz);
      b.mesh(g, () => col.set(GOLD));
      g.dispose();
    }
    batch.add(b, { kind: 'static', x: 0, y: 0, z: 0, yaw: 0 });
  }
  {
    // the reader's room: a back wall whose window glows with the evening sky behind the pop-ups
    const b = new PieceBuilder();
    const wx0 = -34, wx1 = 30, wy0 = 3.5, wy1 = 60;
    const wall = new THREE.Shape([new THREE.Vector2(-260, -1), new THREE.Vector2(260, -1), new THREE.Vector2(260, 170), new THREE.Vector2(-260, 170)]);
    wall.holes.push(new THREE.Path([new THREE.Vector2(wx0, wy0), new THREE.Vector2(wx0, wy1), new THREE.Vector2(wx1, wy1), new THREE.Vector2(wx1, wy0)]));
    const wg = new THREE.ShapeGeometry(wall);
    b.mesh(wg, (nx, ny, nz, x, y) => col.set(y < 1.6 ? '#8a6446' : '#dcc39d'));
    wg.dispose();
    const bar = (cx, cy, w, h, d) => {
      const g = new THREE.BoxGeometry(w, h, d).translate(cx, cy, d / 2 - 0.4);
      b.mesh(g, () => col.set('#f1e8d6'));
      g.dispose();
    };
    const f = 2.2;
    bar((wx0 + wx1) / 2, wy0 - f / 2, wx1 - wx0 + 2 * f, f, 1.6);
    bar((wx0 + wx1) / 2, wy1 + f / 2, wx1 - wx0 + 2 * f, f, 1.6);
    bar(wx0 - f / 2, (wy0 + wy1) / 2, f, wy1 - wy0, 1.6);
    bar(wx1 + f / 2, (wy0 + wy1) / 2, f, wy1 - wy0, 1.6);
    bar((wx0 + wx1) / 2, (wy0 + wy1) / 2 + 6, wx1 - wx0, 1.1, 1.0);
    bar((wx0 + wx1) / 2, (wy0 + wy1) / 2, 1.1, wy1 - wy0, 1.0);
    batch.add(b, { kind: 'static', x: 0, y: 0, z: WALL_Z, yaw: 0 });
  }
  group.add(batch.build());

  // ---- the volvelle turntable -----------------------------------------------------------------------
  const disc = new THREE.Group();
  disc.name = 'cinematics:turntable';
  const x0 = DISC.x - DISC.r, x1 = DISC.x + DISC.r;
  const tilt = Math.atan2(pageTop(x1) - pageTop(x0), x1 - x0);
  disc.position.set(DISC.x, (pageTop(x0) + pageTop(x1)) / 2 + 0.02, DISC.z);
  disc.rotation.z = tilt;
  const spin = new THREE.Group();
  disc.add(spin);
  const discGeo = own(new THREE.CylinderGeometry(DISC.r, DISC.r, DISC.h, 72, 1).translate(0, DISC.h / 2, 0));
  const discMesh = new THREE.Mesh(discGeo, ownMat(mats.paper('#ffffff', { map: texDisc, unique: true })));
  discMesh.name = 'turntable:disc';
  discMesh.castShadow = true;
  discMesh.receiveShadow = true;
  spin.add(discMesh);
  group.add(disc);
  const discTop = DISC.h + 0.005;

  // ---- hero kart on the turntable ---------------------------------------------------------------------
  const heroes = [];
  const HERO_UP_W = Math.PI * 2 * 2.4, HERO_UP_Z = 0.42, HERO_OUT_W = Math.PI * 2 * 3.2;
  let spinSpeed = 0, spinTarget = 0, parkYaw = null;

  function currentHero() {
    for (let i = heroes.length - 1; i >= 0; i--) if (heroes[i].state !== 'out') return heroes[i];
    return null;
  }

  function dropHero(h) {
    h.holder.parent?.remove(h.holder);
    h.holder.remove(h.visual.object3d);
    h.visual.dispose();
    const i = heroes.indexOf(h);
    if (i >= 0) heroes.splice(i, 1);
  }

  // faceYaw: world heading the new kart's nose points at when it appears.
  function setHero(id, { animate = true, cheer = false, faceYaw = 0 } = {}) {
    const cur = currentHero();
    if (cur && cur.id === id) {
      if (cheer) { cur.visual.setEmotion('cheer'); cur.cheerT = 1.8; }
      return cur;
    }
    for (const h of heroes.slice()) if (h.state === 'out') dropHero(h);
    if (cur) {
      if (animate) cur.state = 'out';
      else dropHero(cur);
    }
    const ch = ROSTER.find((c) => c.id === id) || ROSTER[0];
    const visual = createKartVisual(game, ch, null);
    const holder = new THREE.Group();
    holder.name = 'hero:' + ch.id;
    holder.position.y = discTop;
    holder.rotation.y = faceYaw - spin.rotation.y;
    holder.add(visual.object3d);
    spin.add(holder);
    const h = { id: ch.id, visual, holder, state: 'in', s: animate ? 0 : 1, v: 0, delay: animate ? 0.1 : 0, cheerT: 0 };
    visual.setEmotion(cheer ? 'cheer' : 'idle');
    if (cheer) h.cheerT = 1.8;
    heroes.push(h);
    applyHero(h);
    return h;
  }

  function applyHero(h) {
    const s = Math.max(0.001, h.s);
    const w = 0.82 + 0.18 * Math.min(1, s);
    h.holder.scale.set(w, s, w);
    h.holder.visible = s > 0.01;
  }

  function updateHeroes(dt, rm) {
    for (let i = heroes.length - 1; i >= 0; i--) {
      const h = heroes[i];
      if (h.state === 'in') {
        if (h.delay > 0) h.delay -= dt;
        else if (rm) { h.s = 1; h.v = 0; }
        else if (h.s !== 1 || h.v !== 0) {
          let left = dt;
          while (left > 1e-6) {
            const k = Math.min(left, 1 / 120);
            h.v += (HERO_UP_W * HERO_UP_W * (1 - h.s) - 2 * HERO_UP_Z * HERO_UP_W * h.v) * k;
            h.s += h.v * k;
            left -= k;
          }
          if (Math.abs(1 - h.s) < 1e-3 && Math.abs(h.v) < 1e-2) { h.s = 1; h.v = 0; }
        }
      } else if (h.state === 'out') {
        if (rm) h.s = 0;
        else {
          let left = dt;
          while (left > 1e-6) {
            const k = Math.min(left, 1 / 120);
            h.v += (HERO_OUT_W * HERO_OUT_W * (0 - h.s) - 2 * HERO_OUT_W * h.v) * k;
            h.s += h.v * k;
            left -= k;
          }
        }
        if (h.s < 0.03) { dropHero(h); continue; }
      }
      if (h.cheerT > 0) {
        h.cheerT -= dt;
        if (h.cheerT <= 0 && h.state !== 'out') h.visual.setEmotion('idle');
      }
      applyHero(h);
      h.visual.update(dt, 1);
    }
  }

  const heroPos = new THREE.Vector3();
  function heroSubject(out = heroPos) {
    disc.updateMatrixWorld();
    return out.set(0, discTop + 0.8, 0).applyMatrix4(disc.matrixWorld);
  }

  // ---- modes, folding and per-frame ----------------------------------------------------------------
  let mode = null;
  let leafT = 0;
  let leafAmount = 0;

  const waveDelay = (p, base) => base + Math.abs(p.x) / BOOK.halfW * 0.28 + (p.z + BOOK.halfD) / (BOOK.halfD * 2) * 0.12;

  const foldedIn = (p, m) => m === 'podium' && (p === arch || p.tag === 'podiumFold');

  function unfold({ from = null, delay = 0, snap = false } = {}) {
    for (const p of placed) {
      if (from === 0) batch.set(p, 0, { snap: true });
      batch.set(p, foldedIn(p, mode) ? 0 : 1, { delay: waveDelay(p, delay), snap });
    }
  }

  function fold({ snap = false } = {}) {
    for (const p of placed) batch.set(p, 0, { delay: snap ? 0 : (1 - Math.abs(p.x) / BOOK.halfW) * 0.12, snap });
  }

  function setMode(next) {
    mode = next;
    disc.visible = next !== 'podium';
    if (next === 'podium') {
      for (const p of placed) if (foldedIn(p, 'podium')) batch.set(p, 0, { snap: true });
      for (const h of heroes.slice()) dropHero(h);
    } else if (placed[0].target === 1) {
      for (const p of placed) if (foldedIn(p, 'podium')) batch.set(p, 1);
    }
  }

  function setSpin(speed) { spinTarget = speed; }
  function park(yaw) { parkYaw = yaw; }

  function update(dt) {
    const rm = !!game.reducedMotion;
    batch.update(dt, rm);
    // turntable: spin in select, settle to the parked angle otherwise
    spinSpeed += (spinTarget - spinSpeed) * Math.min(1, dt * 2.2);
    if (Math.abs(spinTarget) > 1e-4 || Math.abs(spinSpeed) > 1e-3) {
      spin.rotation.y += spinSpeed * dt;
    } else if (parkYaw !== null) {
      const h = currentHero();
      if (h) {
        const worldYaw = spin.rotation.y + h.holder.rotation.y;
        const d = Math.atan2(Math.sin(parkYaw - worldYaw), Math.cos(parkYaw - worldYaw));
        spin.rotation.y += d * Math.min(1, dt * (rm ? 1.2 : 1.6));
      }
    }
    updateHeroes(dt, rm);
    // leaves breathe: a slow lift every few seconds, only while the reader browses
    const want = mode === 'title' || mode === 'select' ? 1 : 0;
    leafAmount += (want - leafAmount) * Math.min(1, dt * 1.5);
    leafT += dt * (rm ? 0.5 : 1);
    const cycle = (t) => { const s = Math.max(0, Math.sin((t / 6.5) * Math.PI * 2 - 0.6)); return 0.06 + 0.62 * s * s; };
    for (const leaf of leaves) {
      const target = leafAmount * cycle(leafT - leaf.k * 0.45) * (leaf.k === 0 ? 1 : 0.55) * (rm ? 0.5 : 1);
      if (Math.abs(target - leaf.lift) > 1e-4) { leaf.lift = target; shapeLeaf(leaf, target); }
    }
  }

  function dispose() {
    for (const h of heroes.slice()) dropHero(h);
    batch.dispose();
    group.parent?.remove(group);
    for (const g of geometries) g.dispose();
    for (const t of textures) t.dispose();
    for (const m of materials) m.dispose();
    geometries.length = 0;
    textures.length = 0;
    materials.length = 0;
  }

  return {
    group, batch, placed, disc,
    // shadow frustum centre: the book's middle, nudged toward the turntable
    focus: new THREE.Vector3(2.0, 1.4, -0.6),
    get mode() { return mode; },
    setMode, unfold, fold, setHero, currentHero, heroSubject, setSpin, park,
    update, dispose,
    own, ownTex, ownMat,
  };
}
