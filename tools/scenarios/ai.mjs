// AI checks (ARCHITECTURE.md §10.1 / §17): full races through simulate() on every track def that exists,
// including the tracks lane's staged defs (imported into the live TRACKS object, test-only).
// node tools/scenarios/ai.mjs [--port 8772] [--mode metrics|drifts|solo|checks|recovery|items|leak|shots|all]
//                             [--tracks a,b] [--seeds 1,2] [--cls 120] [--laps 3] [--no-staged] [--json]
//                             [--noitems] [--tune k=v,...] [--tweak k=v,...] [--verbose] [--bins]
// metrics: autopilot lap times/place, CPU spread (real finish times: the race is held open after the
//          player finishes), tier-2+ releases per lap per CPU, place changes, respawns, wall impacts,
//          ms per ai.update, and whether every kart finishes on its own.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'out', 'ai');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const port = +arg('port', 8772);
const mode = arg('mode', 'metrics');
const cls = String(arg('cls', '120'));
const laps = +arg('laps', 3);
const seeds = String(arg('seeds', '1,2,3')).split(',').map(Number);
const staged = !process.argv.includes('--no-staged');
const trackArg = arg('tracks', null);
const jsonOut = process.argv.includes('--json');
const noItems = process.argv.includes('--noitems');
const tuneArg = Object.fromEntries(String(arg('tune', '')).split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; }));
// --tweak key=value,... changes config.kart in this page only (test-only physics what-ifs); a/b/c = array
const tweak = Object.fromEntries(String(arg('tweak', '')).split(',').filter(Boolean).map((kv) => {
  const [k, v] = kv.split('=');
  return [k, v.includes('/') ? v.split('/').map(Number) : Number(v)];
}));

const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

// ------------------------------------------------------------------------------------------------
// page side
async function pageSetup({ staged }) {
  const kk = window.__kk;
  kk.setAutoPause(false);
  const idx = await import('/src/track/defs/index.js');
  const ids = Object.keys(idx.TRACKS);
  if (staged) {
    for (const id of ['meadow', 'bosphorus', 'glacier', 'desk']) {
      try {
        if (idx.TRACKS[id]) continue; // already in src
        const m = await import(`/stage/tracks/src/track/defs/${id}.js`);
        idx.TRACKS[id] = m.default;
        ids.push(id);
      } catch (e) { /* lane not there yet */ }
    }
  }
  return ids;
}

