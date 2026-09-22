// Pure track math: centripetal Catmull–Rom sampling at ~1 m, per-sample attributes, spatial grid and
// the §9.1 layout checks. No three.js here so the numbers can also be checked outside the browser.

export const EDGE_CODES = { none: 0, wall: 1, void: 2, water: 3 };
export const EDGE_NAMES = ['none', 'wall', 'void', 'water'];
// surface code per sample = leftType | (rightType << 2)
export const SURF_CODES = { road: 0, ice: 1, sand: 2 };
export const SURF_NAMES = ['road', 'ice', 'sand'];

const DEG = Math.PI / 180;

function perPoint(value, n, fallback) {
  if (value == null) return new Array(n).fill(fallback);
  if (typeof value === 'number') return new Array(n).fill(value);
  if (value.length !== n) throw new Error(`per-point array length ${value.length} != points ${n}`);
  return value;
}

// Barry–Goldman evaluation of one centripetal Catmull–Rom segment P1→P2.
function crPoint(P0, P1, P2, P3, u, out) {
  const d01 = Math.pow(dist3(P0, P1), 0.5) || 1e-4;
  const d12 = Math.pow(dist3(P1, P2), 0.5) || 1e-4;
  const d23 = Math.pow(dist3(P2, P3), 0.5) || 1e-4;
  const t0 = 0, t1 = d01, t2 = t1 + d12, t3 = t2 + d23;
  const t = t1 + (t2 - t1) * u;
  for (let k = 0; k < 3; k++) {
    const a1 = ((t1 - t) * P0[k] + (t - t0) * P1[k]) / (t1 - t0);
    const a2 = ((t2 - t) * P1[k] + (t - t1) * P2[k]) / (t2 - t1);
    const a3 = ((t3 - t) * P2[k] + (t - t2) * P3[k]) / (t3 - t2);
    const b1 = ((t2 - t) * a1 + (t - t0) * a2) / (t2 - t0);
    const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
    out[k] = ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
  }
  return out;
}

