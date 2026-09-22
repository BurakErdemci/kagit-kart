// def → TrackData (ARCHITECTURE.md §9.2) plus the track's own meshes. Layout rule violations are
// printed with console.warn('[track:<id>] …') — the playtest counts them.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { analyzeLayout, buildGrid, EDGE_CODES, sampleTrack, wrapIndex } from './trackSampler.js';
import { attachQueries } from './trackQuery.js';

class GeoBuilder {
  constructor() { this.pos = []; this.uv = []; this.idx = []; }
  // rows × cols grid of vertices; fn(r, c, out) fills out.x/y/z/u/v
  strip(rows, cols, fn) {
    if (rows < 2 || cols < 2) return;
    const base = this.pos.length / 3;
    const o = { x: 0, y: 0, z: 0, u: 0, v: 0 };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        fn(r, c, o);
        this.pos.push(o.x, o.y, o.z);
        this.uv.push(o.u, o.v);
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = base + r * cols + c, b = a + 1, cc = a + cols, d = cc + 1;
        this.idx.push(a, b, cc, b, d, cc);
      }
    }
  }
  get empty() { return this.idx.length === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

function mix(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

// Consecutive index runs where pred(i) holds, wrapping around the loop.
function runs(N, pred) {
  const out = [];
  let start = -1;
  for (let i = 0; i < N; i++) {
    if (pred(i)) { if (start < 0) start = i; }
    else if (start >= 0) { out.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) {
    if (out.length && out[0][0] === 0) out[0] = [start, out[0][1] + N];
    else out.push([start, N - 1]);
  }
  if (out.length === 1 && out[0][0] === 0 && out[0][1] === N - 1) out[0] = [0, N]; // whole loop, closed
  return out;
}

export function buildTrack(game, def) {
  const cfg = game.config.track;
  const mats = game.materials;
  const theme = def.theme;
  const data = sampleTrack(def, cfg);
  const analysis = analyzeLayout(data, def, cfg);
  for (const w of analysis.warnings) console.warn(`[track:${def.id}] ${w}`);
  const grid = buildGrid(data, cfg.gridCell);
  const s = data.samples;
  const N = data.sampleCount;
  const L = data.length;
  const pageY = data.minY - 0.05;

  const group = new THREE.Group();
  group.name = `track:${def.id}`;

  const track = {
    def, length: L, sampleCount: N, spacing: data.spacing, samples: s,
    checkpoints: cfg.checkpoints.slice(),
    killY: data.minY - cfg.killDepth,
    bounds: new THREE.Box3(
      new THREE.Vector3(data.bounds2d.minX, data.minY - 1, data.bounds2d.minZ),
      new THREE.Vector3(data.bounds2d.maxX, data.maxY + 6, data.bounds2d.maxZ),
    ),
    objects: {},
    rampMeshes: [],
    ramps: data.ramps,
    pads: data.pads,
    startIndex: data.startIndex,
    startDist: data.startDist,
    startT: data.startIndex / N,
    pageY,
    analysis,
    group,
    disposed: false,
    dispose,
  };
  attachQueries(track, data, grid, cfg);

  const idx = (i) => wrapIndex(i, N);
  const edgeY = (i, side) => s.py[i] + side * s.halfWidth[i] * s.slopeRight[i];
  // Horizontal offset along the unbanked right vector.
  const hxAt = (i) => s.hx[i], hzAt = (i) => s.hz[i];

  const add = (geo, mat, name, { receive = true, cast = false } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.receiveShadow = receive;
    m.castShadow = cast;
    group.add(m);
    return m;
  };

  // --- road ribbon --------------------------------------------------------------------------
  const dashCount = Math.max(1, Math.round(L / cfg.roadDashPeriod));
  const roadB = new GeoBuilder();
  roadB.strip(N + 1, 2, (r, c, o) => {
    const i = idx(r);
    const l = (c === 0 ? -1 : 1) * s.halfWidth[i];
    o.x = s.px[i] + s.rx[i] * l; o.y = s.py[i] + s.ry[i] * l; o.z = s.pz[i] + s.rz[i] * l;
    o.u = c; o.v = (r / N) * dashCount;
  });
  const roadMat = mats.paper(theme.road, { overlay: mats.textures.roadLines, overlayColor: theme.roadLine, grain: 2.2 });
  track.objects.road = add(roadB.build(), roadMat, 'road');

  // --- offroad band (both sides, flat at edge height, tucked under the road edge) -------------
  const bandB = new GeoBuilder();
  for (const side of [-1, 1]) {
    bandB.strip(N + 1, 3, (r, c, o) => {
      const i = idx(r);
      const hw = s.halfWidth[i];
      const lat = c === 0 ? hw - 0.4 : c === 1 ? hw + 0.2 : hw + s.offroad[i];
      const y = edgeY(i, side) - 0.03;
      // columns ordered left→right in travel direction so faces point up
      const l = side * lat;
      o.x = s.px[i] + hxAt(i) * l; o.y = y; o.z = s.pz[i] + hzAt(i) * l;
      o.u = s.dist[i] / 5 + (r === N ? L / 5 - s.dist[i] / 5 : 0); o.v = l / 5;
    });
  }
  // left band columns run outer→inner reversed; flip its winding by rebuilding indices order
  fixWinding(bandB, N + 1, 3);
  const offMat = mats.paper(theme.offroad, { overlay: mats.textures.hatch, overlayColor: mix(theme.offroad, theme.ink, 0.35) });
  track.objects.offroad = add(bandB.build(), offMat, 'offroad');

  // --- skirts: paper sides from the band's outer edge down to the page where the road is raised
  const skirtB = new GeoBuilder();
  for (const side of [-1, 1]) {
    for (const [a, b] of runs(N, (i) => edgeY(i, side) - pageY > 0.12)) {
      const rows = b - a + 1 + (b - a + 1 >= N ? 0 : 0);
      skirtB.strip(rows, 2, (r, c, o) => {
        const i = idx(a + r);
        const l = side * (s.halfWidth[i] + s.offroad[i]);
        o.x = s.px[i] + hxAt(i) * l; o.z = s.pz[i] + hzAt(i) * l;
        o.y = c === 0 ? edgeY(i, side) - 0.03 : pageY;
        o.u = s.dist[i] / 4; o.v = c;
      });
    }
  }
  if (!skirtB.empty) {
    const skirtMat = mats.paper(mix(theme.wall, theme.paper, 0.3), { side: THREE.DoubleSide, overlay: mats.textures.stripes, overlayColor: mix(theme.wall, theme.ink, 0.15), overlayRepeat: [1, 0.5] });
    track.objects.skirts = add(skirtB.build(), skirtMat, 'skirts');
  }

  // --- curbs on corners -------------------------------------------------------------------
  const curbB = new GeoBuilder();
  const cornerMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (Math.abs(s.curvature[i]) > 1 / 150) {
      for (let k = -12; k <= 12; k++) cornerMask[idx(i + k)] = 1;
    }
  }
  const curbPeriod = 4;
  for (const side of [-1, 1]) {
    for (const [a, b] of runs(N, (i) => cornerMask[i] === 1 && s.rampId[i] < 0)) {
      curbB.strip(b - a + 1, 2, (r, c, o) => {
        const i = idx(a + r);
        const hw = s.halfWidth[i];
        const lat = side < 0 ? (c === 0 ? -(hw + 0.45) : -(hw - 0.55)) : (c === 0 ? hw - 0.55 : hw + 0.45);
        const y = s.py[i] + s.ry[i] * lat + cfg.curbHeight;
        o.x = s.px[i] + s.rx[i] * lat; o.y = y; o.z = s.pz[i] + s.rz[i] * lat;
        o.u = c; o.v = (a + r) * data.spacing / curbPeriod;
      });
    }
  }
  if (!curbB.empty) {
    const curbMat = mats.paper(theme.curbA, { overlay: mats.textures.stripes, overlayColor: theme.curbB });
    track.objects.curbs = add(curbB.build(), curbMat, 'curbs');
  }

  // --- walls (low paper fence at the band's outer edge) ---------------------------------------
  const wallB = new GeoBuilder();
  const wallH = cfg.wallHeight;
  for (const side of [-1, 1]) {
    const edges = side < 0 ? s.edgeLeft : s.edgeRight;
    for (const [a, b] of runs(N, (i) => edges[i] === EDGE_CODES.wall)) {
      const rows = b - a + 1;
      // inner face, top cap, outer face as one folded strip (4 profile points)
      wallB.strip(rows, 4, (r, c, o) => {
        const i = idx(a + r);
        const base = s.halfWidth[i] + s.offroad[i];
        const lat = side * (c < 2 ? base : base + 0.18);
        const y0 = edgeY(i, side) - 0.03;
        o.x = s.px[i] + hxAt(i) * lat; o.z = s.pz[i] + hzAt(i) * lat;
        o.y = c === 0 || c === 3 ? y0 : y0 + wallH;
        o.u = (a + r) * data.spacing / 2.4; o.v = c === 0 || c === 3 ? 0 : 1;
      });
    }
  }
  if (!wallB.empty) {
    const wallMat = mats.paper(theme.wall, { side: THREE.DoubleSide, overlay: mats.textures.fence, overlayColor: mix(theme.wall, theme.ink, 0.28) });
    track.objects.walls = add(wallB.build(), wallMat, 'walls');
  } else {
    track.objects.walls = null;
  }

  // --- water and void edges ---------------------------------------------------------------
  const waterB = new GeoBuilder();
  const voidB = new GeoBuilder();
  for (const side of [-1, 1]) {
    const edges = side < 0 ? s.edgeLeft : s.edgeRight;
    for (const [code, builder, width] of [[EDGE_CODES.water, waterB, 46], [EDGE_CODES.void, voidB, 60]]) {
      for (const [a, b] of runs(N, (i) => edges[i] === code)) {
        builder.strip(b - a + 1, 2, (r, c, o) => {
          const i = idx(a + r);
          const base = s.halfWidth[i] + s.offroad[i];
          const lat = side * (c === (side < 0 ? 1 : 0) ? base - 0.2 : base + width);
          o.x = s.px[i] + hxAt(i) * lat; o.z = s.pz[i] + hzAt(i) * lat;
          o.y = code === EDGE_CODES.water ? Math.max(pageY + 0.05, edgeY(i, side) - cfg.waterDrop) : pageY + 0.03;
          o.u = (a + r) * data.spacing / 8; o.v = lat / 8;
        });
      }
    }
  }
  if (!waterB.empty) {
    const waterColor = theme.water || '#79b4d6';
    const waterMat = mats.paper(waterColor, { side: THREE.DoubleSide, overlay: mats.textures.waves, overlayColor: mix(waterColor, '#ffffff', 0.55), scroll: 0.08 });
    track.objects.water = add(waterB.build(), waterMat, 'water');
  }
  if (!voidB.empty) {
    const voidMat = mats.paper(theme.desk, { side: THREE.DoubleSide, overlay: mats.textures.grain, overlayColor: mix(theme.desk, theme.ink, 0.4) });
    track.objects.void = add(voidB.build(), voidMat, 'void');
  }

  // --- start line + arch --------------------------------------------------------------------
  const si = data.startIndex;
  const lineB = new GeoBuilder();
  lineB.strip(4, 2, (r, c, o) => {
    const i = idx(si - 1 + r);
    const hw = s.halfWidth[i];
    const l = (c === 0 ? -1 : 1) * hw;
    o.x = s.px[i] + s.rx[i] * l; o.y = s.py[i] + s.ry[i] * l + 0.025; o.z = s.pz[i] + s.rz[i] * l;
    o.u = (l + hw) / 1.5; o.v = r * data.spacing / 1.5;
  });
  const lineMat = mats.paper('#ffffff', { map: mats.textures.checker, halftone: true });
  const startLine = add(lineB.build(), lineMat, 'startLine');
  const arch = buildArch(s, si, theme, mats);
  group.add(arch);
  const startGroup = new THREE.Group();
  startGroup.name = 'startLine';
  group.remove(startLine);
  startGroup.add(startLine, arch);
  group.add(startGroup);
  track.objects.startLine = startGroup;

  // --- boost pads -------------------------------------------------------------------------
  const padB = new GeoBuilder();
  for (const p of data.pads) {
    const rows = Math.round(cfg.padLength / data.spacing) + 1;
    const i0 = Math.round(p.d0 / data.spacing);
    padB.strip(rows, 2, (r, c, o) => {
      const i = idx(i0 + r);
      const l = p.lateral + (c === 0 ? -1 : 1) * p.halfWidth;
      o.x = s.px[i] + s.rx[i] * l; o.y = s.py[i] + s.ry[i] * l + 0.035; o.z = s.pz[i] + s.rz[i] * l;
      o.u = c; o.v = r * data.spacing / 2;
    });
  }
  if (!padB.empty) {
    const padMat = mats.paper('#f08a24', { overlay: mats.textures.chevrons, overlayColor: '#ffe27a', scroll: 1.6 });
    track.objects.boostPads = add(padB.build(), padMat, 'boostPads');
  } else {
    track.objects.boostPads = null;
  }

  // --- ramps ------------------------------------------------------------------------------
  const rampGroup = new THREE.Group();
  rampGroup.name = 'ramps';
  const rampMat = mats.paper(theme.accents?.[0] || '#f2c14e', { side: THREE.DoubleSide, overlay: mats.textures.chevrons, overlayColor: mix(theme.accents?.[0] || '#f2c14e', theme.ink, 0.55) });
  for (const r of data.ramps) {
    const obj = buildRamp(s, data, r, idx, rampMat);
    rampGroup.add(obj);
    track.rampMeshes.push({ ramp: r.def, object3d: obj });
  }
  group.add(rampGroup);
  track.objects.ramps = rampGroup;

  // --- the page, the book block under it and the desk ---------------------------------------
  const b2 = data.bounds2d;
  const m = cfg.pageMargin;
  const pw = b2.maxX - b2.minX + 2 * m, pd = b2.maxZ - b2.minZ + 2 * m;
  const cx = (b2.minX + b2.maxX) / 2, cz = (b2.minZ + b2.maxZ) / 2;
  const pageGeo = new THREE.PlaneGeometry(pw, pd, 1, 1);
  pageGeo.rotateX(-Math.PI / 2);
  pageGeo.translate(cx, pageY, cz);
  worldUV(pageGeo, 32);
  const pageMat = mats.paper(theme.paper, { overlay: mats.textures.grid, overlayColor: mix(theme.paper, theme.ink, 0.16) });
  const page = add(pageGeo, pageMat, 'page');
  const blockGeo = new THREE.BoxGeometry(pw + 6, 4, pd + 6);
  blockGeo.translate(cx + 3, pageY - 2.06, cz + 3);
  const block = add(blockGeo, mats.paper(mix(theme.paper, theme.ink, 0.08), { overlay: mats.textures.stripes, overlayColor: mix(theme.paper, theme.ink, 0.22), overlayRepeat: [1, 24] }), 'pageBlock', { receive: false });
  const deskGeo = new THREE.PlaneGeometry(4000, 4000, 1, 1);
  deskGeo.rotateX(-Math.PI / 2);
  deskGeo.translate(cx, pageY - cfg.deskDrop, cz);
  worldUV(deskGeo, 40);
  const desk = add(deskGeo, mats.paper(theme.desk, { overlay: mats.textures.hatch, overlayColor: mix(theme.desk, theme.ink, 0.3) }), 'desk', { receive: false });
  const ground = new THREE.Group();
  ground.name = 'ground';
  group.remove(page, block, desk);
  ground.add(page, block, desk);
  group.add(ground);
  track.objects.ground = ground;

  game.scene.add(group);

  function dispose() {
    if (track.disposed) return;
    track.disposed = true;
    group.parent?.remove(group);
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mm = o.material;
      if (mm && !mm.userData?.paper?.cached && !mm.userData?.cached) (Array.isArray(mm) ? mm : [mm]).forEach((x) => x.dispose());
    });
  }

  return track;
}

