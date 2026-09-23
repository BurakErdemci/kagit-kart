// CPU drivers and the autopilot (ARCHITECTURE.md §10.1). Writes controls for every CPU kart and for the
// player's kart while it is on autopilot. All randomness comes from forks of game.rng.ai, one per driver,
// so a driver's choices do not shift when another driver rolls more dice. Nothing here allocates per step.
import { angleDiff, clamp, forwardOf, lerp } from '../core/math.js';

const fwd = { x: 0, y: 0, z: 0 };

// Personalities, fixed per roster id. Fields:
//  offset   spread of the personal line offset          usage    corner-speed usage shift
//  driftMin corner-turn threshold shift (deg) to drift   hold     item hold range (s)
//  tierHold s a drift is held past the exit for a tier   aim      eagerness to fire at karts
//  gumBack  eagerness to drop/trail gum behind           box      detour range factor for item boxes
//  draft    slipstream tuck factor                       mistake  mistake chance factor
//  bump     leans into karts alongside (bully)           save     keeps rocket/foil for catch-up
const STYLES = {
  tilki:   { name: 'aggressive',   offset: 0.8, usage: 0.02,  driftMin: 0,   tierHold: 0.80, hold: [0.5, 1.8], aim: 1.5, gumBack: 0.6, box: 1.0, draft: 1.3, mistake: 1.1, bump: 0.2, save: 0.3 },
  kurbaga: { name: 'drift-happy',  offset: 1.0, usage: 0.0,   driftMin: -14, tierHold: 1.10, hold: [0.8, 2.8], aim: 1.0, gumBack: 0.8, box: 1.0, draft: 0.8, mistake: 1.2, bump: 0,   save: 0.5 },
  penguen: { name: 'cautious',     offset: 0.6, usage: -0.03, driftMin: 8,   tierHold: 0.30, hold: [1.2, 3.5], aim: 0.8, gumBack: 1.4, box: 0.8, draft: 0.6, mistake: 0.6, bump: 0,   save: 0.7 },
  ayi:     { name: 'bully',        offset: 0.7, usage: 0.0,   driftMin: 4,   tierHold: 0.60, hold: [0.5, 2.5], aim: 1.3, gumBack: 0.7, box: 1.2, draft: 1.6, mistake: 1.0, bump: 1.0, save: 0.4 },
  kedi:    { name: 'item-hoarder', offset: 1.0, usage: 0.0,   driftMin: 0,   tierHold: 0.60, hold: [2.4, 4.0], aim: 1.0, gumBack: 1.2, box: 1.7, draft: 1.0, mistake: 1.0, bump: 0,   save: 0.9 },
  baykus:  { name: 'tactician',    offset: 0.4, usage: 0.02,  driftMin: -4,  tierHold: 0.90, hold: [0.8, 2.6], aim: 1.2, gumBack: 1.0, box: 1.1, draft: 1.1, mistake: 0.7, bump: 0,   save: 0.8 },
  tavsan:  { name: 'risky',        offset: 1.2, usage: 0.04,  driftMin: -8,  tierHold: 1.00, hold: [0.5, 1.6], aim: 1.2, gumBack: 0.6, box: 0.9, draft: 1.2, mistake: 1.4, bump: 0.3, save: 0.2 },
  ahtapot: { name: 'trapper',      offset: 0.9, usage: -0.01, driftMin: 2,   tierHold: 0.60, hold: [1.5, 4.0], aim: 0.9, gumBack: 1.7, box: 1.3, draft: 0.9, mistake: 1.0, bump: 0,   save: 0.6 },
};
const DEFAULT_STYLE = { name: 'plain', offset: 1.0, usage: 0, driftMin: 0, tierHold: 0.6, hold: [0.5, 4.0], aim: 1, gumBack: 1, box: 1, draft: 1, mistake: 1, bump: 0, save: 0.5 };

const SKILL_TIERS = [0.92, 0.92, 0.8, 0.8, 0.8, 0.68, 0.68];
const AUTOPILOT_SKILL = 0.92;
const START_WINDOWS = { perfect: [0.7, 0.95], good: [0.35, 0.6], none: [0, 0.25], burnout: [2.1, 2.8] };

const EDGE_VOID = 2, EDGE_WATER = 3;
const DEG = Math.PI / 180;
const CORNER_K = 1 / 130;       // |centreline curvature| that counts as cornering (mistake bookkeeping)
const CORNER_GAP = 12;          // m of straighter road that still joins two runs of the same sign
const LOOK_CORNER = 160;        // m: how far ahead a corner becomes "the next corner"
const CANDIDATE_TURN = 30 * DEG; // smaller kinks are not corners for the bookkeeping
const AIM_PLAYER_GAP = 6;       // s between two items one CPU aims at the player (§10.1)
const HOP_PRESS_STEER = 0.25;   // |steer| on the hop press: above the 0.2 deadzone, sets the drift direction
const HOP_AIR_STEER = 0.19;     // steer held the other way in the air: inside the deadzone, pre-loads steer-out
// A drift follows the racing line. It starts where the line, just after the hop lands, turns at least
// ENTRY_YAW × the driver's slowest drift yaw, and ends where the line turns less than RELEASE_YAW × it.
// Measured (tools/scenarios/ai.mjs --mode solo): drifting a wider line than the racing line to farm
// charge cost 2–10 s a lap, because at this grip every corner is flat out and path length decides.
const ENTRY_YAW = 0.85;
const RELEASE_YAW = 0.8;
const DRIFT_GAIN = 2.6;         // 1/s: heading error to yaw inside a drift
const LINE_Q_BACK = 0.6;        // share of the racing line's lateral a back-marker (skill 0.68) uses
const DRIFT_LINE = 0.9;         // share of the line's lateral a drift follows (a slightly wider apex)
// Throttle ceiling of a back-marker (skill 0.68); rivals (0.92) run flat out. Corners alone could not
// separate the tiers: best laps of 0.92 and 0.80 differed by 0.02–0.5 s (QA-1 #1). Items hand the back
// of the field ~4 rocket pens a race, so the gap has to be this wide for a 6 s+ CPU spread (measured:
// 0.965 → 5.0 s median, 0.95 → 6.1 s, 0.94 → 7.1 s over 72 races at 120 g).
const PACE_BACK = 0.94;
// m before a ramp where no drift may start or continue (was 45: it cut desk's tier-2 corner before the
// sticky-note ramp to tier 1)
const RAMP_CLEAR = 28;
const MODE_DRIVE = 0, MODE_HOP = 1, MODE_DRIFT = 2, MODE_SHORTCUT = 3;
// Aim points tried per crossing, nearest first: [m past the far end, m inside the far road's near edge].
// The first one the probe accepts is used: glacier's crossing needs a farther one than desk's, where a
// farther one runs into a phantom wall of the section the kart came from.
const SC_AIMS = [[14, 3], [25, 3], [40, 9]];
const SC_BRAKE_ERR = 0.6;       // rad off the far road's direction: once on the far section (never while
const SC_BRAKE_V = 12;          // 'out') and the rocket is spent, brake down to this m/s to finish the turn
// Arrivals a crossing is probed for: [speed × class top, m inside the entry edge]. Real CPUs arrive
// boosted (a trick or pad just before), wide or slow; probed only at class top, meadow's crossing failed
// in 26 of 49 race crossings.
const SC_ARRIVALS = [[1, 1.5], [1.3, 1.5], [1, 4], [1.3, 4], [0.85, 1.5]];
const SC_CHECK = 80;            // m past a shortcut's far end where crossing and road are compared
const SC_OUT_MAX = 1.6;         // s of continuous 'out' a crossing may cost (kart physics respawns at 2.0)
const SC_MIN_GAIN = 0.8;        // s a crossing must save over the road
// No crossings above this class top speed (m/s): at 200 g the rocket runs at 42 m/s, and crossings kept
// ending in the next corner (glacier) or across the far road (desk: 12 of 33 respawned).
const SC_MAX_TOP = 26;