function dist3(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function smooth(a, b, f) {
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

function inRangeT(t, from, to) {
  return from <= to ? t >= from && t <= to : t >= from || t <= to;
}

export function wrapIndex(i, n) {
  i %= n;
  return i < 0 ? i + n : i;
}

export function sampleTrack(def, cfg) {
  const pts = def.points;
  const n = pts.length;
  if (n < 4) throw new Error('track needs at least 4 points');
  const hwP = perPoint(def.halfWidth, n, 10);
  const orP = perPoint(def.offroad, n, 12);
  const bankP = perPoint(def.bank, n, 0);

  // Dense evaluation, carrying the control parameter c = segment + u for per-point values.
  const steps = cfg.denseSteps;
  const dense = new Float64Array(n * steps * 4);
  const tmp = [0, 0, 0];
  let m = 0;
  for (let i = 0; i < n; i++) {
    const P0 = pts[wrapIndex(i - 1, n)], P1 = pts[i], P2 = pts[wrapIndex(i + 1, n)], P3 = pts[wrapIndex(i + 2, n)];
    for (let k = 0; k < steps; k++) {
      crPoint(P0, P1, P2, P3, k / steps, tmp);
      dense[m * 4] = tmp[0]; dense[m * 4 + 1] = tmp[1]; dense[m * 4 + 2] = tmp[2]; dense[m * 4 + 3] = i + k / steps;
      m++;
    }
  }
  const cum = new Float64Array(m + 1);
  for (let j = 1; j <= m; j++) {
    const a = (j - 1) * 4, b = (j % m) * 4;
    const dx = dense[b] - dense[a], dy = dense[b + 1] - dense[a + 1], dz = dense[b + 2] - dense[a + 2];
    cum[j] = cum[j - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  const length = cum[m];
  const N = Math.max(8, Math.round(length / cfg.spacing));
  const spacing = length / N;

  const f32 = () => new Float32Array(N);
  const s = {
    px: f32(), py: f32(), pz: f32(), tx: f32(), ty: f32(), tz: f32(),
    rx: f32(), ry: f32(), rz: f32(), ux: f32(), uy: f32(), uz: f32(),
    halfWidth: f32(), offroad: f32(), dist: f32(),
    edgeLeft: new Uint8Array(N), edgeRight: new Uint8Array(N), surface: new Uint8Array(N), rampLip: new Uint8Array(N),
    // extras (core): horizontal right, bank, heading, signed curvature, pad and ramp ids
    hx: f32(), hz: f32(), bank: f32(), slopeRight: f32(), heading: f32(), curvature: f32(),
    padId: new Int16Array(N), rampId: new Int16Array(N),
  };
  const cParam = new Float64Array(N);

  let j = 0;
  for (let i = 0; i < N; i++) {
    const d = i * spacing;
    while (j < m - 1 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j];
    const f = seg > 0 ? (d - cum[j]) / seg : 0;
    const a = j * 4, b = ((j + 1) % m) * 4;
    s.px[i] = dense[a] + (dense[b] - dense[a]) * f;
    s.py[i] = dense[a + 1] + (dense[b + 1] - dense[a + 1]) * f;
    s.pz[i] = dense[a + 2] + (dense[b + 2] - dense[a + 2]) * f;
    let c1 = dense[b + 3];
    if (j + 1 >= m) c1 = n;
    cParam[i] = dense[a + 3] + (c1 - dense[a + 3]) * f;
    s.dist[i] = d;
  }

  for (let i = 0; i < N; i++) {
    const c = cParam[i];
    const k = Math.floor(c) % n, k2 = (k + 1) % n, fr = c - Math.floor(c);
    s.halfWidth[i] = smooth(hwP[k], hwP[k2], fr);
    s.offroad[i] = smooth(orP[k], orP[k2], fr);
    s.bank[i] = smooth(bankP[k], bankP[k2], fr) * DEG;
  }

  for (let i = 0; i < N; i++) {
    const a = wrapIndex(i - 1, N), b = wrapIndex(i + 1, N);
    let tx = s.px[b] - s.px[a], ty = s.py[b] - s.py[a], tz = s.pz[b] - s.pz[a];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    s.tx[i] = tx; s.ty[i] = ty; s.tz[i] = tz;
    const h = Math.atan2(tx, tz);
    s.heading[i] = h;
    const hx = -Math.cos(h), hz = Math.sin(h);
    s.hx[i] = hx; s.hz[i] = hz;
    // unbanked up u0 = rh × t
    let u0x = 0 * tz - hz * ty, u0y = hz * tx - hx * tz, u0z = hx * ty - 0 * tx;
    const ul = Math.hypot(u0x, u0y, u0z) || 1;
    u0x /= ul; u0y /= ul; u0z /= ul;
    const cb = Math.cos(s.bank[i]), sb = Math.sin(s.bank[i]);
    // positive bank raises the right edge: r = rh cosθ + u0 sinθ
    const rx = hx * cb + u0x * sb, ry = u0y * sb, rz = hz * cb + u0z * sb;
    s.rx[i] = rx; s.ry[i] = ry; s.rz[i] = rz;
    s.slopeRight[i] = ry / (Math.hypot(rx, rz) || 1);
    // up = r × t
    let ux = ry * tz - rz * ty, uy = rz * tx - rx * tz, uz = rx * ty - ry * tx;
    const ul2 = Math.hypot(ux, uy, uz) || 1;
    s.ux[i] = ux / ul2; s.uy[i] = uy / ul2; s.uz[i] = uz / ul2;
  }

  // Signed horizontal curvature (rad/m, + = turning left), smoothed over ±3 m.
  const raw = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = wrapIndex(i - 1, N), b = wrapIndex(i + 1, N);
    let dh = s.heading[b] - s.heading[a];
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    raw[i] = dh / (2 * spacing);
  }
  const W = Math.max(1, Math.round(3 / spacing));
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let k = -W; k <= W; k++) acc += raw[wrapIndex(i + k, N)];
    s.curvature[i] = acc / (2 * W + 1);
  }

  // Edges and surfaces by t (fraction from sample 0 = points[0]).
  for (const e of def.edges || []) {
    const code = EDGE_CODES[e.type] ?? 0;
    for (let i = 0; i < N; i++) {
      if (!inRangeT(i / N, e.from, e.to)) continue;
      if (e.side === 'left' || e.side === 'both') s.edgeLeft[i] = code;
      if (e.side === 'right' || e.side === 'both') s.edgeRight[i] = code;
    }
  }
  for (const e of def.surfaces || []) {
    const code = SURF_CODES[e.type] ?? 0;
    for (let i = 0; i < N; i++) {
      if (!inRangeT(i / N, e.from, e.to)) continue;
      let l = s.surface[i] & 3, r = (s.surface[i] >> 2) & 3;
      if (e.side === 'left' || e.side === 'both' || !e.side) l = code;
      if (e.side === 'right' || e.side === 'both' || !e.side) r = code;
      s.surface[i] = l | (r << 2);
    }
  }

  s.padId.fill(-1);
  const pads = (def.boostPads || []).map((p, k) => {
    const d = p.t * length;
    const half = cfg.padLength / 2;
    for (let i = 0; i < N; i++) {
      let dd = s.dist[i] - d;
      dd -= Math.round(dd / length) * length;
      if (Math.abs(dd) <= half) s.padId[i] = k;
    }
    return { index: k, t: p.t, lateral: p.lateral, d0: d - half, d1: d + half, halfWidth: cfg.padWidth / 2 };
  });

  s.rampId.fill(-1);
  const ramps = (def.ramps || []).map((r, k) => {
    const len = r.length ?? 14;
    const d0 = r.t * length, d1 = d0 + len;
    for (let i = 0; i < N; i++) {
      let dd = s.dist[i] - d0;
      if (dd < 0) dd += length;
      if (dd >= 0 && dd <= len) s.rampId[i] = k;
      let dl = s.dist[i] - d1;
      dl -= Math.round(dl / length) * length;
      if (dl >= -1.01 && dl <= 1.01) s.rampLip[i] = 1;
    }
    return { index: k, def: r, t: r.t, d0, d1, length: len, height: r.height ?? 2.5, trick: r.trick !== false, popup: !!r.popup };
  });

  let minY = Infinity, maxY = -Infinity;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < N; i++) {
    const ext = s.halfWidth[i] + s.offroad[i];
    minY = Math.min(minY, s.py[i]); maxY = Math.max(maxY, s.py[i]);
    minX = Math.min(minX, s.px[i] - ext); maxX = Math.max(maxX, s.px[i] + ext);
    minZ = Math.min(minZ, s.pz[i] - ext); maxZ = Math.max(maxZ, s.pz[i] + ext);
  }

  const startIndex = wrapIndex(Math.round((def.startT || 0) * N), N);

  return {
    length, sampleCount: N, spacing, samples: s, pads, ramps, startIndex,
    startDist: startIndex * spacing,
    minY, maxY, bounds2d: { minX, maxX, minZ, maxZ },
  };
}