function fixWinding(builder, rows, cols) {
  // The left band (first strip) runs its columns from inner to outer on the left, i.e. right-to-left
  // in travel direction, which points its faces down. Swap its triangles.
  const perStrip = (rows - 1) * (cols - 1) * 6;
  for (let t = 0; t < perStrip; t += 3) {
    const a = builder.idx[t + 1];
    builder.idx[t + 1] = builder.idx[t + 2];
    builder.idx[t + 2] = a;
  }
}

function worldUV(geo, scale) {
  const p = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / scale, p.getZ(i) / scale);
  uv.needsUpdate = true;
}

function buildArch(s, i, theme, mats) {
  const hw = s.halfWidth[i];
  const h = Math.atan2(s.tx[i], s.tz[i]);
  const span = 2 * hw + 3;
  const post = new THREE.BoxGeometry(0.7, 6.2, 0.7);
  const p1 = post.clone().translate(-span / 2, 3.1, 0);
  const p2 = post.clone().translate(span / 2, 3.1, 0);
  const beam = new THREE.BoxGeometry(span + 0.7, 0.5, 0.5).translate(0, 6.0, 0);
  const frame = mergeGeometries([p1, p2, beam]);
  post.dispose(); p1.dispose(); p2.dispose(); beam.dispose();
  const banner = new THREE.BoxGeometry(span - 1.2, 1.3, 0.12).translate(0, 5.15, 0);
  bannerUV(banner, span);
  const group = new THREE.Group();
  group.name = 'arch';
  const fm = new THREE.Mesh(frame, mats.paper(theme.wall));
  fm.castShadow = true; fm.receiveShadow = true;
  const bm = new THREE.Mesh(banner, mats.paper('#ffffff', { map: mats.textures.checker }));
  bm.castShadow = true; bm.receiveShadow = true;
  group.add(fm, bm);
  group.position.set(s.px[i], s.py[i], s.pz[i]);
  group.rotation.y = h;
  return group;
}

