// Track authoring helper: a turtle path (straights + constant-radius arcs + height keys)
// turned into Catmull–Rom control points, plus a sampler that mirrors how trackBuilder
// resamples the closed centripetal curve (three.js CatmullRomCurve3 math, dense steps
// per control segment, then ~1 m arc-length spacing). Defs use it to turn named marks
// into lap fractions `t`, so edits to the layout never leave pads or edges behind.

const DENSE_STEPS = 48;

// ---------------------------------------------------------------- Catmull–Rom

function nonuniform(x0, x1, x2, x3, dt0, dt1, dt2, w) {
  let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
  let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
  t1 *= dt1; t2 *= dt1;
  const c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2;
  const c3 = 2 * x1 - 2 * x2 + t1 + t2;
  return x1 + t1 * w + c2 * w * w + c3 * w * w * w;
}

function d4(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.pow(dx * dx + dy * dy + dz * dz, 0.25);
}

// Point on the closed centripetal curve, segment i (points[i] → points[i+1]), weight w.
export function curvePoint(points, i, w, out) {
  const n = points.length;
  const p0 = points[(i - 1 + n) % n], p1 = points[i % n], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
  let dt0 = d4(p0, p1), dt1 = d4(p1, p2), dt2 = d4(p2, p3);
  if (dt1 < 1e-4) dt1 = 1.0;
  if (dt0 < 1e-4) dt0 = dt1;
  if (dt2 < 1e-4) dt2 = dt1;
  out[0] = nonuniform(p0[0], p1[0], p2[0], p3[0], dt0, dt1, dt2, w);
  out[1] = nonuniform(p0[1], p1[1], p2[1], p3[1], dt0, dt1, dt2, w);
  out[2] = nonuniform(p0[2], p1[2], p2[2], p3[2], dt0, dt1, dt2, w);
  return out;
}

function perPoint(v, i, n) {
  if (Array.isArray(v)) return v[((i % n) + n) % n];
  return v;
}

// Resample a closed def curve at ~`spacing` m. Returns plain typed arrays shaped like
// TrackData.samples (px..dist, halfWidth, offroad) plus bank (degrees).
export function sampleDef(def, spacing = 1) {
  const pts = def.points;
  const n = pts.length;
  const total = n * DENSE_STEPS;
  const dx = new Float64Array(total + 1), dy = new Float64Array(total + 1), dz = new Float64Array(total + 1);
  const dhw = new Float64Array(total + 1), doff = new Float64Array(total + 1), dbank = new Float64Array(total + 1);
  const cum = new Float64Array(total + 1);
  const p = [0, 0, 0];
  for (let k = 0; k <= total; k++) {
    const i = Math.min(Math.floor(k / DENSE_STEPS), n - 1);
    const w = k === total ? 1 : (k - i * DENSE_STEPS) / DENSE_STEPS;
    curvePoint(pts, i, w, p);
    dx[k] = p[0]; dy[k] = p[1]; dz[k] = p[2];
    // Per-point values ease between control points with smoothstep, as trackSampler does.
    const a = i, b = (i + 1) % n, e = w * w * (3 - 2 * w);
    dhw[k] = perPoint(def.halfWidth, a, n) * (1 - e) + perPoint(def.halfWidth, b, n) * e;
    doff[k] = perPoint(def.offroad, a, n) * (1 - e) + perPoint(def.offroad, b, n) * e;
    const bk = def.bank == null ? 0 : def.bank;
    dbank[k] = perPoint(bk, a, n) * (1 - e) + perPoint(bk, b, n) * e;
    if (k > 0) {
      const ex = dx[k] - dx[k - 1], ey = dy[k] - dy[k - 1], ez = dz[k] - dz[k - 1];
      cum[k] = cum[k - 1] + Math.sqrt(ex * ex + ey * ey + ez * ez);
    }
  }
  const length = cum[total];
  const count = Math.max(8, Math.round(length / spacing));
  const step = length / count;
  const S = {
    length, count, spacing: step,
    px: new Float32Array(count), py: new Float32Array(count), pz: new Float32Array(count),
    tx: new Float32Array(count), ty: new Float32Array(count), tz: new Float32Array(count),
    rx: new Float32Array(count), ry: new Float32Array(count), rz: new Float32Array(count),
    halfWidth: new Float32Array(count), offroad: new Float32Array(count),
    bank: new Float32Array(count), dist: new Float32Array(count),
  };
  let j = 0;
  for (let s = 0; s < count; s++) {
    const d = s * step;
    while (j < total - 1 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j];
    const f = seg > 1e-9 ? (d - cum[j]) / seg : 0;
    S.px[s] = dx[j] + (dx[j + 1] - dx[j]) * f;
    S.py[s] = dy[j] + (dy[j + 1] - dy[j]) * f;
    S.pz[s] = dz[j] + (dz[j + 1] - dz[j]) * f;
    S.halfWidth[s] = dhw[j] + (dhw[j + 1] - dhw[j]) * f;
    S.offroad[s] = doff[j] + (doff[j + 1] - doff[j]) * f;
    S.bank[s] = dbank[j] + (dbank[j + 1] - dbank[j]) * f;
    S.dist[s] = d;
  }
  for (let s = 0; s < count; s++) {
    const a = (s - 1 + count) % count, b = (s + 1) % count;
    let tx = S.px[b] - S.px[a], ty = S.py[b] - S.py[a], tz = S.pz[b] - S.pz[a];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    S.tx[s] = tx; S.ty[s] = ty; S.tz[s] = tz;
    // right = tangent × up, horizontal (ARCHITECTURE §4: right of heading h is (-cos h, 0, sin h))
    const hl = Math.hypot(tx, tz) || 1;
    S.rx[s] = -tz / hl; S.ry[s] = 0; S.rz[s] = tx / hl;
  }
  return S;
}