// Spatial grid: cell → sample indices whose drivable area (plus margin) overlaps the cell.
export function buildGrid(data, cellSize) {
  const s = data.samples;
  const cells = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  for (let i = 0; i < data.sampleCount; i++) {
    const r = s.halfWidth[i] + s.offroad[i] + 6;
    const x0 = Math.floor((s.px[i] - r) / cellSize), x1 = Math.floor((s.px[i] + r) / cellSize);
    const z0 = Math.floor((s.pz[i] - r) / cellSize), z1 = Math.floor((s.pz[i] + r) / cellSize);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = key(cx, cz);
        let list = cells.get(k);
        if (!list) { list = []; cells.set(k, list); }
        list.push(i);
      }
    }
  }
  return { cellSize, cells, key };
}

// §9.1 layout rules. Returns human-readable warnings; trackBuilder prints them with console.warn.
export function analyzeLayout(data, def, cfg) {
  const L = cfg.layout;
  const s = data.samples;
  const N = data.sampleCount;
  const sp = data.spacing;
  const out = [];
  const at = (i) => `t=${(i / N).toFixed(3)}`;

  if (data.length < L.lapMin || data.length > L.lapMax) {
    out.push(`lap length ${data.length.toFixed(0)} m outside ${L.lapMin}–${L.lapMax} m`);
  }

  // Minimum radius.
  let worst = -1, worstRatio = Infinity;
  for (let i = 0; i < N; i++) {
    const need = s.halfWidth[i] + s.offroad[i] + L.radiusMargin;
    const k = Math.abs(s.curvature[i]);
    if (k <= 0) continue;
    const ratio = (1 / k) / need;
    if (ratio < worstRatio) { worstRatio = ratio; worst = i; }
  }
  if (worst >= 0 && worstRatio < 1) {
    const need = s.halfWidth[worst] + s.offroad[worst] + L.radiusMargin;
    out.push(`centreline radius ${(1 / Math.abs(s.curvature[worst])).toFixed(1)} m < ${need.toFixed(1)} m at ${at(worst)}`);
  }

  // Separation of non-consecutive road.
  let sepHits = 0, sepFirst = null;
  const stride = Math.max(1, Math.round(2 / sp));
  for (let i = 0; i < N; i += stride) {
    const reqI = s.halfWidth[i] + s.offroad[i];
    for (let j = i + stride; j < N; j += stride) {
      const req = reqI + s.halfWidth[j] + s.offroad[j] + L.separationExtra;
      let arc = Math.abs(s.dist[j] - s.dist[i]);
      arc = Math.min(arc, data.length - arc);
      if (arc < L.separationArcFactor * req) continue;
      const dx = s.px[j] - s.px[i], dz = s.pz[j] - s.pz[i];
      const d2 = dx * dx + dz * dz;
      if (d2 >= req * req) continue;
      if (Math.abs(s.py[j] - s.py[i]) >= L.separationHeight) continue;
      sepHits++;
      if (!sepFirst) sepFirst = { i, j, d: Math.sqrt(d2), req };
    }
  }
  if (sepFirst) {
    out.push(`road sections ${at(sepFirst.i)} and ${at(sepFirst.j)} only ${sepFirst.d.toFixed(1)} m apart (need ${sepFirst.req.toFixed(1)} m; ${sepHits} close pairs)`);
  }

  // Corners.
  const corners = findCorners(data, L.cornerRadius);
  const t3 = corners.filter((c) => c.arc >= L.tier3Arc);
  const t2 = corners.filter((c) => c.arc >= L.tier2Arc && c.arc < L.tier3Arc);
  if (t3.length < L.tier3Min) out.push(`${t3.length} corners with ≥ ${L.tier3Arc} m arc (need ≥ ${L.tier3Min})`);
  if (t2.length < L.tier2Min || t2.length > L.tier2Max) {
    out.push(`${t2.length} tier-2 corners (${L.tier2Arc}–${L.tier3Arc} m arc), need ${L.tier2Min}–${L.tier2Max}`);
  }

  // Straight after every ramp.
  for (const r of data.ramps) {
    const iLip = wrapIndex(Math.round(r.d1 / sp), N);
    const h0 = s.heading[iLip];
    const steps = Math.round(L.rampStraight / sp);
    for (let k = 0; k <= steps; k++) {
      const i = wrapIndex(iLip + k, N);
      let dh = s.heading[i] - h0;
      dh = Math.abs(Math.atan2(Math.sin(dh), Math.cos(dh)));
      if (dh > L.rampStraightAngle) {
        out.push(`ramp ${r.index} (t=${r.t}): road turns ${(dh * 180 / Math.PI).toFixed(0)}° within ${k * sp | 0} m of the lip (need ${L.rampStraight} m within ±15°)`);
        break;
      }
    }
  }

  // Rocket shortcut.
  const shortcuts = findShortcuts(data, L);
  if (shortcuts.length === 0) out.push(`no rocket shortcut (${L.shortcutMin}–${L.shortcutMax} m of offroad saving ≥ ${L.shortcutSaving} m)`);

  // Widths.
  for (let i = 0; i < N; i++) {
    if (s.halfWidth[i] < L.halfWidthMin - 1e-3 || s.halfWidth[i] > L.halfWidthMax + 1e-3) {
      out.push(`halfWidth ${s.halfWidth[i].toFixed(1)} at ${at(i)} outside ${L.halfWidthMin}–${L.halfWidthMax}`);
      break;
    }
  }

  // Item rows and pads.
  for (const row of def.itemRows || []) {
    const i = wrapIndex(Math.round(row.t * N), N);
    const want = s.halfWidth[i] >= 10 ? 5 : 4;
    if (row.count !== want) out.push(`item row t=${row.t} has ${row.count} boxes, want ${want} (halfWidth ${s.halfWidth[i].toFixed(1)})`);
  }
  for (const p of data.pads) {
    const i = wrapIndex(Math.round(p.t * N), N);
    if (Math.abs(p.lateral) + p.halfWidth > s.halfWidth[i] + 1e-3) out.push(`boost pad t=${p.t} sticks out of the road`);
  }

  const fog = def.theme?.fog;
  if (fog && fog.far < L.fogFarMin) out.push(`fog.far ${fog.far} < ${L.fogFarMin}`);

  return { warnings: out, corners, tier3: t3.length, tier2: t2.length, shortcuts };
}