function bannerUV(geo, span) {
  const uv = geo.attributes.uv;
  const p = geo.attributes.position;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, (p.getX(k) + span) / 1.3, (p.getY(k) - 4.5) / 1.3);
  uv.needsUpdate = true;
}

function buildRamp(s, data, r, idx, mat) {
  const sp = data.spacing;
  const i0 = Math.round(r.d0 / sp);
  const rows = Math.max(2, Math.round(r.length / sp) + 1);
  const o0 = new THREE.Vector3(s.px[idx(i0)], s.py[idx(i0)], s.pz[idx(i0)]);
  const h0 = s.heading[idx(i0)];
  const inv = new THREE.Matrix4().makeRotationY(-h0);
  const v = new THREE.Vector3();
  const b = new GeoBuilder();
  const at = (row, lat, lift, o) => {
    const i = idx(i0 + row);
    const hgt = r.height * Math.min(1, (row * sp) / r.length);
    v.set(s.px[i] + s.rx[i] * lat, s.py[i] + s.ry[i] * lat + (lift ? hgt : 0) + 0.02, s.pz[i] + s.rz[i] * lat);
    v.sub(o0).applyMatrix4(inv);
    o.x = v.x; o.y = v.y; o.z = v.z;
  };
  const hwAt = (row) => s.halfWidth[idx(i0 + row)] * 0.98;
  // top surface
  b.strip(rows, 2, (row, c, o) => {
    const lat = (c === 0 ? -1 : 1) * hwAt(row);
    at(row, lat, true, o);
    o.u = c * 4; o.v = row * sp / 3;
  });
  // side walls
  for (const side of [-1, 1]) {
    b.strip(rows, 2, (row, c, o) => {
      at(row, side * hwAt(row), c === 1, o);
      o.u = row * sp / 3; o.v = c;
    });
  }
  // lip face
  b.strip(2, 2, (row, c, o) => {
    const lat = (c === 0 ? -1 : 1) * hwAt(rows - 1);
    at(rows - 1, lat, row === 1, o);
    o.u = c * 4; o.v = row;
  });
  const mesh = new THREE.Mesh(b.build(), mat);
  mesh.name = `ramp:${r.index}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.copy(o0);
  mesh.rotation.y = h0;
  return mesh;
}