async function pageRace(o) {
  const kk = window.__kk;
  const g = kk.game;
  const STEP = g.config.STEP;
  const tallies = {};
  const T = (id) => (tallies[id] ||= { t1: 0, t2: 0, t3: 0, cancel: 0, starts: 0, wallHits: 0, hardWall: 0, respawns: 0, hits: 0, items: 0, pads: 0, tricks: 0, drafts: 0, outRespawn: 0 });
  const untap = g.events.tap((name, p) => {
    const id = p?.kart?.id;
    if (!id) return;
    const t = T(id);
    if (name === 'drift') {
      if (p.state === 'release' && p.tier >= 1) t['t' + p.tier]++;
      else if (p.state === 'cancel') t.cancel++;
      else if (p.state === 'start') t.starts++;
    } else if (name === 'wallHit') { t.wallHits++; if (p.angle > Math.PI / 4) t.hardWall++; }
    else if (name === 'respawn' && p.stage === 'lift') t.respawns++;
    else if (name === 'hit') t.hits++;
    else if (name === 'itemUse') t.items++;
    else if (name === 'boost') { if (p.source === 'pad') t.pads++; else if (p.source === 'trick') t.tricks++; else if (p.source === 'draft') t.drafts++; }
  });
  try {
    await kk.startRace({ track: o.track, laps: o.laps, seed: o.seed, autopilot: true, skipIntro: true, mode: 'single', cls: o.cls });
    g.loop.stop();
    Object.assign(g.systems.ai.debug.tune, o.tune || {});
    const itemsSys = g.systems.items;
    if (o.noItems) g.systems.items = null; // test-only: driving pace without items (restored before teardown)
    const ai = g.systems.ai;
    let aiMs = 0, aiCalls = 0;
    const origUpdate = ai.update;
    ai.update = (dt) => { const t0 = performance.now(); origUpdate(dt); aiMs += performance.now() - t0; aiCalls++; };
    const karts = g.karts.slice();
    const drivers = ai.debug ? ai.debug.drivers : [];
    let playerDone = null;
    const limit = 3.4 * o.laps * 60 + 30;
    while (g.raceTime < limit) {
      kk.simulate(1);
      if (g.player.finished && playerDone == null) playerDone = g.raceTime;
      if (g.race && g.race.state === 'finishing') g.race.waitLeft = 1e9; // hold the race open for real CPU times
      if (karts.every((k) => k.finished)) break;
      if (playerDone != null && g.raceTime > playerDone + 90) break;
      if (g.phase === 'results') break;
    }
    const L = g.track.length;
    const per = karts.map((k) => {
      const d = drivers.find((x) => x.id === k.id) || {};
      return {
        id: k.id, player: k.isPlayer, skill: d.skill, style: d.style, place: k.place, finished: k.finished,
        time: k.finishTime != null ? +k.finishTime.toFixed(2) : null,
        laps: k.lapTimes.map((t) => +t.toFixed(2)),
        progress: +(k.progress / L).toFixed(2),
        ...T(k.id),
      };
    });
    const cpus = per.filter((p) => !p.player);
    const pl = per.find((p) => p.player);
    const cpuTimes = cpus.filter((p) => p.time != null).map((p) => p.time);
    const t2 = cpus.reduce((a, p) => a + p.t2 + p.t3, 0);
    const res = {
      track: o.track, seed: o.seed, lapLen: +L.toFixed(0),
      playerPlace: pl.place, playerLaps: pl.laps, playerTime: pl.time,
      allFinished: per.every((p) => p.finished),
      cpuFinished: cpus.filter((p) => p.finished).length,
      within12: cpus.filter((p) => p.time != null && playerDone != null && p.time <= playerDone + 12).length,
      spread: cpuTimes.length ? +(Math.max(...cpuTimes) - Math.min(...cpuTimes)).toFixed(2) : null,
      t2PerLapPerCpu: +(t2 / o.laps / cpus.length).toFixed(2),
      minT2PerLap: +Math.min(...cpus.map((p) => (p.t2 + p.t3) / o.laps)).toFixed(2),
      placeChanges: g.race ? g.race.placeChanges : null,
      respawns: per.reduce((a, p) => a + p.respawns, 0),
      wallHits: per.reduce((a, p) => a + p.wallHits, 0),
      hardWall: per.reduce((a, p) => a + p.hardWall, 0),
      hits: per.reduce((a, p) => a + p.hits, 0),
      itemUsesPerCpu: +(cpus.reduce((a, p) => a + p.items, 0) / cpus.length).toFixed(2),
      aiUsPerStep: +(aiMs * 1000 / Math.max(1, aiCalls)).toFixed(1),
      errors: kk.errors.length,
      per,
    };
    ai.update = origUpdate;
    g.systems.items = itemsSys;
    return res;
  } finally {
    untap();
    g.loop.start();
    g.api.quitToTitle();
  }
}

// Per-drift records for one race: every CPU and the autopilot, grouped by corner.
async function pageDrifts(o) {
  const kk = window.__kk;
  const g = kk.game;
  await kk.startRace({ track: o.track, laps: o.laps, seed: o.seed, autopilot: true, skipIntro: true, mode: 'single', cls: o.cls });
  g.loop.stop();
  const ai = g.systems.ai;
  Object.assign(ai.debug.tune, o.tune || {});
  ai.debug.log = true;
  try {
    kk.simulate(o.seconds);
    const drifts = ai.debug.drifts.slice();
    return { corners: ai.debug.corners, drifts, drivers: ai.debug.drivers, lapLen: g.track.length };
  } finally {
    g.loop.start();
    g.api.quitToTitle();
  }
}

