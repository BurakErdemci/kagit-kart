// The out-of-race set: the pop-up book on the reader's desk. Built once on the first stage shot and
// kept (title, select and podium share it); every GPU resource here is released by dispose().
// World units match the race (a kart is 2.2 m), so the book is a big picture book and the kart a
// paper toy parked on it.
//
// The left half of the book (board, page block, printed page and its pop-ups) is the front cover's
// leaf: it turns about the spine onto the right half to close the book (the title), and back to open
// it. A single printed sheet turns over the spread when the chapter changes (track select).
import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { createKartVisual, ROSTER } from '../characters/characters.js';
import { CUP, TRACKS } from '../track/defs/index.js';
import { pageCanvas, paintCover, paintDisc, paintLeftPage, paintPages, paintRightPage, paintWood, toTexture } from './print.js';
import {
  PieceBuilder, circlePts, createPopupBatch, flowerPts, rectPts, ridgePts, starPts,
} from './popups.js';

export const BOOK = { halfW: 12, halfD: 8.25, board: 0.16, margin: 0.45 };
export const DISC = { x: 5.4, z: 0.9, r: 3.3, h: 0.1 };
const CLOTH = '#2e4f58';
const GOLD = '#d8ad4c';
// Honey oak rather than the book theme's walnut: it glows in low sun and its shade stays brown.
const DESK = '#b28d68';
const WALL_Z = -46;
// The cover turns about this line (x 0, y HINGE_Y, along z); closed, the book is 2·HINGE_Y tall.
export const HINGE_Y = 1.42;
const CLOSE_GAP = 0.02;
// The chapter sheet turns about the gutter; it floats this far over the page so folded cards stay under it.
const SHEET_Y = 0.75, SHEET_LIFT = 0.16;
const OPEN_TIME = 1.05, CLOSE_TIME = 0.95, CLOSE_WAIT = 0.42;
const TURN_FOLD = 0.34, TURN_TIME = 0.9;

// Height of the top page above the desk at page-local x: pages bulge up from the fore-edge toward
// the spine and dive into the gutter.
export function pageTop(x) {
  const u = Math.min(1, Math.abs(x) / BOOK.halfW);
  return BOOK.board + 1.18 + 0.32 * (1 - u) * (1 - u) - 0.95 * Math.exp(-(u / 0.07) * (u / 0.07));
}