// Nearest sample index to (x, z) (and optionally y), brute force; authoring time only.
export function nearestSample(S, x, y, z, useY = false) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < S.count; i++) {
    const ex = S.px[i] - x, ez = S.pz[i] - z, ey = useY ? S.py[i] - y : 0;
    const d = ex * ex + ez * ez + ey * ey;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// ---------------------------------------------------------------- turtle layout

const DEG = Math.PI / 180;

function advance(state, kind, a, b) {
  // kind 'S': a = length. 'L'/'R': a = degrees, b = radius. Heading h: forward (sin h, cos h),
  // increasing h turns left.
  if (kind === 'S') {
    return { x: state.x + Math.sin(state.h) * a, z: state.z + Math.cos(state.h) * a, h: state.h, len: a };
  }
  const k = (kind === 'L' ? 1 : -1) / b;
  const len = a * DEG * b;
  const h1 = state.h + k * len;
  return {
    x: state.x + (Math.cos(state.h) - Math.cos(h1)) / k,
    z: state.z + (Math.sin(h1) - Math.sin(state.h)) / k,
    h: h1, len,
  };
}

function walk(start, heading, segs, lens) {
  let st = { x: start[0], z: start[2], h: heading };
  const out = [];
  let s = 0;
  segs.forEach((seg, i) => {
    const [kind] = seg;
    const nx = kind === 'S' ? advance(st, 'S', lens[i]) : advance(st, kind, seg[1], seg[2]);
    out.push({ kind, x0: st.x, z0: st.z, h0: st.h, s0: s, len: nx.len, seg });
    s += nx.len;
    st = { x: nx.x, z: nx.z, h: nx.h };
  });
  return { segs: out, end: st, length: s };
}

function posAt(seg, u) {
  // u metres into a walked segment
  const st = { x: seg.x0, z: seg.z0, h: seg.h0 };
  if (seg.kind === 'S') return advance(st, 'S', u);
  const r = seg.seg[2];
  return advance(st, seg.kind, (u / r) / DEG, r);
}

function smooth01(t) { return t * t * (3 - 2 * t); }

/**
 * layout({ start, heading, hw, off, blend, segs })
 * segs: ['S', length, opts] | ['L'|'R', degrees, radius, opts]
 * opts: { y: height at segment end, hw, off (sticky), bank (this segment only, degrees; + raises
 *         the right edge, i.e. banks a left turn), mark: name at start, end: name at end, adj: true (closure),
 *         marks: { name: metres into the segment } }
 */
// Catmull–Rom tightens a straight→arc junction by ~9 % of the radius over a few metres
// (measured: a 30.5 m hairpin reads 27.3–27.6 m at both ends; easement arcs did not help).
// Design tight arcs with that margin, or narrow the offroad at the corner's ends.

// Authoring aid: the raw turtle walk without closure (segment start poses + end error).
export function walkOpen(spec) {
  const segs = spec.segs;
  const lens = segs.map((s) => (s[0] === 'S' ? s[1] : 0));
  const w = walk(spec.start || [0, 0, 0], spec.heading || 0, segs, lens);
  const poly = [];
  for (const g of w.segs) {
    for (let u = 0; u <= g.len; u += 2) { const p = posAt(g, u); poly.push([p.x, p.z]); }
  }
  return { segs: w.segs.map((g) => ({ kind: g.kind, x: g.x0, z: g.z0, h: g.h0, len: g.len, s0: g.s0 })), end: w.end, poly, length: w.length };
}

export function layout(spec) {
  if (globalThis.__kkAuthoring) globalThis.__kkAuthoring.spec = spec;
  const { start = [0, 0, 0], heading = 0, blend = 30 } = spec;
  const segs = spec.segs;
  const turn = segs.reduce((a, s) => a + (s[0] === 'L' ? s[1] : s[0] === 'R' ? -s[1] : 0), 0);
  // ±360 for a plain loop, 0 for a figure-8 (one crossing, which needs ≥ 6 m of height between the decks).
  if (Math.abs(turn / 360 - Math.round(turn / 360)) > 1e-9) throw new Error(`layout: turning sums to ${turn}°, need a multiple of 360`);

  const lens = segs.map((s) => (s[0] === 'S' ? s[1] : 0));
  const adj = segs.map((s, i) => (s[0] === 'S' && s[2] && s[2].adj ? i : -1)).filter((i) => i >= 0);
  let w = walk(start, heading, segs, lens);
  if (adj.length === 2) {
    const ex = w.end.x - start[0], ez = w.end.z - start[2];
    const A = w.segs[adj[0]], B = w.segs[adj[1]];
    const ax = Math.sin(A.h0), az = Math.cos(A.h0), bx = Math.sin(B.h0), bz = Math.cos(B.h0);
    const det = ax * bz - az * bx;
    if (Math.abs(det) < 0.2) throw new Error('layout: adjustable straights are near parallel');
    const da = (-ex * bz + ez * bx) / det;
    const db = (-ax * ez + az * ex) / det;
    lens[adj[0]] += da; lens[adj[1]] += db;
    if (lens[adj[0]] < 10 || lens[adj[1]] < 10) {
      throw new Error(`layout: closure needs straights ${lens[adj[0]].toFixed(1)} / ${lens[adj[1]].toFixed(1)} m`);
    }
    w = walk(start, heading, segs, lens);
  }
  const closeErr = Math.hypot(w.end.x - start[0], w.end.z - start[2]);
  if (closeErr > 0.5) throw new Error(`layout: loop misses its start by ${closeErr.toFixed(2)} m`);

  const L = w.length;
  // Height keys at the start and every segment end with a `y`. Smoothstep between keys, so
  // every key is a local flat (crest, valley or terrace).
  const keys = [{ s: 0, y: start[1] }];
  const marks = {};
  const stepHw = [], stepOff = [], stepBank = [];
  let hw = spec.hw ?? 10, off = spec.off ?? 12;
  for (const seg of w.segs) {
    const o = seg.seg[seg.kind === 'S' ? 2 : 3] || {};
    if (o.hw != null) hw = o.hw;
    if (o.off != null) off = o.off;
    stepHw.push([seg.s0, seg.s0 + seg.len, hw]);
    stepOff.push([seg.s0, seg.s0 + seg.len, off]);
    stepBank.push([seg.s0, seg.s0 + seg.len, o.bank || 0]);
    if (o.mark) marks[o.mark] = seg.s0;
    if (o.end) marks[o.end] = seg.s0 + seg.len;
    if (o.marks) for (const k in o.marks) marks[k] = seg.s0 + o.marks[k];
    if (o.y != null) keys.push({ s: seg.s0 + seg.len, y: o.y });
  }
  if (Math.abs(keys[keys.length - 1].y - start[1]) > 1e-6 && keys[keys.length - 1].s >= L - 1e-6) {
    throw new Error('layout: last height key must return to the start height');
  }
  if (keys[keys.length - 1].s < L - 1e-6) keys.push({ s: L, y: start[1] });

  const heightAt = (s) => {
    for (let i = 1; i < keys.length; i++) {
      if (s <= keys[i].s) {
        const a = keys[i - 1], b = keys[i];
        const f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 1;
        return a.y + (b.y - a.y) * smooth01(Math.min(1, Math.max(0, f)));
      }
    }
    return start[1];
  };
  const stepAt = (steps, s) => {
    s = ((s % L) + L) % L;
    for (const [a, b, v] of steps) if (s >= a && s < b) return v;
    return steps[steps.length - 1][2];
  };
  const blended = (steps, s) => {
    let acc = 0, nn = 0;
    for (let d = -blend / 2; d <= blend / 2; d += 1) { acc += stepAt(steps, s + d); nn++; }
    return acc / nn;
  };

  // Control points: every segment boundary, ~20 m on straights, ≤ 10° / 12 m on arcs (curvature ripple between points grows with the angle).
  const points = [], halfWidth = [], offroad = [], bank = [], at = [];
  for (const seg of w.segs) {
    const step = seg.kind === 'S' ? 20 : Math.min(12, seg.seg[2] * 10 * DEG);
    const nStep = Math.max(seg.kind === 'S' ? 1 : 2, Math.round(seg.len / step));
    for (let k = 0; k < nStep; k++) {
      const u = (seg.len * k) / nStep;
      const pp = posAt(seg, u);
      const s = seg.s0 + u;
      points.push([+pp.x.toFixed(2), +heightAt(s).toFixed(2), +pp.z.toFixed(2)]);
      halfWidth.push(+blended(stepHw, s).toFixed(2));
      offroad.push(+blended(stepOff, s).toFixed(2));
      bank.push(+blended(stepBank, s).toFixed(2));
      at.push(s);
    }
  }

  const uniform = (arr) => arr.every((v) => v === arr[0]);
  const def = {
    points,
    halfWidth: uniform(halfWidth) ? halfWidth[0] : halfWidth,
    offroad: uniform(offroad) ? offroad[0] : offroad,
    bank: bank.every((v) => v === 0) ? null : bank,
  };
  const S = sampleDef(def, 1);

  // Turtle distance → curve fraction, via the sample nearest the turtle position.
  const tOfTurtle = (s) => {
    s = ((s % L) + L) % L;
    let seg = w.segs[w.segs.length - 1];
    for (const g of w.segs) if (s < g.s0 + g.len) { seg = g; break; }
    const pp = posAt(seg, s - seg.s0);
    const guess = Math.round((s / L) * S.count);
    let best = guess, bd = Infinity;
    for (let d = -60; d <= 60; d++) {
      const i = (((guess + d) % S.count) + S.count) % S.count;
      const ex = S.px[i] - pp.x, ez = S.pz[i] - pp.z;
      const dd = ex * ex + ez * ez;
      if (dd < bd) { bd = dd; best = i; }
    }
    return best / S.count;
  };
  const r4 = (v) => Math.round(v * 1e4) / 1e4;

  return {
    ...def,
    length: S.length,
    turtleLength: L,
    samples: S,
    // Lap fraction of a named mark, optionally shifted by `offset` metres along the lap.
    t(name, offset = 0) {
      if (!(name in marks)) throw new Error(`layout: unknown mark "${name}"`);
      const t = tOfTurtle(marks[name]) + offset / S.length;
      return r4(((t % 1) + 1) % 1);
    },
    // Lap fraction at a turtle distance in metres.
    tAt(s) { return r4(tOfTurtle(s)); },
    marks,
  };
}