// Solo pace: time trial, items detached, autopilot only. Lap times with and without drifting.
async function pageSolo(o) {
  const kk = window.__kk;
  const g = kk.game;
  const out = {};
  for (const variant of ['drift', 'nodrift']) {
    await kk.startRace({ track: o.track, laps: o.laps, seed: o.seed, autopilot: true, skipIntro: true, mode: 'tt', cls: o.cls });
    g.loop.stop();
    Object.assign(g.systems.ai.debug.tune, o.tune || {});
    const itemsSys = g.systems.items;
    g.systems.items = null;
    g.systems.ai.debug.noDrift = variant === 'nodrift';
    let rel = { t1: 0, t2: 0, t3: 0 };
    const untap = g.events.tap((name, p) => { if (name === 'drift' && p.state === 'release' && p.tier >= 1) rel['t' + p.tier]++; });
    const P = g.player, STEP = g.config.STEP;
    const st = { drift: [0, 0], air: [0, 0], ground: [0, 0], brake: 0, lift: 0, offroad: 0, prepSteps: 0 };
    const L = g.track.length, BIN = 20, nb = Math.ceil(L / BIN);
    const binT = new Array(nb).fill(0), binLat = new Array(nb).fill(0), binN = new Array(nb).fill(0), binDrift = new Array(nb).fill(0);
    for (let i = 0; i < 400 * 120 && !P.finished; i++) {
      kk.simulate(STEP);
      if (g.race.state === 'countdown') continue;
      const b = P.drift.active ? st.drift : !P.grounded ? st.air : st.ground;
      b[0]++; b[1] += P.speed / P.topSpeed;
      if (P.controls.brake > 0.1) st.brake++;
      if (P.controls.throttle < 0.5) st.lift++;
      if (P.surface === 'offroad' || P.surface === 'out') st.offroad++;
      if (P.lap === 2) {
        let d = P.trackInfo.dist - g.track.startDist; if (d < 0) d += L;
        const b = Math.min(nb - 1, Math.floor(d / BIN));
        binT[b] += STEP; binLat[b] += P.trackInfo.lateral; binN[b]++; if (P.drift.active) binDrift[b]++;
      }
    }
    untap();
    const f = (b) => [+(b[0] * STEP).toFixed(1), +(b[1] / Math.max(1, b[0])).toFixed(3)];
    out[variant] = { laps: g.player.lapTimes.map((x) => +x.toFixed(2)), rel, drift: f(st.drift), air: f(st.air), ground: f(st.ground), brakeS: +(st.brake * STEP).toFixed(1), liftS: +(st.lift * STEP).toFixed(1), offroadS: +(st.offroad * STEP).toFixed(1), binT: binT.map((x) => +x.toFixed(2)), binLat: binLat.map((x, i) => +(x / Math.max(1, binN[i])).toFixed(1)), binDrift: binDrift.map((x, i) => +(x / Math.max(1, binN[i])).toFixed(2)) };
    g.systems.items = itemsSys;
    g.loop.start();
    g.api.quitToTitle();
  }
  return out;
}

