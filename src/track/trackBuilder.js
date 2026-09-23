// def → TrackData (ARCHITECTURE.md §9.2) plus the track's own meshes. Layout rule violations are
// printed with console.warn('[track:<id>] …') — the playtest counts them.
// The meshes are the pop-up book itself: a road printed on the page, paper curb tabs, folded card walls,
// cut-paper waves, voids cut through the page, folded card ramps, foil boost stickers, and the page lying
// on its book block on the reader's desk.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { analyzeLayout, buildGrid, EDGE_CODES, SURF_CODES, sampleTrack, wrapIndex } from './trackSampler.js';
import { attachQueries } from './trackQuery.js';
import { buildPagePrint } from '../render/pagePrint.js';

class GeoBuilder {
  // attrs: extra per-vertex attributes { name: itemSize } that fn fills as out[name][0..size-1]
  constructor(attrs = {}) {
    this.pos = []; this.uv = []; this.idx = [];
    this.attrs = attrs;
    this.extra = {};
    for (const k in attrs) this.extra[k] = [];
  }
  // rows × cols grid of vertices; fn(r, c, out) fills out.x/y/z/u/v (+ extra attributes)
  strip(rows, cols, fn) {
    if (rows < 2 || cols < 2) return;
    const base = this.pos.length / 3;
    const o = { x: 0, y: 0, z: 0, u: 0, v: 0 };
    for (const k in this.attrs) o[k] = new Array(this.attrs[k]).fill(0);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        fn(r, c, o);
        this.pos.push(o.x, o.y, o.z);
        this.uv.push(o.u, o.v);
        for (const k in this.attrs) for (let j = 0; j < this.attrs[k]; j++) this.extra[k].push(o[k][j]);
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
    for (const k in this.attrs) g.setAttribute(k, new THREE.Float32BufferAttribute(this.extra[k], this.attrs[k]));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

function mix(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

const set4 = (arr, a, b, c, d) => { arr[0] = a; arr[1] = b; arr[2] = c; arr[3] = d; };
const setCol = (arr, col) => { arr[0] = col.r; arr[1] = col.g; arr[2] = col.b; };

// The real paper of the book: page edges and cut faces are this colour whatever a chapter prints on it.
const SHEET = '#efe6d2';

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
  // Point on the (banked) road surface at a fractional sample index.
  const surfAt = (f, lat, o) => {
    const i0 = Math.floor(f), t = f - i0, a = idx(i0), b = idx(i0 + 1);
    o.x = (s.px[a] + s.rx[a] * lat) * (1 - t) + (s.px[b] + s.rx[b] * lat) * t;
    o.y = (s.py[a] + s.ry[a] * lat) * (1 - t) + (s.py[b] + s.ry[b] * lat) * t;
    o.z = (s.pz[a] + s.rz[a] * lat) * (1 - t) + (s.pz[b] + s.rz[b] * lat) * t;
  };
  const deskY = pageY - cfg.deskDrop;
  const extraDispose = [];

  const add = (geo, mat, name, { receive = true, cast = false } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.receiveShadow = receive;
    m.castShadow = cast;
    group.add(m);
    return m;
  };

  // Per-sample print data: smoothed curvature (tyre scuffs) and how far the road sags below its
  // surroundings (halftone in dips).
  const curvS = new Float32Array(N), dip = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let c = 0, y = 0;
    for (let k = -10; k <= 10; k++) c += s.curvature[idx(i + k)];
    for (let k = -25; k <= 25; k++) y += s.py[idx(i + k)];
    curvS[i] = c / 21;
    dip[i] = Math.min(1, Math.max(0, (y / 51 - s.py[i] - 0.25) / 1.2));
  }
  // Spans the def marks as bridges have air under the deck: no paper skirts there.
  const bridge = new Uint8Array(N);
  for (const br of def.bridges || []) {
    const a = Math.round(br.from * N), b = Math.round(br.to * N);
    for (let i = a; i !== b + 1 && i - a <= N; i++) bridge[idx(i)] = 1;
  }

  // The page's gutter: the book's spine runs along z through the middle of the page.
  const b2 = data.bounds2d;
  const pm = cfg.pageMargin;
  const pw = b2.maxX - b2.minX + 2 * pm, pd = b2.maxZ - b2.minZ + 2 * pm;
  const cx = (b2.minX + b2.maxX) / 2, cz = (b2.minZ + b2.maxZ) / 2;
  const gutterLine = [cx, cz, 1, 0], gutterW = 26;

  // --- road: an ink-wash strip printed on the page; two halves so each carries its own surface code
  const dashCount = Math.max(1, Math.round(L / cfg.roadDashPeriod));
  const roadB = new GeoBuilder({ aKkA: 4, aKkB: 4 });
  for (const side of [-1, 1]) {
    roadB.strip(N + 1, 2, (r, c, o) => {
      const i = idx(r);
      const hw = s.halfWidth[i];
      const l = side < 0 ? (c === 0 ? -hw : 0) : (c === 0 ? 0 : hw);
      o.x = s.px[i] + s.rx[i] * l; o.y = s.py[i] + s.ry[i] * l; o.z = s.pz[i] + s.rz[i] * l;
      o.u = c; o.v = (r / N) * dashCount;
      const code = side < 0 ? (s.surface[i] & 3) : ((s.surface[i] >> 2) & 3);
      set4(o.aKkA, l, r * data.spacing, hw, Math.max(-1, Math.min(1, curvS[i] * 40)));
      set4(o.aKkB, dip[i], code === SURF_CODES.ice ? 1 : 0, code === SURF_CODES.sand ? 1 : 0, 0);
    });
  }
  const roadMat = mats.surface('road', {
    c0: theme.road, c1: theme.roadLine, c2: mix(theme.road, '#eef6ff', 0.72), c3: mix(theme.road, '#e3c48c', 0.7),
    v0: [L / dashCount, 0, 0, gutterW], v1: gutterLine,
  }, { grain: 1.6 });
  track.objects.road = add(roadB.build(), roadMat, 'road');

  // --- offroad band: printed colour breaking into a halftone toward the page --------------------
  const bandB = new GeoBuilder({ aKkA: 4, aKkB: 4 });
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
      set4(o.aKkA, Math.max(0, (lat - hw) / s.offroad[i]), r * data.spacing, s.offroad[i], 0);
    });
  }
  // left band columns run outer→inner reversed; flip its winding by rebuilding indices order
  fixWinding(bandB, N + 1, 3);
  const bandMat = mats.surface('band', {
    c0: theme.offroad, c1: theme.paper, c2: mix(theme.offroad, theme.ink, 0.38), v0: [0, 0, 0, gutterW], v1: gutterLine,
  });
  track.objects.offroad = add(bandB.build(), bandMat, 'offroad');

  // --- skirts: paper sides from the band's outer edge down to the page where the road is raised
  const skirtB = new GeoBuilder();
  for (const side of [-1, 1]) {
    for (const [a, b] of runs(N, (i) => edgeY(i, side) - pageY > 0.12 && !bridge[i])) {
      skirtB.strip(b - a + 1, 2, (r, c, o) => {
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

  // --- curbs: red/white paper tabs glued along the corners, outer edges lifting off the page ------
  const curbB = new GeoBuilder({ color: 3 });
  const cornerMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (Math.abs(s.curvature[i]) > 1 / 150) {
      for (let k = -12; k <= 12; k++) cornerMask[idx(i + k)] = 1;
    }
  }
  const curbCols = [new THREE.Color(theme.curbA), new THREE.Color(theme.curbB)];
  const tabLen = 2 / data.spacing, tabGap = 0.1 / data.spacing;
  const tp = { x: 0, y: 0, z: 0 };
  for (const side of [-1, 1]) {
    for (const [a, b] of runs(N, (i) => cornerMask[i] === 1 && s.rampId[i] < 0)) {
      const tabs = Math.max(1, Math.floor((b - a) / tabLen));
      for (let k = 0; k < tabs; k++) {
        const f0 = a + k * tabLen + tabGap, f1 = a + (k + 1) * tabLen - tabGap;
        const lift = 0.07 + 0.06 * ((k * 7 + a) % 5) / 4;
        const col = curbCols[k & 1];
        curbB.strip(3, 3, (r, c, o) => {
          const f = f0 + (f1 - f0) * r / 2;
          const hw = s.halfWidth[idx(Math.round(f))];
          // c runs left→right; the outer column (away from the road) is the lifted one
          const outer = side < 0 ? 0 : 2;
          const inner = side < 0 ? -(hw - 0.55) : hw - 0.55, out = side < 0 ? -(hw + 0.45) : hw + 0.45;
          const lat = c === 1 ? (inner + out) / 2 : (c === outer ? out : inner);
          surfAt(f, lat, tp);
          const up = c === outer ? lift : c === 1 ? 0.035 : 0.022;
          o.x = tp.x; o.y = tp.y + up + (r === 1 ? 0 : 0.008); o.z = tp.z;
          o.u = c / 2; o.v = r / 2;
          setCol(o.color, col);
        });
      }
    }
  }
  if (!curbB.empty) {
    const curbMat = mats.paper('#ffffff', { vertexColors: true });
    track.objects.curbs = add(curbB.build(), curbMat, 'curbs', { cast: true });
  }

  // --- walls: folded card fences, pleated like an accordion; alternate panels face the light or not --
  const wallB = new GeoBuilder({ color: 3 });
  const wallH = cfg.wallHeight;
  const panelShade = [new THREE.Color(1, 1, 1), new THREE.Color(0.8, 0.8, 0.82)];
  for (const side of [-1, 1]) {
    const edges = side < 0 ? s.edgeLeft : s.edgeRight;
    for (const [a, b] of runs(N, (i) => edges[i] === EDGE_CODES.wall)) {
      for (let k = 0, f = a; f < b; k++, f += 2) {
        const ends = [f, Math.min(b, f + 2)];
        const pleat = [(k & 1 ? 0.14 : -0.14) * (f === a ? 0 : 1), (k & 1 ? -0.14 : 0.14) * (ends[1] === b ? 0 : 1)];
        // inner face, top cap, outer face as one folded strip (4 profile points)
        wallB.strip(2, 4, (r, c, o) => {
          const i = idx(ends[r]);
          const base = s.halfWidth[i] + s.offroad[i] + pleat[r];
          const lat = side * (c < 2 ? base : base + 0.18);
          const y0 = edgeY(i, side) - 0.03;
          o.x = s.px[i] + hxAt(i) * lat; o.z = s.pz[i] + hzAt(i) * lat;
          o.y = c === 0 || c === 3 ? y0 : y0 + wallH;
          o.u = r; o.v = c === 0 || c === 3 ? 0 : 1;
          setCol(o.color, panelShade[k & 1]);
        });
      }
    }
  }
  if (!wallB.empty) {
    const wallMat = mats.paper(theme.wall, { side: THREE.DoubleSide, vertexColors: true, overlay: mats.textures.rail, overlayColor: mix(theme.wall, theme.ink, 0.4) });
    track.objects.walls = add(wallB.build(), wallMat, 'walls');
  } else {
    track.objects.walls = null;
  }

  // --- water: a printed sheet plus rows of cut-paper waves sliding along the shore ------------------
  // def.waterLevel (absolute y) puts every water edge at one surface, e.g. under a high bridge.
  const waterY = (i, side) => (def.waterLevel != null
    ? Math.max(pageY + 0.05, def.waterLevel + 0.04)
    : Math.max(pageY + 0.05, edgeY(i, side) - cfg.waterDrop));
  const waterB = new GeoBuilder();
  const waveB = new GeoBuilder({ aKkA: 4, aKkB: 4 });
  const voidB = new GeoBuilder({ aKkA: 4, aKkB: 4 });
  const VOID_W = 60;
  const WAVE_ROWS = [[3, 0.8], [8.5, 1.05], [16, 1.3]]; // lateral beyond the band, height
  for (const side of [-1, 1]) {
    const edges = side < 0 ? s.edgeLeft : s.edgeRight;
    for (const [a, b] of runs(N, (i) => edges[i] === EDGE_CODES.water)) {
      waterB.strip(b - a + 1, 2, (r, c, o) => {
        const i = idx(a + r);
        const base = s.halfWidth[i] + s.offroad[i];
        const lat = side * (c === (side < 0 ? 1 : 0) ? base - 0.2 : base + 46);
        o.x = s.px[i] + hxAt(i) * lat; o.z = s.pz[i] + hzAt(i) * lat;
        o.y = waterY(i, side);
        o.u = (a + r) * data.spacing / 8; o.v = lat / 8;
      });
      WAVE_ROWS.forEach(([off, h], row) => {
        const rowsAt = [];
        for (let f = a; f < b; f += 2) rowsAt.push(f);
        rowsAt.push(b);
        waveB.strip(rowsAt.length, 2, (r, c, o) => {
          const i = idx(rowsAt[r]);
          const lat = side * (s.halfWidth[i] + s.offroad[i] + off);
          o.x = s.px[i] + hxAt(i) * lat; o.z = s.pz[i] + hzAt(i) * lat;
          o.y = waterY(i, side) + c * h;
          set4(o.aKkA, rowsAt[r] * data.spacing, c, row, h);
        });
      });
    }
    for (const [a, b] of runs(N, (i) => edges[i] === EDGE_CODES.void)) {
      voidB.strip(b - a + 1, 2, (r, c, o) => {
        const i = idx(a + r);
        const base = s.halfWidth[i] + s.offroad[i];
        const across = c === (side < 0 ? 1 : 0) ? -0.2 : VOID_W;
        const lat = side * (base + across);
        o.x = s.px[i] + hxAt(i) * lat; o.z = s.pz[i] + hzAt(i) * lat;
        o.y = pageY + 0.03;
        o.u = (a + r) * data.spacing / 8; o.v = lat / 8;
        set4(o.aKkA, across, VOID_W, 0, 0);
        set4(o.aKkB, side * hxAt(i), side * hzAt(i), 0, 0);
      });
    }
  }
  if (!waterB.empty) {
    const waterColor = theme.water || '#79b4d6';
    const waterMat = mats.paper(waterColor, { side: THREE.DoubleSide, overlay: mats.textures.waves, overlayColor: mix(waterColor, '#ffffff', 0.55), scroll: 0.08 });
    track.objects.water = add(waterB.build(), waterMat, 'water');
    const waveMat = mats.surface('wave', {
      c0: mix(waterColor, theme.paper, 0.5), c1: mix(waterColor, theme.paper, 0.22), c2: mix(waterColor, theme.ink, 0.12),
      c3: mix(waterColor, '#ffffff', 0.78),
    }, { side: THREE.DoubleSide });
    track.objects.waves = add(waveB.build(), waveMat, 'waves');
  }
  if (!voidB.empty) {
    const sun = new THREE.Vector3(...theme.sun.dir).normalize();
    const voidMat = mats.surface('hole', {
      c0: theme.desk, c1: mix(theme.desk, theme.ink, 0.45), c2: SHEET, c3: mix(SHEET, theme.ink, 0.35),
      v0: [deskY, 0, 0, 0], v1: [sun.x, sun.y, sun.z, 0],
    }, { side: THREE.DoubleSide });
    track.objects.void = add(voidB.build(), voidMat, 'void');
    track.objects.void.renderOrder = -1;
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

  // --- boost pads: die-cut holographic foil stickers with printed arrows that run forward ----------
  const padB = new GeoBuilder({ aKkA: 4, aKkB: 4 });
  const padMargin = 0.5;
  for (const p of data.pads) {
    const len = p.d1 - p.d0;
    const rows = Math.ceil((len + 2 * padMargin) / 0.5) + 1;
    padB.strip(rows, 2, (r, c, o) => {
      const d = p.d0 - padMargin + (len + 2 * padMargin) * r / (rows - 1);
      const x = (c === 0 ? -1 : 1) * (p.halfWidth + padMargin);
      surfAt(((d % L) + L) % L / data.spacing, p.lateral + x, tp);
      o.x = tp.x; o.y = tp.y + 0.035; o.z = tp.z;
      o.u = c; o.v = r / (rows - 1);
      set4(o.aKkA, x, d - p.d0, p.halfWidth, len);
    });
  }
  if (!padB.empty) {
    const gold = mix(theme.accents?.[0] || '#f2c14e', '#fff3c8', 0.2);
    const padMat = mats.surface('foil', {
      c0: gold, c1: mix(theme.curbA, theme.ink, 0.25), c2: mix(SHEET, '#ffffff', 0.5), c3: mix(theme.road, theme.ink, 0.45),
      v0: [0.9, 0, 0, 0],
    });
    track.objects.boostPads = add(padB.build(), padMat, 'boostPads');
  } else {
    track.objects.boostPads = null;
  }

  // --- ramps: folded card with a printed chevron sticker; popup ramps unfold via setUnfold(0..1) ----
  const rampGroup = new THREE.Group();
  rampGroup.name = 'ramps';
  const accent = theme.accents?.[0] || '#f2c14e';
  const rampMat = mats.paper('#ffffff', {
    side: THREE.DoubleSide, vertexColors: true,
    plates: { map: mats.textures.rampSticker, colors: [mix(theme.curbA, theme.ink, 0.2), mix(SHEET, '#ffffff', 0.45), mix(accent, theme.ink, 0.4)] },
  });
  const rampCols = {
    plate: new THREE.Color(accent), edge: new THREE.Color(SHEET),
    side: mix(accent, theme.ink, 0.22), lip: mix(accent, theme.ink, 0.34),
  };
  for (const r of data.ramps) {
    const { mesh, setUnfold } = buildRamp(s, data, r, idx, rampMat, rampCols);
    rampGroup.add(mesh);
    track.rampMeshes.push({ ramp: r.def, object3d: mesh, setUnfold });
  }
  group.add(rampGroup);
  track.objects.ramps = rampGroup;

  // --- the page, the book block under it, the cover boards and the desk ----------------------------
  const pageGeo = new THREE.PlaneGeometry(pw, pd, 1, 1);
  pageGeo.rotateX(-Math.PI / 2);
  pageGeo.translate(cx, pageY, cz);
  worldUV(pageGeo, 32);
  const pageMat = mats.surface('page', { c0: theme.paper, v0: [0, 0, 0, gutterW], v1: gutterLine });
  const page = add(pageGeo, pageMat, 'page');
  const coverT = 0.7;
  const blockH = pageY - 0.06 - (deskY + coverT);
  const blockGeo = new THREE.BoxGeometry(pw, blockH, pd);
  blockGeo.translate(cx, deskY + coverT + blockH / 2, cz);
  boxWorldUV(blockGeo, 2, 8);
  const block = add(blockGeo, mats.paper(SHEET, { overlay: mats.textures.stack, overlayColor: mix(SHEET, theme.ink, 0.5) }), 'pageBlock', { receive: false });
  const coverGeo = new THREE.BoxGeometry(pw + 10, coverT, pd + 10);
  coverGeo.translate(cx, deskY + coverT / 2, cz);
  boxWorldUV(coverGeo, 3, 3);
  const cloth = mix(theme.curbA, theme.ink, 0.38);
  const cover = add(coverGeo, mats.paper(cloth, { overlay: mats.textures.hatch, overlayColor: mix(cloth, theme.ink, 0.3) }), 'cover', { receive: false });
  const deskGeo = new THREE.PlaneGeometry(4000, 4000, 1, 1);
  deskGeo.rotateX(-Math.PI / 2);
  deskGeo.translate(cx, deskY, cz);
  worldUV(deskGeo, 40);
  const desk = add(deskGeo, mats.paper(theme.desk, { overlay: mats.textures.wood, overlayColor: mix(theme.desk, theme.ink, 0.35) }), 'desk', { receive: false });
  const print = buildPagePrint(mats, def, { minX: cx - pw / 2, maxX: cx + pw / 2, minZ: cz - pd / 2, maxZ: cz + pd / 2, y: pageY, spineX: cx }, (x, z) => {
    let best = Infinity;
    for (let i = 0; i < N; i += 3) {
      const d = Math.hypot(x - s.px[i], z - s.pz[i]) - s.halfWidth[i] - s.offroad[i];
      if (d < best) best = d;
    }
    return best;
  });
  extraDispose.push(print.dispose);
  const ground = new THREE.Group();
  ground.name = 'ground';
  group.remove(page, block, cover, desk);
  // Drawn before the void, which paints its trench over the page (see surfaces.js HOLE).
  for (const m of [page, block, cover, desk]) m.renderOrder = -2;
  ground.add(page, block, cover, desk, print.mesh);
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
    for (const f of extraDispose) f();
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

// Side faces get u along the face (su metres per repeat) and v up the height (sv metres per repeat).
function boxWorldUV(geo, su, sv) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), az = Math.abs(n.getZ(i));
    if (ax > 0.5) uv.setXY(i, p.getZ(i) / su, p.getY(i) / sv);
    else if (az > 0.5) uv.setXY(i, p.getX(i) / su, p.getY(i) / sv);
    else uv.setXY(i, p.getX(i) / su, p.getZ(i) / su);
  }
  uv.needsUpdate = true;
}

function buildArch(s, i, theme, mats) {
  const hw = s.halfWidth[i];
  const h = Math.atan2(s.tx[i], s.tz[i]);
  const span = 2 * hw + 3;
  // folded card: posts and beam are three-sided prisms, so each fold takes the light differently
  const post = new THREE.CylinderGeometry(0.62, 0.62, 6.2, 3, 1).rotateY(Math.PI / 6);
  const p1 = post.clone().translate(-span / 2, 3.1, 0);
  const p2 = post.clone().translate(span / 2, 3.1, 0);
  const beam = new THREE.CylinderGeometry(0.42, 0.42, span + 1.1, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI).translate(0, 6.05, 0);
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

// A card plate hinged at the ramp's start (the object's origin) on folded card supports. The top face
// follows the physics profile; the card's thickness shows below it. setUnfold(u) folds it flat about the
// hinge (u = 0 flat, 1 up, up to 1.25 for a spring overshoot); collision always stays full height.
function buildRamp(s, data, r, idx, mat, cols) {
  const sp = data.spacing;
  const i0 = Math.round(r.d0 / sp);
  const rows = Math.max(2, Math.round(r.length / sp) + 1);
  const o0 = new THREE.Vector3(s.px[idx(i0)], s.py[idx(i0)], s.pz[idx(i0)]);
  const h0 = s.heading[idx(i0)];
  const inv = new THREE.Matrix4().makeRotationY(-h0);
  const v = new THREE.Vector3();
  const T = 0.14, inset = 0.4;
  const b = new GeoBuilder({ color: 3 });
  const hgt = (row) => r.height * Math.min(1, (row * sp) / r.length);
  const at = (row, lat, y, o) => {
    const i = idx(i0 + row);
    v.set(s.px[i] + s.rx[i] * lat, s.py[i] + s.ry[i] * lat + y + 0.02, s.pz[i] + s.rz[i] * lat);
    v.sub(o0).applyMatrix4(inv);
    o.x = v.x; o.y = v.y; o.z = v.z;
  };
  const hwAt = (row) => s.halfWidth[idx(i0 + row)] * 0.98;
  const off = (o) => { o.u = -1; o.v = -1; }; // outside the clamped sticker: prints nothing
  // top plate (sticker UVs: u across, v up the ramp)
  b.strip(rows, 2, (row, c, o) => {
    at(row, (c === 0 ? -1 : 1) * hwAt(row), hgt(row), o);
    o.u = c; o.v = row / (rows - 1);
    setCol(o.color, cols.plate);
  });
  // the card's thickness along both sides
  for (const side of [-1, 1]) {
    b.strip(rows, 2, (row, c, o) => {
      at(row, side * hwAt(row), hgt(row) - (c === 0 ? T : 0), o);
      off(o); setCol(o.color, cols.edge);
    });
  }
  // folded supports under the plate
  for (const side of [-1, 1]) {
    b.strip(rows, 2, (row, c, o) => {
      at(row, side * (hwAt(row) - inset), c === 1 ? Math.max(0, hgt(row) - T) : 0, o);
      off(o); setCol(o.color, cols.side);
    });
  }
  // lip face, then the card's edge along its top
  const top = hgt(rows - 1);
  for (const [y0, y1, col] of [[0, top - T, cols.lip], [top - T, top, cols.edge]]) {
    b.strip(2, 2, (row, c, o) => {
      at(rows - 1, (c === 0 ? -1 : 1) * hwAt(rows - 1), row === 0 ? y0 : y1, o);
      off(o); setCol(o.color, col);
    });
  }
  const mesh = new THREE.Mesh(b.build(), mat);
  mesh.name = `ramp:${r.index}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.copy(o0);
  mesh.rotation.order = 'YXZ';
  mesh.rotation.y = h0;
  const theta = Math.atan2(r.height, r.length);
  const setUnfold = (u) => {
    const k = Math.min(1.25, Math.max(0, u));
    mesh.rotation.x = theta * (1 - k);
  };
  mesh.userData.setUnfold = setUnfold;
  return { mesh, setUnfold };
}