export function findCorners(data, cornerRadius) {
  const s = data.samples;
  const N = data.sampleCount;
  const kMin = 1 / cornerRadius;
  const dir = new Int8Array(N);
  for (let i = 0; i < N; i++) dir[i] = s.curvature[i] >= kMin ? 1 : s.curvature[i] <= -kMin ? -1 : 0;
  // Start scanning at a non-corner sample so a corner spanning index 0 is not split.
  let start = 0;
  while (start < N && dir[start] !== 0) start++;
  if (start === N) return [{ from: 0, to: N - 1, arc: data.length, dir: dir[0], turn: 2 * Math.PI }];
  const corners = [];
  let cur = null;
  for (let k = 1; k <= N; k++) {
    const i = (start + k) % N;
    if (dir[i] !== 0 && cur && cur.dir === dir[i]) {
      cur.to = i; cur.count++; cur.turn += s.curvature[i] * data.spacing;
    } else {
      if (cur) corners.push(cur);
      cur = dir[i] !== 0 ? { from: i, to: i, count: 1, dir: dir[i], turn: s.curvature[i] * data.spacing } : null;
    }
  }
  if (cur) corners.push(cur);
  for (const c of corners) {
    c.arc = c.count * data.spacing;
    c.t = c.from / N;
    c.turnDeg = Math.abs(c.turn) * 180 / Math.PI;
  }
  return corners;
}