// Determinism, other classes, time trial.
async function pageChecks(o) {
  const kk = window.__kk;
  const g = kk.game;
  const out = { determinism: null, classes: [], tt: [] };
  async function run(opts, holdOpen = true) {
    await kk.startRace({ laps: 3, autopilot: true, skipIntro: true, mode: 'single', ...opts });
    g.loop.stop();
    const tally = { respawns: 0, walls: 0, rockets: 0, itemUses: 0 };
    const untap = g.events.tap((name, p) => {
      if (name === 'respawn' && p.stage === 'lift') tally.respawns++;
      else if (name === 'wallHit' && p.angle > 0.2) tally.walls++;
      else if (name === 'itemUse') { tally.itemUses++; if (p.item === 'rocket' || p.item === 'rocket3') tally.rockets++; }
    });
    const karts = g.karts.slice();
    let maxOff = 0;
    for (let i = 0; i < 480 && g.raceTime < 400; i++) {
      kk.simulate(1);
      for (const k of karts) if (!k.trackInfo.onRoad) maxOff = Math.max(maxOff, Math.abs(k.trackInfo.lateral) - k.trackInfo.halfWidth);
      if (holdOpen && g.race && g.race.state === 'finishing') g.race.waitLeft = 1e9;
      if (karts.every((k) => k.finished) || g.phase === 'results') break;
    }
    untap();
    const res = { finished: karts.filter((k) => k.finished).length, of: karts.length, times: karts.map((k) => (k.finishTime == null ? null : +k.finishTime.toFixed(3))), order: g.race.finishOrder.slice(), laps: g.player.lapTimes.map((x) => +x.toFixed(2)), maxOff: +maxOff.toFixed(1), ...tally };
    g.loop.start();
    g.api.quitToTitle();
    return res;
  }
  const a = await run({ track: o.tracks[0], seed: 11, cls: '120' });
  const b = await run({ track: o.tracks[0], seed: 11, cls: '120' });
  out.determinism = { same: JSON.stringify(a.times) === JSON.stringify(b.times) && a.order.join() === b.order.join(), a: a.times, b: b.times };
  for (const cls of ['80', '200']) {
    for (const track of o.tracks) {
      const r = await run({ track, seed: 3, cls });
      out.classes.push({ cls, track, finished: `${r.finished}/${r.of}`, laps: r.laps, respawns: r.respawns, walls: r.walls });
    }
  }
  for (const track of o.tracks) {
    const r = await run({ track, seed: 4, cls: '120', mode: 'tt', cpuCount: 0 }, false);
    out.tt.push({ track, finished: `${r.finished}/${r.of}`, laps: r.laps, rockets: r.rockets, respawns: r.respawns, walls: r.walls, maxOffroad: r.maxOff });
  }
  return out;
}

