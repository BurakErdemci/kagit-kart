// TrackData queries (ARCHITECTURE.md §9.2). Everyone uses `query` — never re-implement nearest-point search.
import { Vector3 } from 'three';
import { EDGE_CODES, EDGE_NAMES, SURF_CODES, SURF_NAMES, wrapIndex } from './trackSampler.js';

// Public code tables for samples.edgeLeft/edgeRight and samples.surface. A surface sample packs
// both sides: left = code & 3, right = (code >> 2) & 3.
export { EDGE_CODES, EDGE_NAMES, SURF_CODES, SURF_NAMES };

const SURFACE_OUT = 'out';

function li(arr, i, j, f) {
  return arr[i] + (arr[j] - arr[i]) * f;
}

export function createQueryInfo() {
  return {
    index: 0, t: 0, dist: 0, lateral: 0, halfWidth: 0, offroadWidth: 0, onRoad: true,
    surface: 'road', groundY: 0, up: new Vector3(0, 1, 0), tangent: new Vector3(0, 0, 1), right: new Vector3(-1, 0, 0),
    edge: 'none',
    // extras
    edgeCode: 0, hasGround: true, waterY: -Infinity, rampId: -1, rampHeight: 0, onLip: false, padId: -1,
    centreY: 0, edgeY: 0, heading: 0, curvature: 0,
  };
}