export function findShortcuts(data, L) {
  const s = data.samples;
  const N = data.sampleCount;
  const sp = data.spacing;
  const stride = Math.max(1, Math.round(3 / sp));
  const found = [];
  for (let i = 0; i < N; i += stride) {
    for (let j = 0; j < N; j += stride) {
      let arc = s.dist[j] - s.dist[i];
      if (arc < 0) arc += data.length;
      if (arc < 60 || arc > data.length / 2) continue;
      const dx = s.px[j] - s.px[i], dz = s.pz[j] - s.pz[i];
      const d = Math.hypot(dx, dz);
      if (Math.abs(s.py[j] - s.py[i]) > 1.5) continue;
      const gap = d - s.halfWidth[i] - s.halfWidth[j];
      if (gap < L.shortcutMin || gap > L.shortcutMax) continue;
      if (arc - d < L.shortcutSaving) continue;
      // The facing edges must be open (no wall, no void, no water).
      const sideI = dx * s.hx[i] + dz * s.hz[i] >= 0 ? s.edgeRight[i] : s.edgeLeft[i];
      const sideJ = -dx * s.hx[j] - dz * s.hz[j] >= 0 ? s.edgeRight[j] : s.edgeLeft[j];
      if (sideI !== 0 || sideJ !== 0) continue;
      if (found.some((f) => Math.abs(f.i - i) < 40 || Math.abs(f.j - j) < 40)) continue;
      found.push({ i, j, t0: i / N, t1: j / N, gap, saving: arc - d });
    }
  }
  return found;
}