const smooth = (e0, e1, t) => { const k = Math.min(1, Math.max(0, (t - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };

// Where a point of the open left half (x ≤ 0) lies once the cover has turned by s (0 open, 1 closed
// onto the right half). The half turns rigidly about the hinge while its page block re-shapes from
// the open page curve to one that rests on the right page; the board keeps its shape.
export function leafPoint(x, y, z, s, out) {
  let yl = y;
  const w = smooth(0.08, 0.92, s);
  if (w > 0 && y > BOOK.board) {
    const pt = pageTop(x);
    const d = 2 * HINGE_Y - 2 * pt - CLOSE_GAP;
    yl += w * d * Math.min(1, (y - BOOK.board) / Math.max(1e-3, pt - BOOK.board));
  }
  const th = -Math.PI * s, c = Math.cos(th), sn = Math.sin(th);
  const ry = yl - HINGE_Y;
  out[0] = x * c - ry * sn;
  out[1] = HINGE_Y + x * sn + ry * c;
  out[2] = z;
  return out;
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

// Page-block sides of one half (side -1 left, +1 right): the fore-edge, head and tail under the page
// profile and the wall at the gutter (inside the book while it is open), printed with page lines.
function edgesGeometry(side) {
  const pos = [], uv = [];
  const lines = 11; // page lines per metre
  const B = BOOK.board, D = BOOK.halfD;
  const put = (tri, uvOf) => { for (const v of tri) { pos.push(...v); uv.push(...uvOf(v)); } };
  const byZ = (v) => [v[2] / 4, (v[1] - B) * lines];
  const byX = (v) => [v[0] / 4, (v[1] - B) * lines];
  {
    const x = side * BOOK.halfW, y1 = pageTop(x);
    const a = [x, B, -D], b = [x, B, D], c = [x, y1, D], d = [x, y1, -D];
    put(side > 0 ? [a, c, b, a, d, c] : [a, b, c, a, c, d], byZ);
    const y0 = pageTop(0);
    const e = [0, B, -D], f = [0, B, D], g = [0, y0, D], h = [0, y0, -D];
    put(side > 0 ? [e, f, g, e, g, h] : [e, g, f, e, h, g], byZ);
  }
  const xs = pageXs(36).map((x) => side * x);
  if (side < 0) xs.reverse();
  for (const zs of [-1, 1]) {
    const z = zs * D;
    for (let i = 0; i < xs.length - 1; i++) {
      const x0 = xs[i], x1 = xs[i + 1];
      const a = [x0, B, z], b = [x1, B, z], c = [x1, pageTop(x1), z], d = [x0, pageTop(x0), z];
      put(zs > 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c], byX);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

const col = new THREE.Color();
const tmp3 = [0, 0, 0];

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
  const add = (geo, mat, name, { cast = false, receive = true, parent = group } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = receive;
    parent.add(m);
    return m;
  };

  const chapterOf = (key) => {
    const d = TRACKS[key] || TRACKS[CUP[0]] || {};
    return { key: d.id || key || 'meadow', chapter: d.chapter || 1, title: d.name || 'Papatya Çayırı' };
  };
  let chapterKey = TRACKS[game.selection?.trackId] ? game.selection.trackId : CUP[0];
  const prints = paintPages({ halfDepth: BOOK.halfD, chapter: chapterOf(chapterKey) });
  const texLeft = ownTex(toTexture(prints.left, renderer));
  const texRight = ownTex(toTexture(prints.right, renderer));
  const texUnder = ownTex(toTexture(prints.under, renderer));
  const texDisc = ownTex(toTexture(paintDisc(ROSTER.map((c) => c.colors.kart)), renderer));
  const texWood = ownTex(toTexture(paintWood(DESK), renderer, { repeat: true }));
  const bw = BOOK.halfW + BOOK.margin, bd = BOOK.halfD + BOOK.margin;
  const texCover = ownTex(toTexture(paintCover(bw / (2 * bd)), renderer));

  // ---- desk ------------------------------------------------------------------------------------
  const deskGeo = own(new THREE.PlaneGeometry(420, 260, 1, 1).rotateX(-Math.PI / 2).translate(0, 0, WALL_Z + 130)); // from the back wall forward
  {
    const p = deskGeo.attributes.position, uv = deskGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 40, p.getZ(i) / 20);
  }
  add(deskGeo, ownMat(mats.paper('#ffffff', { map: texWood, unique: true, grain: 0.7 })), 'desk');

  // ---- the right half: back board, page block, the printed page and its lifting corner ------------
  const matBoard = mats.paper(CLOTH, { overlay: mats.textures.hatch, overlayColor: '#233f47', grain: 1.4 });
  const matEdges = mats.paper('#ece2c8', { overlay: mats.textures.stripes, overlayColor: '#c5b690', grain: 0.8 });
  add(own(boxWorldUV(new THREE.BoxGeometry(bw, BOOK.board, bd * 2).translate(bw / 2, BOOK.board / 2, 0), 1.6)), matBoard, 'book:boards', { cast: true });
  add(own(edgesGeometry(1)), matEdges, 'book:edges', { cast: true });

  const xs = pageXs(36);
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
  add(own(pageGeo(1)), matUnder, 'book:pageUnder', { cast: true });

  // Lifting leaves: the right page's front-outer corner rises and settles, the page under it shows
  // through. Only that corner moves; the turntable and pop-ups stand on the still part.
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

  // ---- the cover leaf: left board with the printed front cover, page block, the left page ---------
  const cover = new THREE.Group();
  cover.name = 'cinematics:cover';
  group.add(cover);
  const coverParts = [];
  const coverPart = (geo, mat, name, { cast = true } = {}) => {
    geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    const mesh = add(geo, mat, name, { cast, parent: cover });
    mesh.frustumCulled = false;
    coverParts.push({ geo, base: Float32Array.from(geo.attributes.position.array) });
    return mesh;
  };
  coverPart(own(pageGeo(-1)), matLeft, 'book:pageLeft');
  coverPart(own(edgesGeometry(-1)), matEdges, 'book:edgesLeft');
  {
    // the board without its underside: the underside is the printed front cover
    const g = boxWorldUV(new THREE.BoxGeometry(bw, BOOK.board, bd * 2).translate(-bw / 2, BOOK.board / 2, 0), 1.6);
    const idx = Array.from(g.index.array);
    idx.splice(18, 6);
    g.setIndex(idx);
    coverPart(own(g), matBoard, 'book:boardLeft');
    const f = new THREE.PlaneGeometry(bw, bd * 2).rotateX(Math.PI / 2).translate(-bw / 2, 0, 0);
    const p = f.attributes.position, uv = f.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, -p.getX(i) / bw, 1 - (p.getZ(i) + bd) / (2 * bd));
    coverPart(own(f), ownMat(mats.paper('#ffffff', { map: texCover, unique: true, grain: 0.6 })), 'book:frontCover');
  }
  // the spine: a cloth strip from the back board's edge to the turning board's edge, bowed when shut
  const SPINE_N = 6;
  const spineGeo = own(gridGeometry(SPINE_N, 1, (c, r, o) => { o.x = 0; o.y = 0; o.z = r ? bd : -bd; o.u = c / SPINE_N; o.v = r; }));
  spineGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const spine = add(spineGeo, mats.paper(CLOTH, { overlay: mats.textures.hatch, overlayColor: '#233f47', grain: 1.4, side: THREE.DoubleSide }), 'book:spine', { cast: true });
  spine.frustumCulled = false;
  spine.visible = false;

  function shapeCover(s) {
    for (const part of coverParts) {
      const P = part.geo.attributes.position.array, b = part.base;
      for (let i = 0; i < P.length; i += 3) {
        leafPoint(b[i], b[i + 1], b[i + 2], s, tmp3);
        P[i] = tmp3[0]; P[i + 1] = tmp3[1]; P[i + 2] = tmp3[2];
      }
      part.geo.attributes.position.needsUpdate = true;
      part.geo.computeVertexNormals();
    }
    spine.visible = s > 0.002;
    if (!spine.visible) return;
    const [bx, by] = leafPoint(0, 0, 0, s, tmp3);
    const len = Math.hypot(bx, by) || 1;
    const nx = -by / len, ny = bx / len;
    const bow = 0.34 * s * s;
    const P = spineGeo.attributes.position.array, U = spineGeo.attributes.uv.array;
    for (let r = 0; r <= 1; r++) {
      for (let c = 0; c <= SPINE_N; c++) {
        const t = c / SPINE_N, k = Math.sin(Math.PI * t) * bow;
        const i = r * (SPINE_N + 1) + c;
        P[i * 3] = bx * t + nx * k;
        P[i * 3 + 1] = by * t + ny * k;
        U[i * 2] = (t * len) / 1.6;
        U[i * 2 + 1] = (r ? bd : -bd) / 1.6;
      }
    }
    spineGeo.attributes.position.needsUpdate = true;
    spineGeo.attributes.uv.needsUpdate = true;
    spineGeo.computeVertexNormals();
  }

  // ---- pop-ups + desk props: the right half's pieces with the props, the left half's on the cover ---
  const cutMat = mats.paper('#ffffff', { vertexColors: true });
  const batchR = createPopupBatch('cinematics:popups', cutMat);
  const batchL = createPopupBatch('cinematics:popupsLeft', cutMat);
  const props = createPopupBatch('cinematics:props', cutMat);
  const rand = mulberry32(77);
  const placed = []; // pop-up pieces with their unfold order

  // Card bottoms are cut to the page curve so wide V-fold panels meet the gutter without a gap.
  // Folded, a card lies on its own half of the page: away from the reader when it fits, otherwise
  // face down toward the reader (the tall backdrops would reach past the head of the book).
  const popup = (builder, x, z, yaw, extra = {}) => {
    const y = pageTop(x) + 0.03;
    const P = builder.pos, cy = Math.cos(yaw), sy = Math.sin(yaw);
    let H = 0;
    for (let i = 0; i < P.length; i += 3) {
      H = Math.max(H, P[i + 1]);
      if (P[i + 1] >= 0) continue;
      const wx = x + P[i] * cy + P[i + 2] * sy;
      P[i + 1] = Math.min(P[i + 1], pageTop(wx) - y - 0.05);
    }
    const out = (dir) => {
      const tx = x - dir * H * sy, tz = z - dir * H * cy;
      return Math.max(0, Math.abs(tz) - (BOOK.halfD - 0.3)) + Math.max(0, Math.abs(tx) - (BOOK.halfW - 0.3)) + (tx * x < 0 ? Math.abs(tx) + 1 : 0);
    };
    const fdir = out(1) <= out(-1) ? 1 : -1;
    const owner = x < 0 ? batchL : batchR;
    const p = owner.add(builder, { kind: 'hinge', x, y, z, yaw, open: 0, fdir, ...extra });
    p.owner = owner;
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
    // a cream mug with a red band: a dark one read as a black slab behind the pop-ups
    b.mesh(lathe, (nx, ny, nz, x, y, z) => {
      const r = Math.hypot(x, z);
      if (y > 7.55 && r < 3.25) return col.set('#4a2c1c');
      if (y > 8.5 || (r < 3.3 && y > 7.5)) return col.set('#f7efdd');
      if (y > 5.2 && y < 6.5 && r > 3.3) return col.set('#d9483b');
      return col.set('#ece0c6');
    });
    lathe.dispose();
    const handle = new THREE.TorusGeometry(1.9, 0.42, 8, 18, Math.PI).rotateZ(-Math.PI / 2).translate(3.5, 4.4, 0);
    b.mesh(handle, () => col.set('#ece0c6'));
    handle.dispose();
    props.add(b, { kind: 'static', x: 19, y: 0, z: -27, yaw: 3.6 });
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
    // in front of the book, clear of the opened cover: the closed book's foreground
    props.add(b, { kind: 'static', x: -12.5, y: 0.42, z: 13.6, yaw: 0.16 });
  }
  {
    const b = new PieceBuilder();
    const bookBox = (w, h, d, coverColor, y) => {
      const g = new THREE.BoxGeometry(w, h, d).translate(0, y + h / 2, 0);
      b.mesh(g, (nx, ny, nz) => {
        if (Math.abs(ny) > 0.5 || nx < -0.5) return col.set(coverColor);
        return col.set('#efe5cc');
      });
      g.dispose();
    };
    bookBox(15, 2.0, 10.5, '#a8413a', 0);
    props.add(b, { kind: 'static', x: -27.5, y: 0, z: -8.5, yaw: 0.16 });
    const c = new PieceBuilder();
    const g2 = new THREE.BoxGeometry(12, 1.6, 8.6).translate(0, 2.0 + 0.8, 0);
    c.mesh(g2, (nx, ny) => col.set(Math.abs(ny) > 0.5 || nx > 0.5 ? '#d8ad4c' : '#efe5cc'));
    g2.dispose();
    props.add(c, { kind: 'static', x: -27.0, y: 0, z: -8.8, yaw: -0.05 });
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
    props.add(b, { kind: 'static', x: 0, y: 0, z: 0, yaw: 0 });
  }
  {
    // gold stamping around the visible board margin: the back board's half here, the cover's with it
    const inset = 0.2, t = 0.07, y = BOOK.board + 0.004;
    const X = bw - inset, Z = bd - inset;
    for (const side of [1, -1]) {
      const b = new PieceBuilder();
      for (const [cx, cz, w, d] of [[side * X / 2, -Z, X, t], [side * X / 2, Z, X, t], [side * X, 0, t, 2 * Z]]) {
        const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(cx, y, cz);
        b.mesh(g, () => col.set(GOLD));
        g.dispose();
      }
      (side > 0 ? props : batchL).add(b, { kind: 'static', x: 0, y: 0, z: 0, yaw: 0 });
    }
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
    props.add(b, { kind: 'static', x: 0, y: 0, z: WALL_Z, yaw: 0 });
  }
  group.add(batchR.build());
  group.add(props.build());
  cover.add(batchL.build());

  // The left half's pieces ride the turning cover: the same map as its board and pages, normals
  // turned with it.
  let coverS = 0;
  function coverPost(P, N, o, count) {
    const th = -Math.PI * coverS, c = Math.cos(th), sn = Math.sin(th);
    for (let i = o, e = o + count * 3; i < e; i += 3) {
      leafPoint(P[i], P[i + 1], P[i + 2], coverS, tmp3);
      P[i] = tmp3[0]; P[i + 1] = tmp3[1]; P[i + 2] = tmp3[2];
      const nx = N[i], ny = N[i + 1];
      N[i] = nx * c - ny * sn;
      N[i + 1] = nx * sn + ny * c;
    }
  }

  // ---- the chapter sheet: one printed page that turns over the spread ------------------------------
  const TC = 28;
  const sheetGeo = own(gridGeometry(TC, 2, (c, r, o) => {
    const u = BOOK.halfW * Math.pow(c / TC, 1.3);
    o.x = u; o.y = pageTop(u) + SHEET_LIFT; o.z = -BOOK.halfD + (r / 2) * BOOK.halfD * 2;
    o.u = u / BOOK.halfW; o.v = 1 - (o.z + BOOK.halfD) / (BOOK.halfD * 2);
  }));
  faceUp(sheetGeo);
  sheetGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const sheetBase = Float32Array.from(sheetGeo.attributes.position.array);
  // The turning sheet is shown for under a second: half-size prints are plenty.
  const frontCanvas = pageCanvas(BOOK.halfD, 0.5), backCanvas = pageCanvas(BOOK.halfD, 0.5);
  const texFront = ownTex(toTexture(frontCanvas, renderer));
  const texBack = ownTex(toTexture(backCanvas, renderer));
  const sheet = new THREE.Group();
  sheet.name = 'cinematics:sheet';
  sheet.visible = false;
  group.add(sheet);
  add(sheetGeo, ownMat(mats.paper('#ffffff', { ...pageOpts, map: texFront, unique: true, side: THREE.FrontSide })), 'sheet:front', { cast: true, parent: sheet }).frustumCulled = false;
  add(sheetGeo, ownMat(mats.paper('#ffffff', { ...pageOpts, map: texBack, unique: true, side: THREE.BackSide })), 'sheet:back', { cast: true, parent: sheet }).frustumCulled = false;
  // Full-size canvases the next chapter is painted into before they swap with the page textures.
  let spareL = pageCanvas(BOOK.halfD), spareR = pageCanvas(BOOK.halfD);

  // p: 0 lying on the right page, 1 lying on the left. dir +1 turns forward (right to left).
  function shapeSheet(p, dir) {
    const P = sheetGeo.attributes.position.array, b = sheetBase;
    const w = smooth(0.1, 0.9, p);
    // the free edge leads while the page lifts and trails as it settles
    const lead = Math.sin(Math.PI * p) * (dir > 0 ? 0.62 - p : 0.38 - p) * 1.9;
    for (let i = 0; i < P.length; i += 3) {
      const u = b[i], y = b[i + 1];
      const yl = y + w * (2 * SHEET_Y - 2 * y);
      const a = Math.PI * p + lead * Math.pow(u / BOOK.halfW, 1.3);
      const c = Math.cos(a), sn = Math.sin(a), ry = yl - SHEET_Y;
      P[i] = u * c - ry * sn;
      P[i + 1] = SHEET_Y + u * sn + ry * c;
    }
    sheetGeo.attributes.position.needsUpdate = true;
    sheetGeo.computeVertexNormals();
  }

  function copyInto(dst, src, mirror) {
    const g = dst.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (mirror) g.setTransform(-1, 0, 0, 1, dst.width, 0);
    g.drawImage(src, 0, 0, dst.width, dst.height);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  function swapImage(tex, canvasNext) {
    const prev = tex.image;
    tex.image = canvasNext;
    tex.needsUpdate = true;
    return prev;
  }

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

  // faceYaw: world heading the new kart's nose points at when it appears; delay: seconds before it rises.
  function setHero(id, { animate = true, cheer = false, faceYaw = 0, delay = null } = {}) {
    const cur = currentHero();
    if (cur && cur.id === id) {
      if (cheer) { cur.visual.setEmotion('cheer'); cur.cheerT = 1.8; }
      if (delay != null && cur.s < 1e-3) cur.delay = Math.max(cur.delay, delay);
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
    const h = { id: ch.id, visual, holder, state: 'in', s: animate ? 0 : 1, v: 0, delay: delay ?? (animate ? 0.1 : 0), cheerT: 0 };
    visual.setEmotion(cheer ? 'cheer' : 'idle');
    if (cheer) h.cheerT = 1.8;
    heroes.push(h);
    applyHero(h);
    return h;
  }

  // The kart folds away (the book is closing or a page turns over the turntable).
  function hideHero({ animate = true } = {}) {
    for (const h of heroes.slice()) {
      if (animate && !game.reducedMotion && h.s > 0.01) h.state = 'out';
      else dropHero(h);
    }
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

  // ---- the player's kart parked on the desk beside the shut book; it folds away as the book opens ----
  // (it stands where the cover lands, so it is down well before the cover gets there)
  // A toy, not a racer: drawn larger than the race karts so it reads beside the big book.
  const DESK_KART = { x: -4.6, z: 5.0, yaw: 1.15, scale: 1.55 };
  const deskKart = { visual: null, holder: null, id: null, s: 0, v: 0, target: 0, delay: 0 };

  function setDeskKart(id, show, { snap = false, delay = 0 } = {}) {
    const rm = !!game.reducedMotion;
    if (show && deskKart.id !== id) {
      dropDeskKart();
      const ch = ROSTER.find((c) => c.id === id) || ROSTER[0];
      deskKart.visual = createKartVisual(game, ch, null);
      deskKart.visual.setEmotion('idle');
      deskKart.holder = new THREE.Group();
      deskKart.holder.name = 'deskKart:' + ch.id;
      deskKart.holder.position.set(DESK_KART.x, 0.005, DESK_KART.z);
      deskKart.holder.rotation.y = DESK_KART.yaw;
      deskKart.holder.add(deskKart.visual.object3d);
      group.add(deskKart.holder);
      deskKart.id = ch.id;
      deskKart.s = 0;
      deskKart.v = 0;
    }
    if (!deskKart.visual) return;
    deskKart.target = show ? 1 : 0;
    deskKart.delay = delay;
    if (snap || rm) { deskKart.s = deskKart.target; deskKart.v = 0; deskKart.delay = 0; }
    applyDeskKart();
  }

  function dropDeskKart() {
    if (!deskKart.visual) return;
    deskKart.holder.parent?.remove(deskKart.holder);
    deskKart.holder.remove(deskKart.visual.object3d);
    deskKart.visual.dispose();
    deskKart.visual = null;
    deskKart.holder = null;
    deskKart.id = null;
  }

  function applyDeskKart() {
    const s = Math.max(0.001, deskKart.s), k = DESK_KART.scale;
    const w = (0.82 + 0.18 * Math.min(1, s)) * k;
    deskKart.holder.scale.set(w, s * k, w);
    deskKart.holder.visible = s > 0.01;
  }

  function updateDeskKart(dt, rm) {
    const d = deskKart;
    if (!d.visual) return;
    if (d.delay > 0) { d.delay -= dt; }
    else if (rm) { d.s = d.target; d.v = 0; }
    else if (d.s !== d.target || d.v !== 0) {
      const up = d.target > d.s;
      const w = up ? HERO_UP_W : HERO_OUT_W, z = up ? HERO_UP_Z : 1;
      let left = dt;
      while (left > 1e-6) {
        const k = Math.min(left, 1 / 120);
        d.v += (w * w * (d.target - d.s) - 2 * z * w * d.v) * k;
        d.s += d.v * k;
        left -= k;
      }
      if (d.target === 0 && d.s < 0.02) { d.s = 0; d.v = 0; }
      if (Math.abs(d.target - d.s) < 1e-3 && Math.abs(d.v) < 1e-2) { d.s = d.target; d.v = 0; }
    }
    applyDeskKart();
    if (d.holder.visible) d.visual.update(dt, 1);
  }

  const heroPos = new THREE.Vector3();
  function heroSubject(out = heroPos) {
    disc.updateMatrixWorld();
    return out.set(0, discTop + 0.8, 0).applyMatrix4(disc.matrixWorld);
  }

  // ---- modes, folding, the book and the chapter sheet --------------------------------------------------
  let mode = null;
  let leafT = 0;
  let leafAmount = 0;
  // phase: 'open' | 'closing' | 'closed' | 'opening'; s: 0 open … 1 closed
  const book = { phase: 'open', s: 0, from: 0, t: 0, dur: 1, wait: 0 };
  // phase: null | 'fold' | 'turn'; to: chapter key being turned to
  const turn = { phase: null, t: 0, dir: 1, to: null, pending: null, p: 0 };

  const waveDelay = (p, base) => base + Math.abs(p.x) / BOOK.halfW * 0.28 + (p.z + BOOK.halfD) / (BOOK.halfD * 2) * 0.12;

  const foldedIn = (p, m) => m === 'podium' && (p === arch || p.tag === 'podiumFold');

  function applyCover(s) {
    if (s === coverS && book.applied) return;
    book.applied = true;
    coverS = s;
    book.s = s;
    shapeCover(s);
    batchL.setPost(s > 0 ? coverPost : null);
    batchL.mesh.visible = s < 0.999;
    // the right half's folded cards stay out of sight while the cover lies over them
    batchR.mesh.visible = s < 0.45;
    disc.visible = mode !== 'podium' && s < 0.999;
  }

  // Seconds until the cover leaves the right page (opening) and lands on the left.
  function openTimes() {
    if (book.phase !== 'opening') return [0, 0];
    const left = book.wait + Math.max(0, book.dur - book.t);
    return [Math.max(0, left - book.dur * 0.5), left];
  }

  function unfold({ from = null, delay = 0, snap = false } = {}) {
    if (book.phase === 'closed' || book.phase === 'closing') return;
    const [atR, atL] = openTimes();
    const busy = turn.phase ? TURN_FOLD + TURN_TIME : 0;
    for (const p of placed) {
      if (from === 0) p.owner.set(p, 0, { snap: true });
      const extra = Math.max(p.owner === batchL ? atL : atR, busy);
      p.owner.set(p, foldedIn(p, mode) ? 0 : 1, { delay: waveDelay(p, delay) + extra, snap: snap && extra === 0 });
    }
  }

  function fold({ snap = false } = {}) {
    for (const p of placed) p.owner.set(p, 0, { delay: snap ? 0 : (1 - Math.abs(p.x) / BOOK.halfW) * 0.12, snap });
  }

  function setMode(next) {
    mode = next;
    if (next !== 'title') setDeskKart(null, false, { snap: true });
    disc.visible = next !== 'podium' && book.s < 0.999;
    if (next === 'podium') {
      for (const p of placed) if (foldedIn(p, 'podium')) p.owner.set(p, 0, { snap: true });
      for (const h of heroes.slice()) dropHero(h);
    } else if (placed[0].target === 1) {
      for (const p of placed) if (foldedIn(p, 'podium')) p.owner.set(p, 1);
    }
  }

  // Closing folds every pop-up and the kart first, then turns the cover over; opening turns it back
  // and the pieces rise as the cover clears them (callers ask for that with unfold()).
  function setBook(state, { snap = false } = {}) {
    const rm = !!game.reducedMotion;
    if (state === 'closed') {
      if (book.phase === 'closed') return;
      if (book.phase === 'closing' && !snap) return;
      finishTurn();
      if (snap || rm) {
        fold({ snap: true });
        hideHero({ animate: false });
        book.phase = 'closed';
        applyCover(1);
        return;
      }
      fold();
      hideHero();
      book.phase = 'closing';
      book.from = book.s;
      book.t = 0;
      book.wait = book.s > 0 ? 0 : CLOSE_WAIT;
      book.dur = CLOSE_TIME * Math.max(0.3, 1 - book.s);
    } else {
      if (book.phase === 'open') return;
      if (book.phase === 'opening' && !snap) return;
      if (snap || rm) {
        book.phase = 'open';
        applyCover(0);
        return;
      }
      book.phase = 'opening';
      book.from = book.s;
      book.t = 0;
      book.wait = 0;
      book.dur = OPEN_TIME * Math.max(0.3, book.s);
    }
  }

  function updateBook(dt) {
    if (book.phase !== 'opening' && book.phase !== 'closing') return;
    if (book.wait > 0) { book.wait -= dt; return; }
    book.t += dt;
    const k = Math.min(1, book.t / book.dur);
    const to = book.phase === 'closing' ? 1 : 0;
    // quad in-out: the board lifts slowly, falls faster once past upright
    const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
    applyCover(book.from + (to - book.from) * e);
    if (k >= 1) book.phase = to ? 'closed' : 'open';
  }

  // ---- chapters -----------------------------------------------------------------------------------
  function paintChapter(key) {
    const ch = chapterOf(key);
    paintLeftPage(spareL, ch, BOOK.halfD);
    paintRightPage(spareR, ch, BOOK.halfD);
  }

  // Shows the chapter's spread: at once while the book is shut, otherwise with a page turn (forward to
  // a later chapter, back to an earlier one). Requests during a turn queue behind it.
  function showChapter(key, { animate = true } = {}) {
    if (!TRACKS[key]) return;
    if (turn.phase) { turn.pending = key; return; }
    if (key === chapterKey) return;
    const rm = !!game.reducedMotion;
    if (!animate || rm || book.phase !== 'open') {
      paintChapter(key);
      spareL = swapImage(texLeft, spareL);
      spareR = swapImage(texRight, spareR);
      chapterKey = key;
      return;
    }
    const from = chapterOf(chapterKey), to = chapterOf(key);
    turn.dir = to.chapter >= from.chapter ? 1 : -1;
    turn.to = key;
    turn.phase = 'fold';
    turn.t = 0;
    turn.pending = null;
    if (!turn.chain) {
      turn.wasUp = placed.some((p) => p.target > 0);
      turn.hero = currentHero()?.id || null;
    }
    turn.chain = false;
    fold();
    hideHero();
  }

  function startSheet() {
    paintChapter(turn.to);
    if (turn.dir > 0) {
      // the old right page lifts off and lands on the left with the new left page on its back
      copyInto(frontCanvas, texRight.image, false);
      copyInto(backCanvas, spareL, true);
      spareR = swapImage(texRight, spareR);
    } else {
      copyInto(backCanvas, texLeft.image, true);
      copyInto(frontCanvas, spareR, false);
      spareL = swapImage(texLeft, spareL);
    }
    texFront.needsUpdate = true;
    texBack.needsUpdate = true;
    turn.p = turn.dir > 0 ? 0 : 1;
    shapeSheet(turn.p, turn.dir);
    sheet.visible = true;
    disc.visible = false;
  }

  function finishTurn() {
    if (!turn.phase) return;
    if (turn.phase === 'fold') paintChapter(turn.to);
    if (turn.phase === 'fold' || turn.dir > 0) spareL = swapImage(texLeft, spareL);
    if (turn.phase === 'fold' || turn.dir < 0) spareR = swapImage(texRight, spareR);
    chapterKey = turn.to;
    turn.phase = null;
    turn.pending = null;
    sheet.visible = false;
    disc.visible = mode !== 'podium' && book.s < 0.999;
  }

  function updateTurn(dt) {
    if (!turn.phase) return;
    turn.t += dt;
    if (turn.phase === 'fold') {
      if (turn.t < TURN_FOLD) return;
      turn.phase = 'turn';
      turn.t = 0;
      startSheet();
      return;
    }
    const k = Math.min(1, turn.t / TURN_TIME);
    const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
    turn.p = turn.dir > 0 ? e : 1 - e;
    shapeSheet(turn.p, turn.dir);
    if (k < 1) return;
    if (turn.dir > 0) spareL = swapImage(texLeft, spareL);
    else spareR = swapImage(texRight, spareR);
    chapterKey = turn.to;
    turn.phase = null;
    sheet.visible = false;
    disc.visible = mode !== 'podium' && book.s < 0.999;
    const next = turn.pending;
    turn.pending = null;
    if (next && next !== chapterKey) { turn.chain = true; showChapter(next); return; }
    if (turn.wasUp) unfold({ delay: 0 });
    if (turn.hero) setHero(turn.hero, { animate: true, faceYaw: parkYaw ?? 0 });
  }

  function setSpin(speed) { spinTarget = speed; }
  function park(yaw) { parkYaw = yaw; }

  function update(dt) {
    const rm = !!game.reducedMotion;
    updateBook(dt);
    updateTurn(dt);
    batchR.update(dt, rm);
    batchL.update(dt, rm);
    props.update(dt, rm);
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
    updateDeskKart(dt, rm);
    // leaves breathe: a slow lift every few seconds, only while the reader browses an open book
    const want = (mode === 'title' || mode === 'select') && book.phase === 'open' && !turn.phase ? 1 : 0;
    leafAmount += (want - leafAmount) * Math.min(1, dt * (want ? 1.5 : 6));
    leafT += dt * (rm ? 0.5 : 1);
    const cycle = (t) => { const s = Math.max(0, Math.sin((t / 6.5) * Math.PI * 2 - 0.6)); return 0.06 + 0.62 * s * s; };
    for (const leaf of leaves) {
      const target = leafAmount * cycle(leafT - leaf.k * 0.45) * (leaf.k === 0 ? 1 : 0.55) * (rm ? 0.5 : 1);
      if (Math.abs(target - leaf.lift) > 1e-4) { leaf.lift = target; shapeLeaf(leaf, target); }
    }
  }

  function dispose() {
    for (const h of heroes.slice()) dropHero(h);
    dropDeskKart();
    batchR.dispose();
    batchL.dispose();
    props.dispose();
    group.parent?.remove(group);
    for (const g of geometries) g.dispose();
    for (const t of textures) t.dispose();
    for (const m of materials) m.dispose();
    geometries.length = 0;
    textures.length = 0;
    materials.length = 0;
  }

  applyCover(0);

  return {
    group, batch: batchR, placed, disc,
    // shadow frustum centre: the book's middle, nudged toward the turntable
    focus: new THREE.Vector3(2.0, 1.4, -0.6),
    get mode() { return mode; },
    get book() { return book.phase; },
    get coverS() { return book.s; },
    get chapter() { return turn.phase ? turn.to : chapterKey; },
    get turning() { return !!turn.phase; },
    setMode, unfold, fold, setBook, showChapter, setHero, hideHero, currentHero, heroSubject, setSpin, park, setDeskKart,
    update, dispose,
    own, ownTex, ownMat,
  };
}