export function attachQueries(track, data, grid, cfg) {
  const s = data.samples;
  const N = data.sampleCount;
  const L = data.length;
  const sp = data.spacing;
  const pageY = track.pageY;

  function nearestLocal(x, y, z, hint) {
    let i = hint;
    let best = d2At(i, x, y, z);
    for (let iter = 0; iter < 64; iter++) {
      const a = wrapIndex(i - 1, N), b = wrapIndex(i + 1, N);
      const da = d2At(a, x, y, z), db = d2At(b, x, y, z);
      if (da < best && da <= db) { best = da; i = a; }
      else if (db < best) { best = db; i = b; }
      else break;
    }
    return i;
  }

  function d2At(i, x, y, z) {
    const dx = s.px[i] - x, dz = s.pz[i] - z, dy = (s.py[i] - y) * 2;
    return dx * dx + dz * dz + dy * dy;
  }

  function nearestGrid(x, y, z) {
    const cx = Math.floor(x / grid.cellSize), cz = Math.floor(z / grid.cellSize);
    const list = grid.cells.get(grid.key(cx, cz));
    let best = -1, bd = Infinity;
    if (list) {
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        const d = d2At(i, x, y, z);
        if (d < bd) { bd = d; best = i; }
      }
    }
    if (best < 0) {
      for (let i = 0; i < N; i += 4) {
        const d = d2At(i, x, y, z);
        if (d < bd) { bd = d; best = i; }
      }
      best = nearestLocal(x, y, z, best);
    }
    return best;
  }

  const rampTmp = { id: -1, h: 0 };

  function rampHeightAt(dist, i) {
    rampTmp.id = -1; rampTmp.h = 0;
    const id = s.rampId[i];
    if (id < 0) return rampTmp;
    const r = data.ramps[id];
    let dd = dist - r.d0;
    if (dd < -L / 2) dd += L;
    if (dd > L / 2) dd -= L;
    if (dd < 0 || dd > r.length) return rampTmp;
    rampTmp.id = id;
    rampTmp.h = r.height * (dd / r.length);
    return rampTmp;
  }

  let warnedNoOut = false;

  function query(pos, hintIndex = -1, out) {
    if (!out) {
      if (!warnedNoOut) {
        warnedNoOut = true;
        console.warn('[trackQuery] query() without an out object allocates; pass a reused createQueryInfo() in per-step code');
      }
      out = createQueryInfo();
    }
    const x = pos.x, y = pos.y, z = pos.z;
    let i;
    if (hintIndex >= 0 && hintIndex < N) {
      i = nearestLocal(x, y, z, hintIndex);
      const lim = s.halfWidth[i] + s.offroad[i] + 40;
      if (d2At(i, x, y, z) > lim * lim) i = nearestGrid(x, y, z);
    } else {
      i = nearestGrid(x, y, z);
    }

    // Project onto the segment towards the side the point lies on.
    const px = x - s.px[i], pz = z - s.pz[i];
    let along = px * s.tx[i] + pz * s.tz[i];
    const th = Math.hypot(s.tx[i], s.tz[i]) || 1;
    along /= th;
    let j, f;
    if (along >= 0) { j = wrapIndex(i + 1, N); f = Math.min(1, along / sp); }
    else { j = wrapIndex(i - 1, N); f = Math.min(1, -along / sp); }

    const hx = li(s.hx, i, j, f), hz = li(s.hz, i, j, f);
    const hl = Math.hypot(hx, hz) || 1;
    const cy = li(s.py, i, j, f);
    const cxp = li(s.px, i, j, f), czp = li(s.pz, i, j, f);
    const lateral = ((x - cxp) * hx + (z - czp) * hz) / hl;
    const hw = li(s.halfWidth, i, j, f);
    const orw = li(s.offroad, i, j, f);
    const slope = li(s.slopeRight, i, j, f);

    let dist = s.dist[i] + along;
    if (dist < 0) dist += L;
    if (dist >= L) dist -= L;

    const right = lateral >= 0;
    const edgeCode = right ? s.edgeRight[i] : s.edgeLeft[i];
    const abs = Math.abs(lateral);
    const onRoad = abs <= hw;
    const inBand = abs <= hw + orw;
    const edgeY = cy + (right ? hw : -hw) * slope;

    out.index = i;
    out.dist = dist;
    out.t = dist / L;
    out.lateral = lateral;
    out.halfWidth = hw;
    out.offroadWidth = orw;
    out.onRoad = onRoad;
    out.edgeCode = edgeCode;
    out.edge = EDGE_NAMES[edgeCode];
    out.centreY = cy;
    out.edgeY = edgeY;
    out.heading = s.heading[i];
    out.curvature = s.curvature[i];
    out.onLip = s.rampLip[i] === 1;
    out.padId = -1;
    out.rampId = -1;
    out.rampHeight = 0;
    out.waterY = -Infinity;
    out.hasGround = true;

    out.tangent.set(li(s.tx, i, j, f), li(s.ty, i, j, f), li(s.tz, i, j, f)).normalize();

    if (onRoad) {
      const code = s.surface[i];
      const sc = right ? (code >> 2) & 3 : code & 3;
      out.surface = SURF_NAMES[sc];
      out.groundY = cy + lateral * slope;
      const ramp = rampHeightAt(dist, i);
      if (ramp.id >= 0) { out.rampId = ramp.id; out.rampHeight = ramp.h; out.groundY += ramp.h; }
      const pid = s.padId[i];
      if (pid >= 0) {
        const pad = data.pads[pid];
        if (Math.abs(lateral - pad.lateral) <= pad.halfWidth) { out.surface = 'boost'; out.padId = pid; }
      }
      out.up.set(li(s.ux, i, j, f), li(s.uy, i, j, f), li(s.uz, i, j, f)).normalize();
      out.right.set(li(s.rx, i, j, f), li(s.ry, i, j, f), li(s.rz, i, j, f)).normalize();
    } else {
      out.surface = inBand ? 'offroad' : SURFACE_OUT;
      out.groundY = edgeY;
      // unbanked frame beyond the road: flat carried height
      out.right.set(hx / hl, 0, hz / hl);
      out.up.crossVectors(out.right, out.tangent).normalize();
      // Beyond the band over void/water there is nothing to stand on: hasGround says so, while
      // groundY stays the edge height so code that places things never gets -Infinity.
      if (!inBand && (edgeCode === 2 || edgeCode === 3)) {
        out.hasGround = false;
        if (edgeCode === 3) out.waterY = Math.max(pageY + 0.05, edgeY - cfg.waterDrop);
      }
    }
    return out;
  }

  const tmpInfo = createQueryInfo();

  function sampleAt(t, out = {}) {
    let d = (t - Math.floor(t)) * L;
    const fi = d / sp;
    const i = Math.floor(fi) % N;
    const j = (i + 1) % N;
    const f = fi - Math.floor(fi);
    out.pos = out.pos || new Vector3();
    out.tangent = out.tangent || new Vector3();
    out.right = out.right || new Vector3();
    out.up = out.up || new Vector3();
    out.pos.set(li(s.px, i, j, f), li(s.py, i, j, f), li(s.pz, i, j, f));
    out.tangent.set(li(s.tx, i, j, f), li(s.ty, i, j, f), li(s.tz, i, j, f)).normalize();
    out.right.set(li(s.rx, i, j, f), li(s.ry, i, j, f), li(s.rz, i, j, f)).normalize();
    out.up.set(li(s.ux, i, j, f), li(s.uy, i, j, f), li(s.uz, i, j, f)).normalize();
    out.halfWidth = li(s.halfWidth, i, j, f);
    out.offroad = li(s.offroad, i, j, f);
    out.index = i;
    out.heading = Math.atan2(out.tangent.x, out.tangent.z);
    return out;
  }

  // Point on the surface at (t, lateral): used by grid slots, respawn, teleport and item rows.
  function pointAt(t, lateral, out = {}) {
    sampleAt(t, out);
    out.pos.addScaledVector(out.right, lateral);
    const q = query(out.pos, out.index, tmpInfo);
    if (q.hasGround) out.pos.y = q.groundY;
    return out;
  }

  function gridSlots(n) {
    const slots = [];
    const startD = data.startDist;
    const lat = Math.min(3.2, s.halfWidth[data.startIndex] * 0.35);
    for (let k = 0; k < n; k++) {
      const row = Math.floor(k / 2), col = k % 2;
      const back = 5 + row * 6 + col * 3;
      const t = ((startD - back) / L + 1) % 1;
      const p = pointAt(t, col === 0 ? -lat : lat, {});
      slots.push({ pos: p.pos.clone(), heading: p.heading, t });
    }
    return slots;
  }

  track.query = query;
  track.sampleAt = sampleAt;
  track.pointAt = pointAt;
  track.gridSlots = gridSlots;
  track.createQueryInfo = createQueryInfo;
  return track;
}