export function createAI(game) {
  const track = game.track;
  const cfg = game.config;
  const K = cfg.kart;
  const s = track.samples;
  const N = track.sampleCount;
  const L = track.length;
  const sp = track.spacing;
  const px = s.px, pz = s.pz, hx = s.hx, hz = s.hz, hwA = s.halfWidth;
  const baseRng = game.rng.ai;
  const hopTime = 2 * K.hopVy / K.gravity;
  const YN = K.driftYawNeutral, YI = K.driftYawIn, YO = K.driftYawOut;
  const CI = K.driftChargeIn, CO = K.driftChargeOut;
  const TIERS = K.driftTiers;
  const rubberK = cfg.classes[game.cls]?.rubberK ?? 0.04;
  const YAW_HIGH = cfg.classes[game.cls]?.yawHigh ?? K.yawHigh; // what kart physics uses in this class
  const RB = cfg.rubberBand || { behindFrom: 20, max: 1.06, playerCap: 1.03, aheadFrom: 40, aheadMin: 0.985 };

  // Drift shape, overridable by tests through debug.tune (read live).
  const tune = { entryYaw: ENTRY_YAW, releaseYaw: RELEASE_YAW, driftLine: DRIFT_LINE, entryLead: 0, holdScale: 1, paceBack: PACE_BACK, forceShortcut: 0,
    scLead: 0, scAimIn: 0 };

  function idx(i) { return ((i % N) + N) % N; }
  // distance along the track from a to b in (−L/2, L/2]
  function along(a, b) {
    let d = b - a;
    if (d > L / 2) d -= L; else if (d <= -L / 2) d += L;
    return d;
  }
  function driftYaw(sd) { return sd >= 0 ? YN + (YI - YN) * sd : YN - (YN - YO) * -sd; }
  function driftRate(sd) { return sd >= 0 ? 1 + (CI - 1) * sd : 1 - (1 - CO) * -sd; }
  function steerForYaw(yaw) { return yaw >= YN ? (yaw - YN) / (YI - YN) : -(YN - yaw) / (YN - YO); }

  // ---------------------------------------------------------------------------------------
  // Precompute: racing line, its curvature, corners, zones.
  const lineLat = new Float32Array(N);
  const lineK = new Float32Array(N);        // signed curvature of the racing line, + = turning left
  const limL = new Float32Array(N);
  const limR = new Float32Array(N);
  const fade = new Float32Array(N);         // 0 where personal offsets vanish (pads, ramps)
  const noDrift = new Uint8Array(N);        // ramp approaches: never start or hold a drift here
  const trickLip = new Int16Array(N).fill(-1);
  const cum = new Float64Array(N + 1);      // cumulative signed centreline turn (rad), + = left
  const nextCorner = new Int16Array(N).fill(-1);
  const corners = [];
  buildLine();
  buildCorners();

  function turnBetween(i, j) { // signed centreline turn going forward from sample i to sample j
    return j >= i ? cum[j] - cum[i] : cum[N] - cum[i] + cum[j];
  }

  function buildLine() {
    for (let i = 0; i < N; i++) {
      const hw = hwA[i];
      const mL = s.edgeLeft[i] === EDGE_VOID || s.edgeLeft[i] === EDGE_WATER ? 3.0 : 2.2;
      const mR = s.edgeRight[i] === EDGE_VOID || s.edgeRight[i] === EDGE_WATER ? 3.0 : 2.2;
      limL[i] = -Math.max(0.5, hw - mL);
      limR[i] = Math.max(0.5, hw - mR);
      fade[i] = 1;
    }
    // Boost pads pin the line over the pad; ramps keep it near the centre so the lip is square.
    for (const p of track.pads || []) {
      const a = Math.floor(p.d0 / sp), b = Math.ceil(p.d1 / sp);
      for (let j = a - 18; j <= b + 2; j++) {
        const i = idx(j);
        fade[i] = 0;
        if (j < a - 4) continue;
        const lo = Math.max(limL[i], p.lateral - 1.0), hi = Math.min(limR[i], p.lateral + 1.0);
        if (lo <= hi) { limL[i] = lo; limR[i] = hi; }
      }
    }
    for (const r of track.ramps || []) {
      const a = Math.floor(r.d0 / sp), b = Math.ceil(r.d1 / sp);
      for (let j = a - 20; j <= b + 4; j++) {
        const i = idx(j);
        limL[i] = Math.max(limL[i], -3); limR[i] = Math.min(limR[i], 3);
        fade[i] = 0;
      }
      for (let j = a - Math.round(RAMP_CLEAR / sp); j <= b + 6; j++) noDrift[idx(j)] = 1;
      if (r.trick) for (let j = b - 40; j <= b; j++) trickLip[idx(j)] = r.index;
    }
    // offsets blend in over ~15 m
    const tmp = new Float32Array(N);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        let m = fade[i];
        for (let k = 1; k <= 15; k++) m = Math.min(m, fade[idx(i - k)] + k / 15, fade[idx(i + k)] + k / 15);
        tmp[i] = m;
      }
      fade.set(tmp);
    }

    // Relaxation towards the neighbours' midpoint at a shrinking stencil, clamped inside the road: wide
    // stencils smooth the line, the final narrow one pulls it taut towards the inside of each corner.
    const x = new Float64Array(N), z = new Float64Array(N), a = new Float64Array(N);
    for (const k of [16, 8, 4, 2]) {
      for (let it = 0; it < 90; it++) {
        for (let i = 0; i < N; i++) { x[i] = px[i] + hx[i] * a[i]; z[i] = pz[i] + hz[i] * a[i]; }
        for (let i = 0; i < N; i++) {
          const i0 = idx(i - k), i1 = idx(i + k);
          const mx = (x[i0] + x[i1]) * 0.5 - px[i], mz = (z[i0] + z[i1]) * 0.5 - pz[i];
          const want = mx * hx[i] + mz * hz[i];
          a[i] = clamp(a[i] + (want - a[i]) * 0.6, limL[i], limR[i]);
        }
      }
    }
    for (let i = 0; i < N; i++) lineLat[i] = a[i];

    // Signed curvature of the line (+ = turning left) over ±4 samples, smoothed over ±3.
    const W = 4;
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const i0 = idx(i - W), i1 = idx(i + W);
      const ax = px[i] + hx[i] * a[i] - (px[i0] + hx[i0] * a[i0]);
      const az = pz[i] + hz[i] * a[i] - (pz[i0] + hz[i0] * a[i0]);
      const bx = px[i1] + hx[i1] * a[i1] - (px[i] + hx[i] * a[i]);
      const bz = pz[i1] + hz[i1] * a[i1] - (pz[i] + hz[i] * a[i]);
      const dh = angleDiff(Math.atan2(bx, bz), Math.atan2(ax, az));
      raw[i] = dh / Math.max(1e-3, 0.5 * (Math.hypot(ax, az) + Math.hypot(bx, bz)));
    }
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let k = -3; k <= 3; k++) acc += raw[idx(i + k)];
      lineK[i] = acc / 7;
    }
  }

  // Corners (centreline runs of one turning sign, short straighter gaps merged) carry the per-corner
  // mistake roll. Each: { from, to, dir (+1 right), turn (rad, positive) }.
  function buildCorners() {
    const k = s.curvature;
    for (let i = 0; i < N; i++) cum[i + 1] = cum[i] + k[i] * sp;
    const dirAt = (i) => (k[i] >= CORNER_K ? 1 : k[i] <= -CORNER_K ? -1 : 0);
    let start = 0;
    while (start < N && dirAt(start) !== 0) start++;
    if (start >= N) start = 0;
    let cur = null, gap = 0;
    const gapN = Math.round(CORNER_GAP / sp);
    for (let n = 1; n <= N; n++) {
      const i = idx(start + n);
      const dd = dirAt(i);
      if (cur && (dd === cur.sign || (dd === 0 && gap < gapN && Math.sign(k[i]) !== -cur.sign))) {
        if (dd === cur.sign) { cur.to = start + n; gap = 0; } else gap++;
        continue;
      }
      if (cur) corners.push(cur);
      cur = null; gap = 0;
      if (dd !== 0) cur = { from: start + n, to: start + n, sign: dd };
    }
    if (cur) corners.push(cur);
    for (let c = 0; c < corners.length; c++) {
      const cr = corners[c];
      cr.index = c;
      cr.arc = (cr.to - cr.from + 1) * sp;
      cr.from = idx(cr.from);
      cr.to = idx(cr.to);
      cr.dir = -cr.sign;
      cr.turn = Math.abs(turnBetween(cr.from, cr.to));
    }
    // nextCorner[i]: the corner i lies in, else the first one starting within LOOK_CORNER m ahead.
    const look = Math.round(LOOK_CORNER / sp);
    for (let c = 0; c < corners.length; c++) {
      const cr = corners[c];
      if (cr.turn < CANDIDATE_TURN) continue;
      const len = (cr.to - cr.from + N) % N;
      for (let j = -look; j <= len; j++) {
        const i = idx(cr.from + j);
        const o = nextCorner[i] >= 0 ? corners[nextCorner[i]] : null;
        if (!o) { nextCorner[i] = c; continue; }
        const inO = ((i - o.from + N) % N) <= ((o.to - o.from + N) % N);
        const inC = j >= 0;
        if ((inC && !inO) || (!inC && !inO && ((cr.from - i + N) % N) < ((o.from - i + N) % N))) nextCorner[i] = c;
      }
    }
  }

  // Rocket-only shortcuts found by the track analysis (which checks only the facing edges at the two ends).
  // Entries sit before hairpins, so a crossing ends nearly square to the far road, and at rocket speed
  // normal steering (1 rad/s) needs a ~36 m radius: the AI aims at the near half of the far road, some way
  // down it, and once there (never while 'out') brakes until the nose is close to the road's direction.
  // (A drifted U-turn was tried: it keeps the kart by the hairpin apex, where the query never hands over.)
  // Each crossing is probed once by driving a point kart that way, with the query hint chained as kart
  // physics chains it: that query only hands the kart over to the far section some way down the far
  // road, and until then the kart counts as 'out' (35% cap once the rocket ends, respawn after 2 s).
  // Taken when, for every arrival in SC_ARRIVALS, the longest 'out' run stays under SC_OUT_MAX s and
  // nothing blocks the way (no ground, a wall line), and it beats the road (at a rival's corner speeds)
  // to a point SC_CHECK m past the far end by SC_MIN_GAIN s.
  const shortcuts = (track.analysis && track.analysis.shortcuts) || [];
  let refProf = null;
  const scInfo = shortcuts.map(probeAims);

  function refProfile(top) {
    if (refProf) return refProf;
    refProf = new Float32Array(N);
    for (let i = 0; i < N; i++) refProf[i] = cornerSpeed(Math.abs(lineK[i]) / 0.92, top, 1, 0.97);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = N - 1; i >= 0; i--) {
        const lim = Math.sqrt(refProf[i === N - 1 ? 0 : i + 1] ** 2 + 2 * 14 * sp);
        if (lim < refProf[i]) refProf[i] = lim;
      }
    }
    return refProf;
  }

  // A crossing must be safe for every arrival in SC_ARRIVALS; its time is the nominal (first) one.
  function probeAims(sc) {
    let first = null;
    for (const [lead, aimIn] of SC_AIMS) {
      let r = null;
      for (const [vf, inset] of SC_ARRIVALS) {
        const x = probeShortcut(sc, tune.scLead || lead, tune.scAimIn || aimIn, vf, inset);
        if (!r) r = x;
        else if (!x.ok) { r.ok = false; r.why = x.why + ' (arriving ' + vf + '× top, ' + inset + ' m in)'; }
        r.outT = Math.max(r.outT, x.outT);
        if (!r.ok) break;
      }
      if (r.ok || tune.scLead) return r;
      if (!first) first = r;
    }
    return first;
  }

  function probeShortcut(sc, lead, aimIn, vf, inset) {
    const dx = px[sc.j] - px[sc.i], dz = pz[sc.j] - pz[sc.i];
    const sideI = dx * hx[sc.i] + dz * hz[sc.i] >= 0 ? 1 : -1;
    const sideJ = -dx * hx[sc.j] - dz * hz[sc.j] >= 0 ? 1 : -1;
    const jc = idx(sc.j + Math.round(lead / sp));
    const farH = s.heading[jc];
    const res = { ok: false, sideI, jc, lead, aimLat: sideJ * Math.max(0, hwA[jc] - aimIn), why: '', outT: 0, t: 0, road: 0 };
    if (!track.createQueryInfo) { res.why = 'no query'; return res; }
    const top = cfg.classes[game.cls]?.top ?? 25;
    if (top > SC_MAX_TOP) { res.why = 'class too fast'; return res; }
    const rocket = K.boosts.rocket;
    const vBoost = top * (1 + K.boostTopGain * rocket[1]);
    const kAcc = Math.log(5) / K.accelTime;
    const q = track.createQueryInfo();
    const pt = { x: px[sc.i] + hx[sc.i] * sideI * (hwA[sc.i] - inset), y: s.py[sc.i], z: pz[sc.i] + hz[sc.i] * sideI * (hwA[sc.i] - inset) };
    const dtp = 1 / 60;
    const end = idx(sc.j + Math.round(SC_CHECK / sp));
    let h = s.heading[sc.i], v = top * vf, t = 0, run = 0, hint = sc.i, handed = -1, tgt = jc, tLat = res.aimLat, brakeT = 0;
    for (let n = 0; n < 10 / dtp; n++) {
      let tx = px[tgt] + hx[tgt] * tLat, tz = pz[tgt] + hz[tgt] * tLat;
      if (Math.hypot(tx - pt.x, tz - pt.z) < 10) { // past the aim point: keep to the far road's line
        tgt = idx(tgt + Math.round(10 / sp)); tLat = lineLat[tgt];
        tx = px[tgt] + hx[tgt] * tLat; tz = pz[tgt] + hz[tgt] * tLat;
      }
      const err = angleDiff(Math.atan2(tx - pt.x, tz - pt.z), h);
      h += clamp(err * 2.4, -1, 1) * lerp(K.yawLow, YAW_HIGH, clamp((v - K.yawLowSpeed) / Math.max(1, top - K.yawLowSpeed), 0, 1)) * dtp;
      pt.x += Math.sin(h) * v * dtp;
      pt.z += Math.cos(h) * v * dtp;
      track.query(pt, hint, q);
      hint = q.index;
      pt.y = q.groundY;
      if (!q.hasGround) { res.why = 'no ground'; return res; }
      if (q.edgeCode === 1 && Math.abs(q.lateral) > q.halfWidth + q.offroadWidth - K.wallInset) { res.why = 'wall'; return res; }
      const out = q.surface === 'out';
      const boosting = t < rocket[0];
      const alignErr = Math.abs(angleDiff(farH, h));
      const rel = along(s.dist[sc.j], q.dist);
      const onFar = rel > -60 && rel < 150;
      const braking = !boosting && !out && onFar && v > SC_BRAKE_V && alignErr > SC_BRAKE_ERR;
      brakeT = braking ? brakeT + dtp : 0;
      const cap = boosting ? vBoost : out ? top * K.outCap : q.onRoad ? top : top * K.offroadCap;
      if (braking) v = Math.max(0, v - (brakeT >= K.brakeDelay ? K.brakeDecel : K.softBrakeDecel) * dtp);
      else if (boosting) v = Math.min(cap, v + (top * K.boostTopGain / K.boostRampTime) * dtp);
      else if (v > cap) v = Math.max(cap, v - K.overCapDecel * dtp);
      else v += (cap - v) * (1 - Math.exp(-kAcc * dtp));
      t += dtp;
      run = out ? run + dtp : 0;
      if (run > res.outT) res.outT = run;
      if (handed < 0 && q.onRoad && onFar && alignErr < SC_BRAKE_ERR) handed = q.index;
      if (handed >= 0 && along(s.dist[end], q.dist) >= 0) break;
    }
    res.t = +t.toFixed(2);
    res.outT = +res.outT.toFixed(2);
    if (handed < 0) { res.why = 'never handed over'; return res; }
    let road = 0;
    const ref = refProfile(top);
    for (let i = sc.i; i !== end; i = idx(i + 1)) road += sp / Math.min(top, ref[i]);
    res.road = +road.toFixed(2);
    if (res.outT > SC_OUT_MAX) { res.why = 'out too long'; return res; }
    if (res.t + SC_MIN_GAIN > res.road) { res.why = 'no gain'; return res; }
    res.ok = true;
    return res;
  }

  // Highest corner-safe speed for |curvature| k with normal steering (yaw limit), times usage.
  function cornerSpeed(k, top, handling, usage) {
    if (k < 1e-4) return 1e3;
    const span = Math.max(1, top - K.yawLowSpeed);
    let v = handling * (K.yawLow + (K.yawLow - YAW_HIGH) * K.yawLowSpeed / span) / (k + handling * (K.yawLow - YAW_HIGH) / span);
    if (v > top) v = Math.max(top, handling * YAW_HIGH / k);
    return v * usage;
  }

  // ---------------------------------------------------------------------------------------
  // drivers
  const cpus = [];
  for (const k of game.karts) if (!k.isPlayer) cpus.push(k);
  const tierOrder = SKILL_TIERS.slice(0, cpus.length);
  while (tierOrder.length < cpus.length) tierOrder.push(0.8);
  baseRng.shuffle(tierOrder);

  let cpuSeen = 0;
  const drivers = game.karts.map((k) => {
    const rng = baseRng.fork('driver:' + k.id);
    // personalities are for CPUs; the autopilot stands in for the player whatever character is picked
    const style = (!k.isPlayer && STYLES[k.id]) || DEFAULT_STYLE;
    const skill = k.isPlayer ? AUTOPILOT_SKILL : tierOrder[cpuSeen++];
    const sn = clamp((skill - 0.68) / 0.24, 0, 1); // 0 back … 1 rival
    const gradeTable = k.isPlayer ? { perfect: 1 }
      : sn > 0.75 ? { perfect: 50, good: 35, none: 10, burnout: 5 }
        : sn > 0.25 ? { perfect: 35, good: 35, none: 20, burnout: 10 }
          : { perfect: 20, good: 35, none: 30, burnout: 15 };
    const w = START_WINDOWS[rng.weighted(gradeTable)];
    const usage = clamp(0.86 + 0.12 * sn + style.usage, 0.8, 1.0);
    const handling = 1 + K.statHandling * (k.stats.handling - 3);
    // Per-driver speed profile along the line: corner limit, then a backward braking pass.
    const prof = new Float32Array(N);
    const top = k.baseTop * 1.06;
    for (let i = 0; i < N; i++) prof[i] = cornerSpeed(Math.abs(lineK[i]) / 0.92, top, handling, usage);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = N - 1; i >= 0; i--) {
        const nx = prof[i === N - 1 ? 0 : i + 1];
        const lim = Math.sqrt(nx * nx + 2 * 14 * sp);
        if (lim < prof[i]) prof[i] = lim;
      }
    }
    // Drift technique by skill: a rival steers out fully (the slowest yaw, so it can follow gentler
    // arcs of the line and charge longer); a back-marker only drifts tighter ones.
    const sMin = lerp(-0.6, -1, sn);
    return {
      kart: k, rng, style, skill, sn, prof, handling,
      // Skill also sets how tightly the racing line is taken: a back-marker's line sits partway towards
      // the centreline, a longer path (every corner is flat out at 120 g, so path length is pace).
      lineQ: lerp(LINE_Q_BACK, 1, sn),
      startAt: rng.range(w[0], w[1]),
      offset: rng.range(-1.8, 1.8) * style.offset * (k.isPlayer ? 0.3 : 1),
      sMin,
      yawMin: driftYaw(sMin),
      driftMin: (lerp(58, 38, sn) + style.driftMin) * DEG,
      tierHold: style.tierHold * (0.4 + 0.6 * sn),
      mistakeP: clamp((0.04 + 0.11 * (1 - sn)) * style.mistake, 0.04, 0.15),
      reaction: lerp(0.55, 0.15, sn),
      launchP: lerp(0.55, 0.95, sn),
      trickP: lerp(0.6, 0.97, sn),
      // live state
      dyn: 0,                 // smoothed dynamic lateral shift (overtakes, hazards, boxes)
      mode: MODE_DRIVE,
      corner: -1, mistake: 0,
      hopDir: 0, driftT: 0, driftTurn: 0, lastH: 0, driftS: 0, earlyAt: 0.5, releaseAt: -9,
      stuckT: 0, reverseT: 0, reverseSteer: 0,
      inkNoise: 0, inkTarget: 0, inkT: 0,
      respawnRoll: -1,
      itemPlan: null, itemT: 0, holdFor: 0, nextTry: 0, heldFor: 0, backPref: false,
      lastAtPlayer: -99,
      threatUntil: -1, threatKind: null,
      shortcut: -1, scT: 0, scCommitted: false, scPast: false, scFired: false, trickPressed: 0,
      wdT: 0, wdAcc: 0, wdDist: -1,   // progress watchdog
      phase: 0,                       // stagger for the drift-entry checks
    };
  });
  const byKart = new Map();
  for (let i = 0; i < drivers.length; i++) { drivers[i].phase = i & 1; byKart.set(drivers[i].kart, drivers[i]); }

  const offThreat = game.events.on('threat', (e) => {
    const d = e && byKart.get(e.kart);
    if (!d) return;
    const until = game.raceTime + (e.eta || 0.5) + 0.25;
    if (until > d.threatUntil) { d.threatUntil = until; d.threatKind = e.kind; }
  });

  // hazard / box track coordinates, refreshed per step into fixed buffers
  const MAX_HAZ = 48;
  const hazD = new Float32Array(MAX_HAZ), hazLat = new Float32Array(MAX_HAZ), hazR = new Float32Array(MAX_HAZ);
  const hazHint = new Int32Array(MAX_HAZ).fill(-1);
  let hazN = 0;
  const MAX_BOX = 64;
  const boxD = new Float32Array(MAX_BOX), boxLat = new Float32Array(MAX_BOX);
  let boxN = -1;
  let boxesRef = null;
  const qi = track.createQueryInfo ? track.createQueryInfo() : null;

  function refreshWorld(items) {
    hazN = 0;
    const hzs = items && items.hazards;
    if (hzs && qi) {
      for (let h = 0; h < hzs.length && hazN < MAX_HAZ; h++) {
        const it = hzs[h];
        if (!it || !it.pos) continue;
        track.query(it.pos, hazHint[hazN], qi);
        hazHint[hazN] = qi.index;
        hazD[hazN] = qi.dist;
        hazLat[hazN] = qi.lateral;
        hazR[hazN] = it.radius || 1.2;
        hazN++;
      }
    }
    const bx = items && items.boxes;
    if (bx && qi && (bx !== boxesRef || bx.length !== boxN)) {
      boxesRef = bx;
      boxN = Math.min(bx.length, MAX_BOX);
      for (let b = 0; b < boxN; b++) {
        const it = bx[b];
        if (!it || !it.pos) { boxD[b] = -1e6; continue; }
        track.query(it.pos, -1, qi);
        boxD[b] = qi.dist;
        boxLat[b] = qi.lateral;
      }
    }
  }

  // Read-only views and switches for tests (tools/scenarios/ai.mjs). Records are only collected
  // while a test sets log = true.
  const debug = {
    log: false,
    noDrift: false,
    tune,
    drifts: [],
    get drivers() {
      return drivers.map((d) => ({ id: d.kart.id, skill: d.skill, style: d.style.name, offset: +d.offset.toFixed(2), mode: d.mode, rubberBand: d.kart.rubberBand }));
    },
    corners: corners.map((cr) => ({ from: cr.from, to: cr.to, arc: cr.arc, dir: cr.dir, turnDeg: Math.round(cr.turn / DEG) })),
    shortcuts,
    get shortcutOk() { return scInfo.map((x) => x.ok); },
    get shortcutProbe() { return scInfo.map((x) => ({ ok: x.ok, why: x.why, lead: x.lead, outT: x.outT, t: x.t, road: x.road })); },
    shortcutTried: new Int32Array(shortcuts.length),
    shortcutTaken: new Int32Array(shortcuts.length),
    // tests that teleport a kart call this so no mode, drift or item plan carries over
    reprobe() { for (let q = 0; q < shortcuts.length; q++) scInfo[q] = probeAims(shortcuts[q]); return scInfo.map((x) => x.ok); },
    resetDriver(kart) {
      const d = byKart.get(kart);
      if (!d) return;
      d.mode = MODE_DRIVE; d.shortcut = -1; d.scCommitted = false; d.scPast = false; d.scFired = false; d.scT = 0;
      d.dyn = 0; d.itemPlan = null; d.stuckT = 0; d.reverseT = 0; d.wdT = 0; d.wdAcc = 0; d.wdDist = -1;
    },
    lineLat,
  };

  // ---------------------------------------------------------------------------------------
  let stepCount = 0;
  function update(dt) {
    const race = game.race;
    const items = game.systems.items || null;
    const player = game.player;
    refreshWorld(items);
    const now = game.raceTime;
    stepCount++;

    for (let di = 0; di < drivers.length; di++) {
      const d = drivers[di];
      const k = d.kart;
      if (k.isPlayer && !k.autopilot) continue;
      const c = k.controls;
      c.lookBack = false;

      if (race && race.state === 'countdown') {
        c.steer = 0; c.brake = 0; c.drift = false; c.item = false;
        c.throttle = race.timeToGo <= d.startAt ? 1 : 0;
        continue;
      }

      rubberBand(d, player);

      if (k.respawn.active) {
        if (d.respawnRoll < 0) d.respawnRoll = d.rng.next() < d.launchP ? 1 : 0;
        c.throttle = k.respawn.stage === 'drop' && d.respawnRoll === 1 ? 1 : 0;
        c.steer = 0; c.brake = 0; c.drift = false; c.item = false;
        d.mode = MODE_DRIVE; d.stuckT = 0; d.reverseT = 0;
        d.wdT = 0; d.wdAcc = 0; d.wdDist = -1;
        continue;
      }
      d.respawnRoll = -1;

      drive(d, dt, now, items);
      useItems(d, dt, now, items, player);
    }
  }

  // Asymmetric band (config.rubberBand): a CPU behind the player gets 1 + k·gap/100 beyond behindFrom m,
  // never lifted above playerCap × the player's unboosted top (a CPU whose own top is already above that
  // is simply not lifted); a CPU ahead is only eased beyond aheadFrom m, and never below aheadMin.
  function rubberBand(d, player) {
    const k = d.kart;
    if (k.isPlayer || !player || player === k) { k.rubberBand = 1; return; }
    const gap = player.progress - k.progress;
    let rb = 1;
    if (gap > RB.behindFrom) {
      rb = Math.min(1 + rubberK * (gap - RB.behindFrom) / 100, RB.max);
      const cap = Math.max(1, (player.baseTop * RB.playerCap) / Math.max(1, k.baseTop));
      if (rb > cap) rb = cap;
    } else if (gap < -RB.aheadFrom) {
      rb = Math.max(1 + rubberK * (gap + RB.aheadFrom) / 100, RB.aheadMin);
    }
    k.rubberBand = rb;
  }

  function endDrift(d, reason) {
    const k = d.kart;
    if (debug.log && d.mode === MODE_DRIFT) {
      debug.drifts.push({ id: k.id, corner: d.corner, idx: k.trackInfo.index, tier: k.drift.tier, charge: +k.drift.charge.toFixed(2), turnDeg: Math.round(d.driftTurn / DEG), t: +d.driftT.toFixed(2), reason, lat: +k.trackInfo.lateral.toFixed(1), raceTime: +game.raceTime.toFixed(2) });
    }
    d.mode = MODE_DRIVE;
    d.releaseAt = game.raceTime;
  }

  function drive(d, dt, now, items) {
    const k = d.kart;
    const c = k.controls;
    const info = k.trackInfo;
    const i0 = info.index;
    const speed = Math.max(0, k.speed);
    const top = k.topSpeed;
    const myD = info.dist;
    const myLat = info.lateral;

    // --- corner bookkeeping: a mistake is rolled once per corner (§10.1: 4–15%)
    const ci = nextCorner[i0];
    if (ci !== d.corner) {
      d.corner = ci;
      d.mistake = 0;
      if (ci >= 0 && d.rng.next() < d.mistakeP) d.mistake = 1 + Math.floor(d.rng.next() * 4); // 1 wide 2 lift 3 early release 4 no drift
    }
    const cr = ci >= 0 ? corners[ci] : null;

    // --- lateral target: racing line + personal offset + dynamic shift
    let want = 0;
    const karts = game.karts;
    for (let j = 0; j < karts.length; j++) {
      const o = karts[j];
      if (o === k || o.respawn.active) continue;
      const ahead = along(myD, o.trackInfo.dist);
      const dl = o.trackInfo.lateral - myLat;
      if (ahead > -2.5 && ahead < 2.5 && Math.abs(dl) < 4) {
        // alongside: a bully leans in, everyone else keeps a car's width of air (side-by-side scraping
        // was most of the ~500 bumps a race, QA-1 #2)
        if (d.style.bump > 0 && Math.abs(dl) > 2.3) want += Math.sign(dl) * 0.8 * d.style.bump;
        else if (d.style.bump < 0.5) want -= (dl >= 0 ? 1 : -1) * (3.2 - Math.abs(dl)) * 0.8;
        continue;
      }
      // look further ahead the faster we close in: rear-ending a slower kart on a boost was the most
      // common bump
      const range = 16 + 1.5 * Math.max(0, speed - o.speed);
      if (ahead <= 0 || ahead > range) continue;
      if (Math.abs(dl) < 2.6 && o.speed < speed + 1) {
        want += (dl >= 0 ? -1 : 1) * (2.8 - Math.abs(dl)) * (1.3 - ahead / range);
      } else if (ahead > 5 && ahead < 16 && Math.abs(dl) < 5 && o.speed > 0.6 * top) {
        want += dl * 0.12 * d.style.draft; // tuck in for the slipstream
      }
    }
    // gum hazards ahead
    for (let h = 0; h < hazN; h++) {
      const ahead = along(myD, hazD[h]);
      if (ahead < 0 || ahead > 30) continue;
      const base = lineLat[idx(i0 + Math.round(ahead / sp))] + d.offset + d.dyn;
      const dl = hazLat[h] - base;
      const clear = hazR[h] + 1.6;
      if (Math.abs(dl) < clear) want += (dl >= 0 ? -1 : 1) * (clear - Math.abs(dl)) * 1.4 * (0.6 + 0.4 * d.sn);
    }
    // item boxes when cheap to reach
    if (!k.item && !(k.roulette > 0) && boxN > 0 && items && items.boxes) {
      let best = 1e9;
      for (let b = 0; b < boxN; b++) {
        const bx = items.boxes[b];
        if (!bx || !bx.active) continue;
        const ahead = along(myD, boxD[b]);
        if (ahead < 4 || ahead > 45) continue;
        const base = lineLat[idx(i0 + Math.round(ahead / sp))] + d.offset;
        const dl = boxLat[b] - base;
        if (Math.abs(dl) > 4.5 * d.style.box) continue;
        if (Math.abs(dl) < Math.abs(best)) best = dl;
      }
      if (best < 1e9) want += best;
    }
    if (d.mistake === 1 && cr) want += cr.dir * -3.5; // runs wide: outside of the corner
    d.dyn += (clamp(want, -6, 6) - d.dyn) * Math.min(1, dt * 3.5);

    // --- pursuit point
    const look = 6 + speed * 0.42;
    const j = idx(i0 + Math.round(look / sp));
    let lat = lineLat[j] * d.lineQ + d.offset * fade[j] + d.dyn;
    lat = clamp(lat, limL[j] - 0.8, limR[j] + 0.8);
    let tx = px[j] + hx[j] * lat;
    let tz = pz[j] + hz[j] * lat;

    // --- rocket shortcut: follow the road to the gap, cut across only on a live rocket boost. Entries sit
    // just before hairpins, so the decision comes before any drift: a drift in progress is cashed in and
    // no new one starts while a usable entry is near.
    const hasRocket = (k.item === 'rocket' || k.item === 'rocket3') && !(k.roulette > 0);
    let scNear = -1, scTo = 0;
    if (hasRocket && items && d.mode !== MODE_SHORTCUT) {
      for (let q = 0; q < shortcuts.length; q++) {
        if (!scInfo[q].ok && !tune.forceShortcut) continue;
        const toEntry = along(myD, s.dist[shortcuts[q].i]);
        if (toEntry > 0 && toEntry < 45 + speed * 0.8) { scNear = q; scTo = toEntry; break; }
      }
      if (scNear >= 0 && (d.mode === MODE_HOP || d.mode === MODE_DRIFT)) endDrift(d, 'shortcut');
    }
    let scBrake = false;
    if (d.mode === MODE_SHORTCUT) {
      const sc = shortcuts[d.shortcut];
      d.scT += dt;
      const toEntry = sc ? along(myD, s.dist[sc.i]) : 0;
      const committed = !info.onRoad || k.boostTime > 0.1;
      if (committed && toEntry <= 0.5 && !d.scCommitted) {
        d.scCommitted = true;
        d.scT = 0;
        if (debug.shortcutTaken) debug.shortcutTaken[d.shortcut]++;
      }
      const si = sc ? scInfo[d.shortcut] : null;
      const rel = sc ? along(s.dist[sc.j], myD) : 0; // m past the far end by our own query
      const onFar = rel > -60 && rel < 150;
      const alignErr = si ? Math.abs(angleDiff(s.heading[onFar ? info.index : si.jc], k.heading)) : 0;
      // before the entry: give up on a wall, a timeout, or reaching it without a boost; once across,
      // keep going until the far road is ours and we point down it
      const abort = d.scCommitted ? d.scT > 6
        : d.scT > 4 || k.wallContact || (toEntry <= 0.5 && !committed) || (toEntry < -15 && info.onRoad && along(s.dist[sc.j], myD) < -20);
      if (!sc || abort || (d.scCommitted && onFar && info.onRoad && (alignErr < SC_BRAKE_ERR || rel > 25))) {
        d.mode = MODE_DRIVE; d.shortcut = -1;
      } else if (toEntry > 0.5) {
        const ji = idx(sc.i + 2);
        const sl = si.sideI * (hwA[ji] - 1.5);
        tx = px[ji] + hx[ji] * sl;
        tz = pz[ji] + hz[ji] * sl;
      } else {
        let jj = si.jc, lt = si.aimLat;
        if (d.scPast || Math.hypot(px[jj] + hx[jj] * lt - k.pos.x, pz[jj] + hz[jj] * lt - k.pos.z) < 10) {
          d.scPast = true; // past the aim point: the far road's line
          jj = idx((onFar ? info.index : si.jc) + Math.round(12 / sp));
          lt = lineLat[jj];
        }
        tx = px[jj] + hx[jj] * lt;
        tz = pz[jj] + hz[jj] * lt;
        scBrake = k.boostTime <= 0 && k.surface !== 'out' && onFar && speed > SC_BRAKE_V && alignErr > SC_BRAKE_ERR;
      }
    } else if (scNear >= 0 && d.mode === MODE_DRIVE && scTo < 30 + speed * 0.8) {
      d.mode = MODE_SHORTCUT; d.shortcut = scNear; d.scT = 0; d.scCommitted = false; d.scPast = false; d.scFired = false;
      if (debug.shortcutTried) debug.shortcutTried[scNear]++;
    }

    const desired = Math.atan2(tx - k.pos.x, tz - k.pos.z);
    const err = angleDiff(desired, k.heading); // + = target is to the left
    const kAhead = d.mode === MODE_SHORTCUT ? 0 : lineK[j];

    // --- speed target from the precomputed profile (already holds the braking distance)
    // flat out on a ramp run-up: jumps are laid out for full speed (glacier's crevasse ate 94% karts)
    const pace = k.isPlayer || noDrift[i0] ? 1 : lerp(tune.paceBack, 1, d.sn);
    let throttle = pace, brake = 0;
    if (d.mode === MODE_DRIVE) {
      let vt = d.prof[idx(i0 + Math.ceil((2 + speed * 0.15) / sp))];
      if (d.mistake === 2 && cr) vt = Math.min(vt, top * 0.82);
      if (speed > vt + 0.3) throttle = 0;
      if (speed > vt + 2.5) brake = 1;
    } else if (scBrake) {
      throttle = 0; brake = 1;
    }

    // --- steering (normal): pursuit plus a curvature feed-forward
    let steer = clamp(-err * 2.4 - kAhead * speed / Math.max(0.5, YAW_HIGH * d.handling) * 0.5, -1, 1);
    let drift = false;

    // --- trick ramps: press drift just before the lip (edge; no drift carried onto a ramp)
    const rampHere = info.rampId >= 0 ? track.ramps[info.rampId] : null;
    const onTrick = !!(rampHere && rampHere.trick);
    const lipRamp = trickLip[i0];
    if ((d.mode === MODE_HOP || d.mode === MODE_DRIFT) && noDrift[i0]) endDrift(d, 'ramp');
    if (onTrick) {
      const toLip = along(myD, rampHere.d1);
      if (d.trickPressed === 0 && toLip < Math.max(1.5, speed * 0.12) && k.grounded) {
        d.trickPressed = d.rng.next() < d.trickP ? 1 : 2; // 2 = skipped this one
      }
    } else if (k.grounded && info.rampId < 0 && lipRamp < 0) {
      d.trickPressed = 0;
    }
    if (d.trickPressed === 1 && (onTrick || !k.grounded)) drift = true;

    // --- drifts
    if (d.mode === MODE_HOP) {
      drift = true;
      steer = -d.hopDir * HOP_AIR_STEER;
      throttle = pace; brake = 0;
      if (k.drift.active) { d.mode = MODE_DRIFT; d.driftT = 0; d.driftTurn = 0; d.lastH = k.heading; }
      else if (k.grounded && !k.hop.active) d.mode = MODE_DRIVE; // landed without a drift
    } else if (d.mode === MODE_DRIFT) {
      if (!k.drift.active) endDrift(d, 'cancel');
      else {
        const r = driftStep(d, dt, now);
        if (r) endDrift(d, r);
        else { drift = true; steer = d.driftS * k.drift.dir; }
      }
    } else if (d.mode === MODE_DRIVE && scNear < 0 && !debug.noDrift && !noDrift[i0] && lipRamp < 0 && !onTrick && d.mistake !== 4 && info.onRoad &&
               k.grounded && !k.hop.active && speed > Math.max(12, K.driftMinStart + 2) && now - d.releaseAt > 0.35 &&
               !c.drift && k.spinTime <= 0 && d.reverseT <= 0 && ((stepCount + d.phase) & 1) === 0) {
      const D = driftStart(d, speed);
      if (D !== 0) {
        d.mode = MODE_HOP;
        d.hopDir = D;
        drift = true;
        steer = D * HOP_PRESS_STEER;
        if (d.mistake === 3) d.earlyAt = lerp(0.35, 0.7, d.rng.next());
      }
    }

    // --- wall recovery and stuck watchdog (§8.1)
    if (d.reverseT > 0) {
      d.reverseT -= dt;
      throttle = 0; brake = 1; steer = d.reverseSteer; drift = false;
      if (d.mode === MODE_HOP || d.mode === MODE_DRIFT) endDrift(d, 'reverse');
    }
    if (Math.abs(k.speed) < 1.5 && !k.pinned && k.spinTime <= 0 && (throttle > 0.5 || d.reverseT > 0)) {
      d.stuckT += dt;
      if (d.stuckT > 1.0 && d.stuckT - dt <= 1.0 && k.wallContact && d.reverseT <= 0) {
        d.reverseT = 0.7;
        d.reverseSteer = err > 0 ? 1 : -1; // reversing with right steer swings the nose left
      }
      if (d.stuckT >= 3.0) { k.startRespawn(); d.stuckT = 0; d.reverseT = 0; d.mode = MODE_DRIVE; }
    } else if (Math.abs(k.speed) >= 1.5) {
      d.stuckT = 0;
    }
    // Progress watchdog: bouncing off a wall never drops below the speed threshold, so also respawn
    // when the kart has not made 8 m along the track in 4 s of trying.
    if (d.wdDist >= 0) d.wdAcc += clamp(along(d.wdDist, myD), -5, 5);
    d.wdDist = myD;
    d.wdT += dt;
    if (d.wdT >= 4) {
      if (d.wdAcc < 8 && !k.pinned && !k.respawn.active) { k.startRespawn(); d.mode = MODE_DRIVE; d.reverseT = 0; }
      d.wdT = 0; d.wdAcc = 0;
    }

    // --- wrong way: turn round
    forwardOf(k.heading, fwd);
    const dot = fwd.x * info.tangent.x + fwd.z * info.tangent.z;
    if (dot < -0.2 && d.reverseT <= 0) {
      steer = err > 0 ? -1 : 1; drift = false;
      if (d.mode === MODE_HOP || d.mode === MODE_DRIFT) endDrift(d, 'wrongway');
    }

    // --- ink: wobbly hands (±0.3, §10.1)
    if (k.inkTime > 0) {
      d.inkT -= dt;
      if (d.inkT <= 0) { d.inkT = 0.22; d.inkTarget = d.rng.range(-0.3, 0.3); }
      d.inkNoise += (d.inkTarget - d.inkNoise) * Math.min(1, dt * 8);
      steer = clamp(steer + d.inkNoise, -1, 1);
    } else d.inkNoise = 0;

    c.steer = steer;
    c.throttle = throttle;
    c.brake = brake;
    c.drift = drift;
  }

  // Line turn (rad, in drift direction D) from sample i onwards while the line keeps turning faster than
  // curvature kMin; dips shorter than 6 m are bridged.
  function lineTurnFrom(i, D, kMin) {
    let turn = 0, gap = 0;
    const maxGap = Math.round(6 / sp);
    for (let n = 0; n < 400; n++) {
      const kk = -D * lineK[idx(i + n)];
      if (kk >= kMin) { turn += kk * sp; gap = 0; }
      else if (++gap > maxGap) break;
      else if (kk > 0) turn += kk * sp;
    }
    return turn;
  }

  // Hop now? Returns the drift direction (+1 right, −1 left) or 0. The line must turn at least the
  // driver's slowest drift yaw for the first 0.4 s after the hop lands, and keep turning for long enough
  // (driftMin) to be worth a hop.
  function driftStart(d, speed) {
    const i0 = d.kart.trackInfo.index;
    const iLand = i0 + Math.round(speed * (hopTime + tune.entryLead * d.sn) / sp);
    const kl = lineK[idx(iLand)];
    const D = kl > 0 ? -1 : 1;
    const kNeed = d.yawMin * tune.entryYaw / speed;
    const w = Math.max(3, Math.round(speed * 0.4 / sp));
    for (let n = 0; n <= w; n += 2) if (-D * lineK[idx(iLand + n)] < kNeed) return 0;
    if (lineTurnFrom(idx(iLand), D, d.yawMin * tune.releaseYaw / speed) < d.driftMin) return 0;
    return D;
  }

  // One step of a held drift: track the racing line with the drift yaw; release where the line turns
  // slower than the drift can (holding a moment longer if the next tier is about to light), at the road
  // edge, or on a mistake. Returns a release reason or null.
  function driftStep(d, dt, now) {
    const k = d.kart;
    const info = k.trackInfo;
    const i0 = info.index;
    const D = k.drift.dir;
    const v = Math.max(8, k.speed);
    d.driftT += dt;
    d.driftTurn += Math.abs(angleDiff(k.heading, d.lastH));
    d.lastH = k.heading;

    if (d.driftT > 9) return 'long';
    if (d.mistake === 3 && d.driftT > 0.8 && k.drift.tier >= 1 && d.driftT > d.earlyAt * 3) return 'mistake';
    // A scissors strike is dodged by a boost at impact: cash the drift in right before it lands.
    if (d.threatKind === 'scissors' && now < d.threatUntil && d.threatUntil - now < 0.45 && k.drift.tier >= 1) return 'dodge';
    // road edge: off it the charge pauses, so the drift ends there
    const vh = k.speed > 1 ? Math.atan2(k.vel.x, k.vel.z) : k.heading;
    if (Math.abs(info.lateral) - hwA[i0] > 0.2) return 'edge';

    // pursuit of the line (with the personal offset, kept on the road) on the direction of travel; the
    // apex is taken a little wider than the racing line, which leaves room and charges longer
    const j = idx(i0 + Math.round((4 + v * 0.3) / sp));
    let lat = lineLat[j] * d.lineQ * tune.driftLine + d.offset * fade[j] + 0.5 * d.dyn;
    if (d.mistake === 1) lat -= D * 3;
    lat = clamp(lat, -hwA[j] + 1.2, hwA[j] - 1.2);
    const tx = px[j] + hx[j] * lat, tz = pz[j] + hz[j] * lat;
    const errIn = -D * angleDiff(Math.atan2(tx - k.pos.x, tz - k.pos.z), vh); // + = turn harder into the drift
    let sd = clamp(steerForYaw(-D * lineK[j] * v + DRIFT_GAIN * errIn), d.sMin, 1);
    // within 1.2 m of an edge and heading for it: the least (inside edge) or most (outside edge) yaw
    const yIn = D * info.lateral;
    const inRate = Math.sin(-D * angleDiff(vh, s.heading[i0])) * v; // m/s towards the inside
    if (yIn > hwA[i0] - 1.2 && inRate > 0.5) sd = d.sMin;
    else if (-yIn > hwA[i0] - 1.2 && inRate < -0.5) sd = 1;

    // exit: over the next 0.35 s the line turns slower than the drift can, and we are not behind it
    let lineMax = -1;
    const n1 = Math.round(v * 0.35 / sp);
    for (let n = 0; n <= n1; n += 2) {
      const kk = -D * lineK[idx(i0 + n)];
      if (kk > lineMax) lineMax = kk;
    }
    if (lineMax * v < d.yawMin * tune.releaseYaw && errIn < 0.03) {
      const tier = k.drift.tier;
      if (tier >= 3) return 'exit';
      const need = (TIERS[tier] - k.drift.charge) / driftRate(d.sMin);
      if (need > d.tierHold * tune.holdScale) return 'exit';
      // Hold, turning as little as possible, for the tier just ahead, if the road has room for the
      // extra rotation and for straightening afterwards (normal steering at top-speed yaw).
      const psi = -D * angleDiff(vh, s.heading[i0]) + d.yawMin * need;
      const drift = v * need * (-D * angleDiff(vh, s.heading[i0]) + 0.5 * d.yawMin * need);
      if (D * info.lateral + drift + v * psi * Math.max(0, psi) / (2 * YAW_HIGH * d.handling) > hwA[i0] - 1.0) return 'exit';
      d.driftS = d.sMin;
      return null;
    }
    d.driftS = sd;
    return null;
  }

  // ---------------------------------------------------------------------------------------
  // items (§10.1 / §10.2); every field of the items module is optional
  function useItems(d, dt, now, items, player) {
    const k = d.kart;
    const c = k.controls;
    c.item = false;
    if (!items || !k.item || k.roulette > 0 || k.spinTime > 0) { d.itemPlan = null; d.heldFor = 0; return; }
    if (d.itemPlan !== k.item) {
      d.itemPlan = k.item;
      d.itemT = 0;
      d.holdFor = d.rng.range(d.style.hold[0], d.style.hold[1]);
      d.nextTry = 0;
      d.heldFor = 0;
      d.backPref = d.rng.next() < 0.35 * d.style.gumBack; // plane: would rather defend than attack
    }
    d.itemT += dt;

    const threat = now < d.threatUntil || homingAt(k, items);
    // gum: trail as a shield while a homing threat is coming, drop when someone is close behind
    if (k.item === 'gum') {
      if (threat && d.itemT > d.reaction) {
        if (d.heldFor > 0 || !k.prevControls.item) { c.item = true; d.heldFor += dt; }
        return;
      }
      if (d.heldFor > 0) { d.heldFor = 0; return; } // release drops it behind
      const behind = closestBehind(k, 18);
      if (d.itemT > d.holdFor && behind && behind.dist < 14 * d.style.gumBack && Math.abs(behind.lat) < 3 &&
          (behind.kart !== player || now - d.lastAtPlayer > AIM_PLAYER_GAP)) {
        if (behind.kart === player) d.lastAtPlayer = now;
        press(d, c, now);
      } else if (d.itemT > d.holdFor + 9) press(d, c, now);
      return;
    }
    if (d.itemT < d.holdFor && d.mode !== MODE_SHORTCUT && !threat) return;
    if (now < d.nextTry) return;

    const straight = straightAhead(k, 55);
    switch (k.item) {
      case 'rocket':
      case 'rocket3': {
        if (d.mode === MODE_SHORTCUT) {
          const sc = shortcuts[d.shortcut];
          if (sc && !d.scFired && !(k.boostTime > 0.15)) { // one pen per crossing
            const toEntry = along(k.trackInfo.dist, s.dist[sc.i]);
            if (toEntry < 3 || !k.trackInfo.onRoad) { press(d, c, now); d.scFired = c.item; }
          }
          return;
        }
        // scissors dodge: a boost active at impact
        if (d.threatKind === 'scissors' && now < d.threatUntil && d.threatUntil - now < 0.9 && k.boostTime <= 0) { press(d, c, now); return; }
        if (d.mode === MODE_HOP || d.mode === MODE_DRIFT || k.boostTime > 0) return;
        if ((k.item === 'rocket' || k.itemCount <= 1) && shortcutAhead(k, 400)) return; // the last one crosses the shortcut
        const catchUp = k.place >= 5 || gapAhead(k) > 35;
        const saving = d.style.save > 0.6 && !catchUp && d.itemT < d.holdFor + 6;
        if ((straight && !saving) || (catchUp && straight) || d.itemT > d.holdFor + 8) press(d, c, now);
        return;
      }
      case 'foil': {
        const catchUp = k.place >= 4;
        if (threat || (straight && catchUp) || (straight && d.style.save < 0.5) || d.itemT > d.holdFor + 10) press(d, c, now);
        return;
      }
      case 'plane': {
        const t = aimTarget(k, 55, 0.12);
        if (t && (t !== player || now - d.lastAtPlayer > AIM_PLAYER_GAP) && d.rng.next() < 0.25 * d.style.aim) {
          if (t === player) d.lastAtPlayer = now;
          press(d, c, now);
          return;
        }
        const behind = closestBehind(k, 16);
        if (d.backPref && behind && Math.abs(behind.lat) < 2 && (behind.kart !== player || now - d.lastAtPlayer > AIM_PLAYER_GAP)) {
          if (behind.kart === player) d.lastAtPlayer = now;
          press(d, c, now, true); // backward: brake at the press edge (§10.2); lookBack would swing the autopilot's camera
          return;
        }
        if (d.itemT > d.holdFor + 7 && k.place > 1) press(d, c, now);
        return;
      }
      case 'homing': {
        if (k.place <= 1) {
          if (d.itemT > d.holdFor + 12) press(d, c, now); // nobody ahead: let it go
          return;
        }
        const tgt = kartAhead(k);
        if (tgt === player && now - d.lastAtPlayer <= AIM_PLAYER_GAP) return;
        if (d.rng.next() < 0.5 * d.style.aim * (0.5 + d.sn) * dt * 4 || d.itemT > d.holdFor + 3) {
          if (tgt === player) d.lastAtPlayer = now;
          press(d, c, now);
        }
        return;
      }
      case 'ink': {
        if (k.place > 2 || (k.place > 1 && d.itemT > d.holdFor + 3)) {
          if (player && player.place < k.place) {
            if (now - d.lastAtPlayer <= AIM_PLAYER_GAP) return;
            d.lastAtPlayer = now;
          }
          press(d, c, now);
        }
        return;
      }
      case 'scissors': {
        if (k.place <= 1) return;
        const leader = leaderKart();
        if (leader === player && now - d.lastAtPlayer <= AIM_PLAYER_GAP) return;
        if (leader === player) d.lastAtPlayer = now;
        press(d, c, now);
        return;
      }
      default:
        if (d.itemT > d.holdFor + 2) press(d, c, now);
    }
  }

  // One press edge (items reads cur && !prev); a retry later if the item was not consumed. Items reads a
  // held brake at the edge as a backward throw, so a forward throw lets go of the brake for that step.
  function press(d, c, now, backward = false) {
    if (d.kart.prevControls.item) return;
    c.item = true;
    if (backward) c.brake = 1;
    else if (c.brake > 0.5) c.brake = 0;
    d.nextTry = now + 1.0;
  }

  function homingAt(k, items) {
    const pr = items.projectiles;
    if (!pr) return false;
    for (let p = 0; p < pr.length; p++) {
      const q = pr[p];
      if (q && q.target === k && (q.kind === 'homing' || q.kind === 'plane') && q.owner !== k) return true;
    }
    return false;
  }

  const behindOut = { kart: null, dist: 0, lat: 0 };
  function closestBehind(k, range) {
    let best = null, bd = range;
    const karts = game.karts;
    for (let j = 0; j < karts.length; j++) {
      const o = karts[j];
      if (o === k || o.respawn.active || o.finished) continue;
      const g = k.progress - o.progress;
      if (g > 0 && g < bd) { bd = g; best = o; }
    }
    if (!best) return null;
    behindOut.kart = best; behindOut.dist = bd; behindOut.lat = best.trackInfo.lateral - k.trackInfo.lateral;
    return behindOut;
  }

  function kartAhead(k) {
    let best = null, bd = Infinity;
    const karts = game.karts;
    for (let j = 0; j < karts.length; j++) {
      const o = karts[j];
      if (o === k) continue;
      const g = o.progress - k.progress;
      if (g > 0 && g < bd) { bd = g; best = o; }
    }
    return best;
  }

  function gapAhead(k) {
    const o = kartAhead(k);
    return o ? o.progress - k.progress : 0;
  }

  function leaderKart() {
    const karts = game.karts;
    for (let j = 0; j < karts.length; j++) if (karts[j].place === 1) return karts[j];
    return null;
  }

  // A kart ahead within range whose bearing is inside the cone (radians) of our heading.
  function aimTarget(k, range, cone) {
    forwardOf(k.heading, fwd);
    const karts = game.karts;
    let best = null, bd = range * range;
    const cc = Math.cos(cone);
    for (let j = 0; j < karts.length; j++) {
      const o = karts[j];
      if (o === k || o.respawn.active || o.isImmune()) continue;
      const dx = o.pos.x - k.pos.x, dz = o.pos.z - k.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > bd || d2 < 4) continue;
      const dist = Math.sqrt(d2);
      if ((dx * fwd.x + dz * fwd.z) / dist < cc) continue;
      bd = d2; best = o;
    }
    return best;
  }

  function straightAhead(k, metres) {
    const i0 = k.trackInfo.index;
    return Math.abs(turnBetween(i0, idx(i0 + Math.round(metres / sp)))) < 0.2 &&
      Math.abs(s.curvature[i0]) < 1 / 120 && Math.abs(s.curvature[idx(i0 + Math.round(10 / sp))]) < 1 / 120 &&
      Math.abs(s.curvature[idx(i0 + Math.round(metres * 0.5 / sp))]) < 1 / 120;
  }

  // A usable rocket shortcut starts within `metres` ahead.
  function shortcutAhead(k, metres) {
    for (let q = 0; q < shortcuts.length; q++) {
      if (!scInfo[q].ok && !tune.forceShortcut) continue;
      const a = along(k.trackInfo.dist, s.dist[shortcuts[q].i]);
      if (a > 0 && a < metres) return true;
    }
    return false;
  }

  function dispose() {
    offThreat();
    byKart.clear();
    for (const d of drivers) if (d.kart) d.kart.rubberBand = 1;
    drivers.length = 0;
    debug.drifts.length = 0;
  }

  return { update, dispose, debug };
}