// Recovery: nose into a wall at standstill, facing backwards, deep in the offroad, and inked.
async function pageRecovery(o) {
  const kk = window.__kk;
  const g = kk.game;
  const out = [];
  await kk.startRace({ track: o.track, laps: 3, seed: 21, autopilot: true, skipIntro: true, mode: 'single', cls: '120' });
  g.loop.stop();
  kk.simulate(8);
  const t = g.track, s = t.samples, N = t.sampleCount;
  const k = g.karts[1];
  let respawns = 0;
  const untap = g.events.tap((name, p) => { if (name === 'respawn' && p.kart === k && p.stage === 'lift') respawns++; });
  function progressFor(seconds) {
    let acc = 0, prev = k.trackInfo.dist;
    const L = t.length;
    for (let i = 0; i < seconds * 120; i++) {
      kk.simulate(g.config.STEP);
      let d = k.trackInfo.dist - prev;
      if (d > L / 2) d -= L;
      if (d < -L / 2) d += L;
      if (Math.abs(d) < 20) acc += d;
      prev = k.trackInfo.dist;
    }
    return acc;
  }
  function place(tFrac, lateral, headingOffset, speed) {
    kk.teleport(k.index, tFrac, lateral);
    k.heading += headingOffset;
    k.vel.set(Math.sin(k.heading) * speed, 0, Math.cos(k.heading) * speed);
    k.speed = speed;
  }
  // 1. nose into a wall, standing
  let wi = -1, side = 0;
  for (let i = 0; i < N; i += 7) {
    if (s.edgeRight[i] === 1) { wi = i; side = 1; break; }
    if (s.edgeLeft[i] === 1) { wi = i; side = -1; break; }
  }
  if (wi >= 0) {
    respawns = 0;
    const lat = side * (s.halfWidth[wi] + s.offroad[wi] - 1.3);
    place(wi / N, lat, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
    const prog = progressFor(10);
    out.push({ test: 'wall-facing standstill', progress10s: +prog.toFixed(1), respawns, onRoadAfter: k.trackInfo.onRoad, lateralAfter: +k.trackInfo.lateral.toFixed(1) });
  }
  // 2. facing backwards at speed
  respawns = 0;
  place(0.3, 0, Math.PI, 10);
  let prog = progressFor(8);
  out.push({ test: 'wrong way at 10 m/s', progress8s: +prog.toFixed(1), respawns, wrongWay: k.wrongWay });
  // 3. deep in the offroad band
  respawns = 0;
  place(0.62, s.halfWidth[Math.round(0.62 * N)] + 6, 0, 8);
  prog = progressFor(6);
  out.push({ test: 'offroad 6 m out', progress6s: +prog.toFixed(1), respawns, onRoadAfter: k.trackInfo.onRoad });
  // 4. inked: steering noise, still on the road
  respawns = 0;
  place(0.1, 0, 0, 22);
  k.applyInk(3.5);
  let steerVar = 0, off = 0;
  for (let i = 0; i < 3.5 * 120; i++) {
    kk.simulate(g.config.STEP);
    steerVar += Math.abs(k.controls.steer);
    if (!k.trackInfo.onRoad) off++;
  }
  out.push({ test: 'inked 3.5 s', meanAbsSteer: +(steerVar / 420).toFixed(2), offroadS: +(off / 120).toFixed(2), respawns });
  untap();
  g.loop.start();
  g.api.quitToTitle();
  return out;
}

// Item decisions with the real items module: give an item, watch when and how it is used.
async function pageItems(o) {
  const kk = window.__kk;
  const g = kk.game;
  const out = { module: false, tests: [] };
  await kk.startRace({ track: o.track, laps: 3, seed: 5, autopilot: true, skipIntro: true, mode: 'single', cls: '120' });
  g.loop.stop();
  kk.simulate(24); // past the 20 s scissors lock, pack spread out
  const items = g.systems.items;
  out.module = !!items && Array.isArray(items.hazards);
  const t = g.track;
  let uses = [];
  const untap = g.events.tap((name, p) => {
    if (name !== 'itemUse') return;
    const k = p.kart;
    let ahead = null, behind = null;
    for (const q of g.karts) {
      if (q === k) continue;
      const gap = q.progress - k.progress;
      if (gap > 0 && (!ahead || gap < ahead.gap)) {
        const dx = q.pos.x - k.pos.x, dz = q.pos.z - k.pos.z;
        const bearing = Math.atan2(dx, dz) - k.heading;
        ahead = { id: q.id, gap: +gap.toFixed(1), bearingDeg: Math.round(Math.atan2(Math.sin(bearing), Math.cos(bearing)) * 57.3) };
      }
      if (gap < 0 && (!behind || -gap < behind.gap)) behind = { id: q.id, gap: +(-gap).toFixed(1), dLat: +(q.trackInfo.lateral - k.trackInfo.lateral).toFixed(1) };
    }
    uses.push({ id: k.id, item: p.item, backward: p.backward, t: +g.raceTime.toFixed(2), place: k.place, curv: +Math.abs(k.trackInfo.curvature).toFixed(4), drifting: k.drift.active, ahead, behind });
  });
  function cpuAtPlace(pl) { return g.karts.find((k) => !k.isPlayer && k.place === pl) || g.karts.find((k) => !k.isPlayer); }
  function give(k, item, seconds) {
    uses = [];
    const t0 = g.raceTime;
    kk.giveItem(k.index, item);
    for (let i = 0; i < seconds * 120; i++) {
      kk.simulate(g.config.STEP);
      if (item !== 'rocket3' && uses.some((u) => u.id === k.id && u.item === item)) break;
    }
    const mine = uses.filter((u) => u.id === k.id);
    return { item, kart: k.id, place: k.place, usedAfter: mine.length ? +(mine[0].t - t0).toFixed(2) : null, uses: mine };
  }
  out.tests.push(give(cpuAtPlace(4), 'rocket', 14));
  out.tests.push(give(cpuAtPlace(5), 'rocket3', 20));
  out.tests.push(give(cpuAtPlace(3), 'plane', 14));
  out.tests.push(give(cpuAtPlace(2), 'gum', 16));
  out.tests.push(give(cpuAtPlace(4), 'homing', 12));
  out.tests.push(give(cpuAtPlace(5), 'ink', 12));
  out.tests.push(give(cpuAtPlace(6), 'foil', 16));
  out.tests.push(give(cpuAtPlace(3), 'scissors', 10));
  // shield: the leader holds gum, a homing is fired at it from behind
  {
    const lead = g.karts.find((k) => k.place === 1);
    const chaser = g.karts.find((k) => k.place === 2);
    kk.giveItem(lead.index, 'gum');
    let trailed = 0, hitLead = 0;
    const un2 = g.events.tap((name, p) => { if (name === 'hit' && p.kart === lead && p.cause === 'homing') hitLead++; });
    kk.giveItem(chaser.index, 'homing');
    for (let i = 0; i < 8 * 120; i++) { kk.simulate(g.config.STEP); if (lead.itemHeld) trailed++; }
    un2();
    out.tests.push({ item: 'gum shield vs homing', lead: lead.id, chaser: chaser.id, trailedS: +(trailed / 120).toFixed(2), homingHits: hitLead, leadItemAfter: lead.item });
  }
  // rocket shortcut
  const ai = g.systems.ai.debug;
  const sc = ai.shortcuts.findIndex((x, q) => ai.shortcutOk[q]);
  if (sc >= 0) {
    const S = ai.shortcuts[sc];
    const k = cpuAtPlace(6);
    const N = t.sampleCount;
    const trial = (withRocket) => {
      const i0 = (S.i - 60 + N) % N;
      kk.teleport(k.index, i0 / N, ai.lineLat[i0]);
      k.vel.set(Math.sin(k.heading) * 24, 0, Math.cos(k.heading) * 24);
      k.speed = 24;
      if (withRocket) kk.giveItem(k.index, 'rocket'); else { k.item = null; k.itemCount = 0; }
      let resp = 0, maxOff = 0, tReach = null;
      const un3 = g.events.tap((name, p) => { if (name === 'respawn' && p.kart === k && p.stage === 'lift') resp++; });
      const t0 = g.raceTime;
      for (let n = 0; n < 12 * 120; n++) {
        kk.simulate(g.config.STEP);
        if (!k.trackInfo.onRoad) maxOff = Math.max(maxOff, Math.abs(k.trackInfo.lateral) - k.trackInfo.halfWidth);
        const di = (k.trackInfo.index - (S.j + 30) + N) % N;
        if (di < 40) { tReach = +(g.raceTime - t0).toFixed(2); break; }
      }
      un3();
      return { tToExitPlus30m: tReach, maxOffroad: +maxOff.toFixed(1), respawns: resp };
    };
    out.tests.push({ item: 'rocket shortcut', shortcut: sc, gap: +S.gap.toFixed(1), saving: +S.saving.toFixed(0), withRocket: trial(true), withoutRocket: trial(false) });
  } else out.tests.push({ item: 'rocket shortcut', note: 'no usable shortcut on this track', shortcutOk: ai.shortcutOk });
  untap();
  g.loop.start();
  g.api.quitToTitle();
  return out;
}

// Listeners and GPU memory across two races.
async function pageLeak(o) {
  const kk = window.__kk;
  const g = kk.game;
  const before = kk.memory();
  for (let r = 0; r < 2; r++) {
    await kk.startRace({ track: o.tracks[r % o.tracks.length], laps: 1, seed: 30 + r, autopilot: true, skipIntro: true, mode: 'single' });
    kk.simulate(8);
    kk.renderFrame();
    g.api.quitToTitle();
  }
  const after = kk.memory();
  return { before, after, leaks: kk.leaks(), errors: kk.errors.slice() };
}

// ------------------------------------------------------------------------------------------------
let server = null;
let browser = null;
const log = (...m) => console.error('[ai]', ...m);
try {
  fs.mkdirSync(OUT, { recursive: true });
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await new Promise((r) => setTimeout(r, 100));
  }
  const l = await launch();
  browser = l.browser;
  log('renderer', l.renderer);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => log('pageerror', e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__kk && window.__kk.ready, null, { timeout: 30000 });
  const ids = await page.evaluate(pageSetup, { staged });
  if (Object.keys(tweak).length) {
    const before = await page.evaluate((tw) => {
      const K = window.__kk.game.config.kart;
      const old = {};
      for (const k in tw) { old[k] = K[k]; K[k] = tw[k]; }
      return old;
    }, tweak);
    log('tweak', JSON.stringify(tweak), 'was', JSON.stringify(before));
  }
  const tracks = trackArg ? trackArg.split(',') : ids;
  log('tracks', tracks.join(','));

  if (mode === 'checks' || mode === 'all') {
    const r = await page.evaluate(pageChecks, { tracks });
    console.log('DETERMINISM', JSON.stringify(r.determinism));
    for (const c of r.classes) console.log('CLASS', JSON.stringify(c));
    for (const c of r.tt) console.log('TT', JSON.stringify(c));
  }

  if (mode === 'recovery' || mode === 'all') {
    for (const track of tracks) {
      const r = await page.evaluate(pageRecovery, { track });
      for (const x of r) console.log('RECOVERY', track, JSON.stringify(x));
    }
  }

  if (mode === 'items' || mode === 'all') {
    for (const track of tracks) {
      const r = await page.evaluate(pageItems, { track });
      console.log('ITEMS', track, 'module', r.module);
      for (const x of r.tests) console.log('  ', JSON.stringify(x));
    }
  }

  if (mode === 'leak' || mode === 'all') {
    const r = await page.evaluate(pageLeak, { tracks });
    console.log('LEAK', JSON.stringify(r));
  }

  if (mode === 'alloc') {
    // Heap sampling over 30 s of racing through simulate(): bytes attributed to each source file.
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate(async (track) => {
      const kk = window.__kk;
      await kk.startRace({ track, laps: 3, seed: 9, autopilot: true, skipIntro: true, mode: 'single' });
      kk.game.loop.stop();
      kk.simulate(6);
    }, tracks[0]);
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.startSampling', { samplingInterval: 512 });
    await page.evaluate(() => { for (let i = 0; i < 30; i++) window.__kk.simulate(1); });
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    const byFile = {};
    const byFn = {};
    (function walk(n) {
      const url = (n.callFrame.url || '').replace(/^.*\/src\//, 'src/');
      if (n.selfSize) {
        byFile[url || '(native)'] = (byFile[url || '(native)'] || 0) + n.selfSize;
        if (url.includes('ai/ai.js')) { const f = `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber + 1}`; byFn[f] = (byFn[f] || 0) + n.selfSize; }
      }
      for (const c of n.children || []) walk(c);
    })(profile.head);
    console.log('ALLOC bytes by file (30 s, 8 karts):', JSON.stringify(Object.fromEntries(Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 12))));
    console.log('ALLOC ai.js by function:', JSON.stringify(byFn));
    await page.evaluate(() => { const g = window.__kk.game; g.loop.start(); g.api.quitToTitle(); });
  }

  if (mode === 'solo') {
    for (const track of tracks) {
      const r = await page.evaluate(pageSolo, { track, seed: seeds[0], laps, cls, tune: tuneArg });
      const sum = (a) => a.reduce((x, y) => x + y, 0).toFixed(2);
      console.log(`${track.padEnd(10)} drift ${r.drift.laps.join(',')} = ${sum(r.drift.laps)} rel ${JSON.stringify(r.drift.rel)} | nodrift ${r.nodrift.laps.join(',')} = ${sum(r.nodrift.laps)}`);
      for (const v of ['drift', 'nodrift']) { const x = r[v]; console.log(`   ${v}: drift[s,v/top] ${x.drift} air ${x.air} ground ${x.ground} brake ${x.brakeS}s lift ${x.liftS}s offroad ${x.offroadS}s`); }
      if (process.argv.includes('--bins')) {
        const a = r.drift, b = r.nodrift;
        for (let i = 0; i < a.binT.length; i++) {
          const dt = a.binT[i] - b.binT[i];
          if (Math.abs(dt) > 0.08) console.log(`   bin ${i * 20}m: drift ${a.binT[i]}s lat ${a.binLat[i]} dr ${a.binDrift[i]} | nodrift ${b.binT[i]}s lat ${b.binLat[i]} | +${dt.toFixed(2)}`);
        }
      }
    }
  }

  if (mode === 'drifts') {
    for (const track of tracks) {
      const r = await page.evaluate(pageDrifts, { track, seed: seeds[0], laps, cls, seconds: +arg('seconds', 150), tune: tuneArg });
      console.log(`== ${track} len ${Math.round(r.lapLen)} drifts ${r.drifts.length}`);
      r.corners.forEach((c, ci) => {
        const ds = r.drifts.filter((x) => x.corner === ci);
        if (!ds.length) { console.log(`  c${ci} ${c.dir > 0 ? 'R' : 'L'}${c.turnDeg} arc ${Math.round(c.arc)}: no drifts`); return; }
        const tiers = [0, 0, 0, 0];
        const reasons = {};
        for (const x of ds) { tiers[x.tier]++; reasons[x.reason] = (reasons[x.reason] || 0) + 1; }
        const mTurn = Math.round(ds.reduce((a, x) => a + x.turnDeg, 0) / ds.length);
        const mT = (ds.reduce((a, x) => a + x.t, 0) / ds.length).toFixed(2);
        console.log(`  c${ci} ${c.dir > 0 ? 'R' : 'L'}${c.turnDeg} arc ${Math.round(c.arc)}: n ${ds.length} tiers ${tiers.join('/')} turn ${mTurn} t ${mT} ${JSON.stringify(reasons)}`);
      });
      if (process.argv.includes('--verbose')) for (const x of r.drifts) console.log('   ', JSON.stringify(x));
    }
  }

  if (mode === 'metrics' || mode === 'all') {
    const rows = [];
    for (const track of tracks) {
      for (const seed of seeds) {
        const r = await page.evaluate(pageRace, { track, seed, laps, cls, noItems, tune: tuneArg });
        rows.push(r);
        if (jsonOut) console.log(JSON.stringify(r));
        else {
          const cpuLine = r.per.map((p) => `${p.player ? '*' : ''}${p.id}:${p.place}/${p.time ?? 'dnf'}/d${p.t2 + p.t3}/r${p.respawns}/w${p.wallHits}/h${p.hits}/i${p.items}`).join(' ');
          console.log(`${track.padEnd(12)} s${seed} len ${r.lapLen} | AP P${r.playerPlace} laps ${r.playerLaps.join(',')} | spread ${r.spread} fin ${r.cpuFinished}/7 (≤12s ${r.within12}) | t2/lap/cpu ${r.t2PerLapPerCpu} (min ${r.minT2PerLap}) | places ${r.placeChanges} | resp ${r.respawns} wall ${r.wallHits}/${r.hardWall} hits ${r.hits} items/cpu ${r.itemUsesPerCpu} | ai ${r.aiUsPerStep}us | err ${r.errors}`);
          console.log('   ' + cpuLine);
        }
      }
    }
    const sum = {
      races: rows.length,
      lapOut: rows.flatMap((r) => r.playerLaps).filter((t) => cls === '120' && (t < 38 || t > 58)).length,
      spreadOver25: rows.filter((r) => r.spread == null || r.spread > 25).length,
      t2Under2: rows.filter((r) => r.t2PerLapPerCpu < 2).length,
      placesUnder15: rows.filter((r) => r.placeChanges < 15).length,
      notAllFinished: rows.filter((r) => !r.allFinished).length,
      apTop4: rows.filter((r) => r.playerPlace <= 4).length,
      respawnsMean: +(rows.reduce((a, r) => a + r.respawns, 0) / rows.length).toFixed(2),
      errors: rows.reduce((a, r) => Math.max(a, r.errors), 0),
    };
    console.log('SUMMARY ' + JSON.stringify(sum));
  }
} catch (e) {
  log('failed', e && e.stack || e);
  process.exitCode = 1;
} finally {
  try { if (browser) await browser.close(); } catch { /* closed */ }
  if (server) server.kill();
}
