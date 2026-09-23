// Balance measurements (QA-1 #1 skill pace, #2 pack spread, #3 drift pay, #12 rocket shortcuts, #21 stats).
// Headless races through simulate(), no render; the race is held open so every CPU time is real.
// node tools/scenarios/balance.mjs [--port 8791] [--mode sim,tierpace,driftpay,chars,shortcut,drive|all]
//   [--seeds 9] [--tracks all|meadow,...] [--cls 120] [--set kart.yawHigh=1.0,kart.driftTiers=0.9/1.9/3.1]
//   [--roster ayi=4/1/2/5/3,...] [--tune releaseYaw=0.6] [--out file.json] [--quiet]
// --set paths are inside game.config (a/b/c = array); --roster sets speed/accel/handling/weight/offroad.
// Both are page-local what-ifs and are restored before the page closes.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const port = +arg('port', 8791);
const modes = String(arg('mode', 'sim')).split(',');
const want = (m) => modes.includes(m) || modes.includes('all');
const seedCount = +arg('seeds', 9);
const cls = String(arg('cls', '120'));
const trackArg = arg('tracks', 'all');
const quiet = process.argv.includes('--quiet');
const parseVal = (v) => (v.includes('/') ? v.split('/').map(Number) : Number.isNaN(Number(v)) ? v : Number(v));
const sets = String(arg('set', '')).split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, parseVal(v)]; });
const roster = String(arg('roster', '')).split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, v.split('/').map(Number)]; });
const tune = Object.fromEntries(String(arg('tune', '')).split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; }));

const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : NaN; };
const r2 = (x) => Math.round(x * 100) / 100;

// ------------------------------------------------------------------------------------------------
// page side

async function pageApply({ sets, roster }) {
  const g = window.__kk.game;
  const ch = await import('/src/characters/characters.js');
  window.__balRestore ||= [];
  for (const [p, v] of sets) {
    const keys = p.split('.');
    let o = g.config;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    const last = keys[keys.length - 1];
    window.__balRestore.push([o, last, o[last]]);
    o[last] = v;
  }
  const names = ['speed', 'accel', 'handling', 'weight', 'offroad'];
  for (const [id, vals] of roster) {
    const c = ch.ROSTER.find((x) => x.id === id);
    window.__balRestore.push([c, 'stats', c.stats]);
    c.stats = Object.fromEntries(names.map((n, i) => [n, vals[i]]));
  }
  return ch.ROSTER.map((c) => `${c.id}:${names.map((n) => c.stats[n]).join('/')}`).join(' ');
}

// Undo what pageApply did, newest first, down to `keep` entries (the command line's own what-ifs).
async function pageRestore(keep = 0) {
  const st = window.__balRestore || [];
  while (st.length > keep) { const [o, k, v] = st.pop(); o[k] = v; }
}

async function pageSimRace(o) {
  const kk = window.__kk, g = kk.game;
  kk.setAutoPause(false);
  await kk.startRace({ track: o.track, cls: o.cls, seed: o.seed, autopilot: true, skipIntro: true, mode: 'single', character: o.character || 'tilki', laps: 3 });
  g.loop.stop();
  const ai = g.systems.ai;
  Object.assign(ai.debug.tune, o.tune || {});
  const itemsSys = g.systems.items;
  if (o.noItems) g.systems.items = null; // diagnostic only: pace without items, restored before teardown
  const pairs = {};
  const ev = { bumps: 0, bumpsStart: 0, drafts: 0, walls: 0, respawns: 0, hits: 0, items: 0, leadChanges: 0, shortcuts: 0 };
  const rel = {}, hitBy = {}, used = {};
  let leader = null;
  const untap = g.events.tap((name, p) => {
    if (name === 'bump') { ev.bumps++; if (g.raceTime < 15) ev.bumpsStart++; const a = p.a.id, b = p.b.id; const key = a < b ? a + '-' + b : b + '-' + a; pairs[key] = (pairs[key] || 0) + 1; }
    else if (name === 'boost' && p.source === 'draft') ev.drafts++;
    else if (name === 'wallHit') ev.walls++;
    else if (name === 'respawn' && p.stage === 'lift') ev.respawns++;
    else if (name === 'hit') { ev.hits++; const h = (hitBy[p.kart.id] ||= {}); h[p.cause] = (h[p.cause] || 0) + 1; }
    else if (name === 'itemUse') { ev.items++; const u = (used[p.kart.id] ||= {}); u[p.item] = (u[p.item] || 0) + 1; }
    else if (name === 'drift' && p.state === 'release' && p.tier >= 2) rel[p.kart.id] = (rel[p.kart.id] || 0) + 1;
    else if (name === 'place' && p.place === 1 && p.kart !== leader) { if (leader) ev.leadChanges++; leader = p.kart; }
  });
  const skills = Object.fromEntries(ai.debug.drivers.map((d) => [d.id, d.skill]));
  const karts = g.karts.slice();
  let spreadSum = 0, n = 0;
  try {
    while (g.raceTime < 420) {
      kk.simulate(1);
      if (g.race && g.race.state === 'finishing') g.race.waitLeft = 1e9;
      const live = karts.filter((k) => !k.finished);
      if (live.length > 1 && g.race.state !== 'countdown') {
        let lo = Infinity, hi = -Infinity;
        for (const k of live) { lo = Math.min(lo, k.progress); hi = Math.max(hi, k.progress); }
        spreadSum += hi - lo; n++;
      }
      if (karts.every((k) => k.finished) || g.phase === 'results') break;
    }
    ev.shortcuts = ai.debug.shortcutTaken ? ai.debug.shortcutTaken.reduce((a, b) => a + b, 0) : null;
    const order = karts.slice().sort((a, b) => (a.finishTime ?? 1e9) - (b.finishTime ?? 1e9));
    const per = order.map((k, i) => ({ id: k.id, player: k.isPlayer, skill: k.isPlayer ? 'ap' : skills[k.id], place: i + 1, time: k.finishTime != null ? +k.finishTime.toFixed(2) : null, t2: rel[k.id] || 0, hits: hitBy[k.id] || {}, used: used[k.id] || {}, best: k.lapTimes.length ? +Math.min(...k.lapTimes).toFixed(2) : null }));
    const cpu = per.filter((p) => !p.player);
    const cpuT = cpu.map((p) => p.time).filter((t) => t != null);
    return {
      track: o.track, seed: o.seed, cls: o.cls,
      apPlace: per.find((p) => p.player).place, apTime: per.find((p) => p.player).time, apLaps: g.player.lapTimes.map((t) => +t.toFixed(2)),
      spread: cpuT.length === cpu.length ? +(Math.max(...cpuT) - Math.min(...cpuT)).toFixed(2) : null,
      allFinished: karts.every((k) => k.finished),
      placeChanges: g.race.placeChanges, meanProgSpread: +(spreadSum / Math.max(1, n)).toFixed(1),
      t2PerLapPerCpu: +(cpu.reduce((a, p) => a + p.t2, 0) / 3 / cpu.length).toFixed(2),
      t2MinCpu: +(Math.min(...cpu.map((p) => p.t2)) / 3).toFixed(2),
      ...ev, topPairs: Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 4), errors: kk.errors.length, per,
    };
  } finally {
    untap();
    g.systems.items = itemsSys;
    g.loop.start();
    g.api.quitToTitle();
  }
}

// QA tierpace.mjs: best laps by tier with the rubber band and slipstream off.
async function pageTierPace(o) {
  const kk = window.__kk, g = kk.game, acc = {};
  const rb0 = {}; for (const k in g.config.classes) rb0[k] = g.config.classes[k].rubberK;
  const dr0 = g.config.kart.draftRange;
  for (const k in g.config.classes) g.config.classes[k].rubberK = 0;
  g.config.kart.draftRange = 0;
  try {
    for (const track of o.tracks) for (const seed of [1, 2, 3]) {
      await kk.startRace({ mode: 'single', track, cls: '120', seed, skipIntro: true, autopilot: true, character: 'tilki' });
      g.loop.stop();
      const skills = Object.fromEntries(g.systems.ai.debug.drivers.map((d) => [d.id, d.skill]));
      for (let i = 0; i < 400 && g.phase !== 'results'; i++) { kk.simulate(1); if (g.race.state === 'finishing') g.race.waitLeft = 1e9; if (g.karts.every((k) => k.finished)) break; }
      for (const k of g.karts) {
        const s = k.isPlayer ? 'ap' : skills[k.id];
        if (!k.lapTimes.length) continue;
        (acc[track + ':' + s] ||= []).push(Math.min(...k.lapTimes));
      }
      g.loop.start();
      g.api.quitToTitle();
    }
  } finally {
    for (const k in g.config.classes) g.config.classes[k].rubberK = rb0[k];
    g.config.kart.draftRange = dr0;
  }
  const out = {};
  for (const [k, v] of Object.entries(acc)) out[k] = +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2);
  return out;
}

// QA driftpay.mjs (solo autopilot, seed 5, cpuCount 0, items live) plus a clean variant with items detached.
async function pageDriftPay(o) {
  const kk = window.__kk, g = kk.game;
  const res = {};
  for (const clean of [false, true]) for (const nd of [false, true]) {
    await kk.startRace({ track: o.track, cls: o.cls, seed: 5, autopilot: true, skipIntro: true, mode: 'single', cpuCount: 0, character: o.character || 'tilki' });
    g.loop.stop();
    Object.assign(g.systems.ai.debug.tune, o.tune || {});
    g.systems.ai.debug.noDrift = nd;
    g.player.item = null; g.player.itemCount = 0;
    const itemsSys = g.systems.items;
    if (clean) g.systems.items = null;
    const rel = { t1: 0, t2: 0, t3: 0 };
    let lift = 0, n = 0;
    const untap = g.events.tap((name, p) => { if (name === 'drift' && p.state === 'release' && p.tier >= 1) rel['t' + p.tier]++; });
    for (let i = 0; i < 4000 && g.phase !== 'results' && !g.player.finished; i++) {
      kk.simulate(0.1);
      if (g.phase === 'race') { n++; if (g.player.controls.throttle < 0.5 || g.player.controls.brake > 0) lift++; }
    }
    untap();
    g.systems.items = itemsSys;
    res[(clean ? 'clean_' : '') + (nd ? 'noDrift' : 'drift')] = { t: +(g.player.finishTime || -1).toFixed(2), rel, liftPct: Math.round(100 * lift / Math.max(1, n)) };
    g.loop.start();
    g.api.quitToTitle();
  }
  return res;
}

// Solo time trial per character (items detached, autopilot) and the autopilot's place in full races.
async function pageChar(o) {
  const kk = window.__kk, g = kk.game;
  await kk.startRace({ track: o.track, cls: o.cls, seed: 4, autopilot: true, skipIntro: true, mode: 'tt', character: o.character, laps: 3 });
  g.loop.stop();
  const itemsSys = g.systems.items;
  g.systems.items = null;
  for (let i = 0; i < 4000 && !g.player.finished; i++) kk.simulate(0.1);
  const solo = +(g.player.finishTime || -1).toFixed(2);
  g.systems.items = itemsSys;
  g.loop.start();
  g.api.quitToTitle();
  const places = [], times = [];
  for (const seed of o.seeds) {
    await kk.startRace({ track: o.track, cls: o.cls, seed, autopilot: true, skipIntro: true, mode: 'single', character: o.character, laps: 3 });
    g.loop.stop();
    for (let i = 0; i < 420 && !g.player.finished; i++) kk.simulate(1);
    places.push(g.player.place);
    times.push(g.player.finishTime);
    g.loop.start();
    g.api.quitToTitle();
  }
  return { solo, places, times };
}

// Rocket shortcuts: the AI's own verdict per shortcut, then a CPU given a rocket 60 m before the entry.
async function pageShortcut(o) {
  const kk = window.__kk, g = kk.game;
  await kk.startRace({ track: o.track, cls: '120', seed: o.seed || 5, autopilot: true, skipIntro: true, mode: 'single', character: 'tilki', cpuCount: 2 });
  g.loop.stop();
  Object.assign(g.systems.ai.debug.tune, o.tune || {});
  g.systems.ai.debug.reprobe();
  kk.simulate(24);
  const ai = g.systems.ai.debug, t = g.track, N = t.sampleCount;
  const out = { def: g.trackDef.shortcut || null, found: ai.shortcuts.map((x) => ({ t0: +x.t0.toFixed(3), t1: +x.t1.toFixed(3), gap: +x.gap.toFixed(1), saving: Math.round(x.saving) })), ok: ai.shortcutOk.slice(), probe: ai.shortcutProbe ? ai.shortcutProbe.slice() : null, trials: [] };
  const k = g.karts.find((x) => !x.isPlayer);
  const fq = t.createQueryInfo();
  for (let q = 0; q < ai.shortcuts.length; q++) {
    const S = ai.shortcuts[q];
    for (const withRocket of [true, false]) for (const v0 of withRocket ? [20, 24, 27] : [24]) for (const dl of withRocket ? [-3, 0, 3] : [0]) {
      const i0 = (S.i - 60 + N) % N;
      kk.teleport(k.index, i0 / N, ai.lineLat[i0] + dl);
      ai.resetDriver(k);
      k.vel.set(Math.sin(k.heading) * v0, 0, Math.cos(k.heading) * v0);
      k.speed = v0;
      k.item = withRocket ? 'rocket' : null; k.itemCount = withRocket ? 1 : 0; k.roulette = 0;
      let resp = 0, tReach = null, took = false, maxOut = 0, reachedFar = null;
      const un = g.events.tap((name, p) => { if (name === 'respawn' && p.kart === k && p.stage === 'lift') resp++; });
      const t0 = g.raceTime;
      for (let n = 0; n < 12 * 120 && !resp; n++) {
        if (!withRocket && k.item) { k.item = null; k.itemCount = 0; }
        kk.simulate(g.config.STEP);
        const d = ai.drivers.find((x) => x.id === k.id);
        if (d && d.mode === 3) took = true;
        maxOut = Math.max(maxOut, k.outTime || 0);
        if (reachedFar == null && took) { t.query(k.pos, -1, fq); if (fq.onRoad && Math.abs(fq.index - S.j) < 40) reachedFar = +(g.raceTime - t0).toFixed(2); }
        // a fixed point 80 m past the far end, on the road (beyond every aim point)
        const di = (k.trackInfo.index - (S.j + 80) + N) % N;
        if (di < 120 && k.trackInfo.onRoad) { tReach = +(g.raceTime - t0 - di * t.spacing / Math.max(10, k.speed)).toFixed(2); break; }
      }
      un();
      out.trials.push({ q, withRocket, v0, dl, took, reachedFar, tToExitPlus30: tReach, respawns: resp, maxOut: +maxOut.toFixed(2) });
    }
  }
  g.loop.start();
  g.api.quitToTitle();
  return out;
}

// Keyboard feel: the autopilot brings the kart up to a speed, then full digital steer (through the input
// path, so with the keyboard ramp) is held 0.4 s towards the road centre: peak yaw rate, time to 90% of
// it and the radius it drives.
async function pageDrive(o) {
  const kk = window.__kk, g = kk.game;
  await kk.startRace({ track: o.track, cls: o.cls, seed: 1, autopilot: true, skipIntro: true, mode: 'tt', character: o.character || 'tilki' });
  g.loop.stop();
  const k = g.player, STEP = g.config.STEP;
  const out = [];
  while (g.race.state === 'countdown') kk.simulate(STEP);
  for (const [label, target, at] of [['low', 8, 0.05], ['mid', 15, 0.3], ['top', 99, 0.6]]) {
    k.teleport(at, 0, false);
    k.autopilot = true;
    for (let i = 0; i < 12 * 120; i++) {
      kk.simulate(STEP);
      if (k.speed >= Math.min(target, k.topSpeed * 0.985) - 0.2) break;
    }
    k.autopilot = false;
    const v0 = k.speed;
    const dir = k.trackInfo.lateral > 0 ? -1 : 1;
    const yaws = [];
    let h = k.heading;
    for (let i = 1; i <= 0.4 * 120; i++) {
      kk.setControls({ throttle: target < 99 ? (k.speed < target ? 1 : 0) : 1, steer: dir, drift: false, brake: 0 });
      kk.simulate(STEP);
      let dh = h - k.heading; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      h = k.heading;
      yaws.push(dir * dh / STEP);
    }
    kk.setControls(null);
    const peak = Math.max(...yaws);
    const t90 = (yaws.findIndex((y) => y >= 0.9 * peak) + 1) * STEP;
    out.push({ label, speed: +v0.toFixed(1), yawPeak: +peak.toFixed(2), t90: +t90.toFixed(3), radius: +(v0 / Math.max(1e-3, peak)).toFixed(1), wall: k.wallContact });
  }
  k.autopilot = true;
  g.loop.start();
  g.api.quitToTitle();
  return out;
}

// Every drift of the solo autopilot (items detached) for one lap-3 race, with the corner it belongs to.
async function pageDriftLog(o) {
  const kk = window.__kk, g = kk.game;
  await kk.startRace({ track: o.track, cls: o.cls, seed: 5, autopilot: true, skipIntro: true, mode: 'tt', character: o.character || 'tilki', laps: 3 });
  g.loop.stop();
  const ai = g.systems.ai;
  Object.assign(ai.debug.tune, o.tune || {});
  const itemsSys = g.systems.items;
  g.systems.items = null;
  ai.debug.log = true;
  for (let i = 0; i < 4000 && !g.player.finished; i++) kk.simulate(0.1);
  const drifts = ai.debug.drifts.slice();
  const corners = ai.debug.corners;
  const time = g.player.finishTime;
  g.systems.items = itemsSys;
  g.loop.start();
  g.api.quitToTitle();
  return { corners, drifts, time };
}

// ------------------------------------------------------------------------------------------------
let server = null;
let browser = null;
const report = { args: process.argv.slice(2) };
const log = (...m) => { if (!quiet) console.error('[balance]', ...m); };
try {
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await new Promise((r) => setTimeout(r, 100));
  }
  const l = await launch();
  browser = l.browser;
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', (e) => log('pageerror', e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__kk && window.__kk.ready, null, { timeout: 30000 });
  report.roster = await page.evaluate(pageApply, { sets, roster });
  if (sets.length || roster.length) log('what-if', JSON.stringify(sets), JSON.stringify(roster));
  const cup = await page.evaluate(() => window.__kk.game.gp.cup.slice());
  const tracks = trackArg === 'all' ? cup : trackArg.split(',');
  const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);

  if (want('sim')) {
    const rows = [];
    for (const track of tracks) for (const seed of seeds) {
      const r = await page.evaluate(pageSimRace, { track, seed, cls, tune, noItems: process.argv.includes('--noitems') });
      rows.push(r);
      if (!quiet) console.log(`${track.padEnd(10)} s${seed} AP P${r.apPlace} ${r.apLaps.join(',')} | spread ${r.spread} | places ${r.placeChanges} lead ${r.leadChanges} bumps ${r.bumps} drafts ${r.drafts} | t2/lap/cpu ${r.t2PerLapPerCpu} min ${r.t2MinCpu} | sc ${r.shortcuts} resp ${r.respawns} | ${r.per.map((p) => `${p.player ? '*' : ''}${p.id}(${p.skill})`).join(' ')}`);
    }
    const tier = {};
    for (const r of rows) for (const p of r.per) (tier[p.skill] ||= []).push(p.place);
    const byTrack = {};
    for (const r of rows) {
      const b = (byTrack[r.track] ||= { apPlaces: [], t2: [], t2min: [], spread: [] });
      b.apPlaces.push(r.apPlace); b.t2.push(r.t2PerLapPerCpu); b.t2min.push(r.t2MinCpu); b.spread.push(r.spread);
    }
    const spreads = rows.map((r) => r.spread).filter((x) => x != null);
    const sum = {
      races: rows.length, cls,
      tierMeanPlace: Object.fromEntries(Object.entries(tier).map(([k, v]) => [k, r2(mean(v))])),
      apMeanPlace: r2(mean(rows.map((r) => r.apPlace))),
      apTop4Tracks: Object.values(byTrack).filter((b) => b.apPlaces.filter((p) => p <= 4).length > b.apPlaces.length / 2).length,
      spread: { median: r2(median(spreads)), mean: r2(mean(spreads)), min: r2(Math.min(...spreads)), max: r2(Math.max(...spreads)) },
      bumps: r2(mean(rows.map((r) => r.bumps))), placeChanges: r2(mean(rows.map((r) => r.placeChanges))),
      leadChanges: r2(mean(rows.map((r) => r.leadChanges))), drafts: r2(mean(rows.map((r) => r.drafts))),
      meanProgSpread: r2(mean(rows.map((r) => r.meanProgSpread))),
      respawns: r2(mean(rows.map((r) => r.respawns))), shortcuts: r2(mean(rows.map((r) => r.shortcuts ?? 0))),
      notAllFinished: rows.filter((r) => !r.allFinished).length, errors: Math.max(...rows.map((r) => r.errors)),
      byTrack: Object.fromEntries(Object.entries(byTrack).map(([t, b]) => [t, { apMeanPlace: r2(mean(b.apPlaces)), apTop4: `${b.apPlaces.filter((p) => p <= 4).length}/${b.apPlaces.length}`, t2PerLapPerCpu: r2(mean(b.t2)), t2MinCpu: r2(Math.min(...b.t2min)), spreadMedian: r2(median(b.spread.filter((x) => x != null))) }])),
    };
    report.sim = { summary: sum, rows };
    console.log('SIM ' + JSON.stringify(sum));
  }

  if (want('tierpace')) {
    const r = await page.evaluate(pageTierPace, { tracks });
    report.tierpace = r;
    console.log('TIERPACE ' + JSON.stringify(r));
  }

  if (want('driftpay')) {
    report.driftpay = {};
    for (const track of tracks) for (const c of String(arg('dpcls', '120,200')).split(',')) {
      const r = await page.evaluate(pageDriftPay, { track, cls: c, tune });
      const pct = (a, b) => r2(100 * (b.t - a.t) / b.t);
      r.gainPct = pct(r.drift, r.noDrift);
      r.cleanGainPct = pct(r.clean_drift, r.clean_noDrift);
      report.driftpay[track + ':' + c] = r;
      console.log('DRIFTPAY', track, c, JSON.stringify(r));
    }
  }

  if (want('chars')) {
    const ids = await page.evaluate(async () => (await import('/src/characters/characters.js')).ROSTER.map((c) => c.id));
    const cseeds = seeds.slice(0, Math.min(seeds.length, +arg('charseeds', 6)));
    const res = {};
    for (const id of ids) {
      res[id] = { solo: {}, places: [], times: [] };
      for (const track of tracks) {
        const r = await page.evaluate(pageChar, { track, cls, character: id, seeds: cseeds });
        res[id].solo[track] = r.solo;
        res[id].places.push(...r.places);
        res[id].times.push(...r.times);
      }
    }
    // per race: solo time and race time against the roster mean on the same track (s per race)
    const soloMean = {}, raceMean = {};
    for (const track of tracks) soloMean[track] = mean(ids.map((id) => res[id].solo[track]));
    const allRace = mean(ids.map((id) => mean(res[id].times)));
    for (const id of ids) {
      res[id].soloVsMean = r2(mean(tracks.map((t) => res[id].solo[t] - soloMean[t])));
      res[id].raceVsMean = r2(mean(res[id].times) - allRace);
      res[id].meanPlace = r2(mean(res[id].places));
      console.log('CHAR', id.padEnd(8), 'solo', tracks.map((t) => res[id].solo[t]).join(' '), '| solo vs roster', res[id].soloVsMean, 's/race | race vs roster', res[id].raceVsMean, 's | place', res[id].meanPlace);
    }
    report.chars = res;
  }

  if (want('statvalue')) {
    // what one point of each stat is worth: tilki solo (items off), 3/3/3/3/3 against one stat at 2 and 4
    const names = ['speed', 'accel', 'handling', 'weight', 'offroad'];
    const variants = [['base', [3, 3, 3, 3, 3]]];
    for (let n = 0; n < 5; n++) for (const v of [2, 4]) { const st = [3, 3, 3, 3, 3]; st[n] = v; variants.push([names[n] + v, st]); }
    const res = {};
    for (const [label, st] of variants) {
      const keep = await page.evaluate(() => window.__balRestore.length);
      await page.evaluate(pageApply, { sets: [], roster: [['tilki', st]] });
      let tot = 0;
      const per = {};
      for (const track of tracks) {
        const r = await page.evaluate(pageChar, { track, cls, character: 'tilki', seeds: [] });
        per[track] = r.solo; tot += r.solo;
      }
      await page.evaluate(pageRestore, keep);
      res[label] = { total: r2(tot), per };
    }
    for (const [label, r] of Object.entries(res)) console.log('STAT', label.padEnd(10), 'total', r.total, 'vs base', r2(r.total - res.base.total), JSON.stringify(r.per));
    report.statvalue = res;
  }

  if (want('statrace')) {
    // the same stat points in full races (items, 7 CPUs): the autopilot's mean finish time and place
    const names = ['speed', 'accel', 'handling', 'weight', 'offroad'];
    const variants = [['base', [3, 3, 3, 3, 3]]];
    for (let n = 0; n < 5; n++) { const st = [3, 3, 3, 3, 3]; st[n] = 5; variants.push([names[n] + 5, st]); }
    const res = {};
    for (const [label, st] of variants) {
      const keep = await page.evaluate(() => window.__balRestore.length);
      await page.evaluate(pageApply, { sets: [], roster: [['tilki', st]] });
      const times = [], places = [];
      for (const track of tracks) for (const seed of seeds) {
        const r = await page.evaluate(pageSimRace, { track, seed, cls, tune });
        times.push(r.apTime); places.push(r.apPlace);
      }
      await page.evaluate(pageRestore, keep);
      res[label] = { meanTime: r2(mean(times)), meanPlace: r2(mean(places)) };
      console.log('STATRACE', label.padEnd(10), JSON.stringify(res[label]), 'vs base', res.base ? r2(res[label].meanTime - res.base.meanTime) : 0);
    }
    report.statrace = res;
  }

  if (want('shortcut')) {
    report.shortcut = {};
    for (const track of tracks) {
      const r = await page.evaluate(pageShortcut, { track, tune });
      report.shortcut[track] = r;
      console.log('SHORTCUT', track, JSON.stringify(r));
    }
  }

  if (want('drive')) {
    report.drive = {};
    for (const track of tracks.slice(0, 1)) {
      const r = await page.evaluate(pageDrive, { track, cls });
      report.drive[track] = r;
      console.log('DRIVE', track, JSON.stringify(r));
    }
  }

  if (want('driftlog')) {
    for (const track of tracks) {
      const r = await page.evaluate(pageDriftLog, { track, cls, tune });
      console.log(`== ${track} ${r.time && r.time.toFixed(2)} drifts ${r.drifts.length}`);
      if (process.argv.includes('--verbose')) for (const x of r.drifts) console.log('   ', JSON.stringify(x));
      r.corners.forEach((c, ci) => {
        const ds = r.drifts.filter((x) => x.corner === ci);
        console.log(`  c${ci} ${c.dir > 0 ? 'R' : 'L'}${c.turnDeg} arc ${Math.round(c.arc)}: ` + (ds.length ? ds.map((x) => `T${x.tier}/${x.charge}c/${x.t}s/${x.turnDeg}deg/${x.reason}`).join('  ') : '-'));
      });
    }
  }

  if (want('keys')) {
    // Real keyboard events in real time (timeScale 1): a plain line-following bot that holds arrow keys and
    // Space the way a mid-skill player would, one lap per track. A sanity check of the steering feel
    // after the yaw/drift changes: the lap completes, no wall lock-ups or respawns, drifts reach tiers.
    report.keys = {};
    for (const track of tracks.slice(0, +arg('keytracks', 2))) {
      await page.evaluate(async (o) => {
        const kk = window.__kk;
        kk.setTimeScale(1);
        await kk.startRace({ track: o.track, cls: o.cls, laps: 1, seed: 3, autopilot: false, skipIntro: true, mode: 'tt', character: 'tilki' });
        const g = kk.game;
        window.__keyStats = { walls: 0, hardWalls: 0, respawns: 0, tiers: [0, 0, 0, 0], offroad: 0, ticks: 0, vmax: 0 };
        window.__keyOff = g.events.tap((n, p) => {
          if (!p || p.kart !== g.player) return;
          if (n === 'wallHit') { window.__keyStats.walls++; if (p.angle > Math.PI / 4) window.__keyStats.hardWalls++; }
          else if (n === 'respawn' && p.stage === 'lift') window.__keyStats.respawns++;
          else if (n === 'drift' && p.state === 'release') window.__keyStats.tiers[p.tier]++;
        });
      }, { track, cls });
      const held = new Set();
      const t0 = Date.now();
      let st = null;
      for (;;) {
        st = await page.evaluate(() => {
          const g = window.__kk.game, k = g.player, t = g.track, s = t.samples, N = t.sampleCount, sp = t.spacing;
          const line = g.systems.ai && g.systems.ai.debug && g.systems.ai.debug.lineLat;
          const S = window.__keyStats;
          S.ticks++; if (k.surface !== 'road' && k.surface !== 'boost') S.offroad++; S.vmax = Math.max(S.vmax, k.speed);
          const i0 = k.trackInfo.index;
          const j = (i0 + Math.round(Math.max(9, k.speed * 0.55) / sp)) % N;
          const lat = line ? line[j] * 0.7 : 0;
          let diff = Math.atan2(s.px[j] + s.hx[j] * lat - k.pos.x, s.pz[j] + s.hz[j] * lat - k.pos.z) - k.heading;
          while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
          const a = (i0 + Math.round(6 / sp)) % N, b = (i0 + Math.round(40 / sp)) % N;
          let turn = s.heading[b] - s.heading[a]; while (turn > Math.PI) turn -= 2 * Math.PI; while (turn < -Math.PI) turn += 2 * Math.PI;
          const n = (i0 + Math.round(18 / sp)) % N;
          let near = s.heading[n] - s.heading[i0]; while (near > Math.PI) near -= 2 * Math.PI; while (near < -Math.PI) near += 2 * Math.PI;
          const w = window.__keyBot ||= { drift: false };
          if (!w.drift && Math.abs(turn) > 0.6 && k.speed > 13 && k.grounded) w.drift = true;
          else if (w.drift && (Math.abs(near) < 0.12 || k.speed < 8)) w.drift = false;
          const thr = w.drift ? 0.02 : 0.05;
          const keys = { ArrowUp: true, ArrowLeft: diff > thr, ArrowRight: diff < -thr, Space: w.drift };
          if (w.drift && !k.drift.active) { keys.ArrowLeft = turn > 0; keys.ArrowRight = turn < 0; }
          return { keys, phase: g.phase, finished: k.finished, lap: k.lap, raceTime: g.raceTime };
        });
        for (const [key, on] of Object.entries(st.keys)) {
          if (on && !held.has(key)) { await page.keyboard.down(key); held.add(key); }
          else if (!on && held.has(key)) { await page.keyboard.up(key); held.delete(key); }
        }
        if (st.finished || st.phase === 'results' || Date.now() - t0 > 150000) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      for (const key of held) await page.keyboard.up(key);
      const r = await page.evaluate(() => {
        const g = window.__kk.game, S = window.__keyStats;
        window.__keyOff(); window.__keyBot = null;
        const out = { finished: g.player.finished, lap: g.player.lapTimes.map((x) => +x.toFixed(2)), walls: S.walls, hardWalls: S.hardWalls, respawns: S.respawns, releases: { t1: S.tiers[1], t2: S.tiers[2], t3: S.tiers[3] }, offroadPct: Math.round(100 * S.offroad / Math.max(1, S.ticks)), vmax: +S.vmax.toFixed(1), errors: window.__kk.errors.length };
        g.api.quitToTitle();
        return out;
      });
      report.keys[track] = r;
      console.log('KEYS', track, JSON.stringify(r));
    }
  }

  await page.evaluate(pageRestore);
  const out = arg('out', null);
  if (out) { fs.mkdirSync(path.dirname(path.resolve(ROOT, out)), { recursive: true }); fs.writeFileSync(path.resolve(ROOT, out), JSON.stringify(report, null, 1)); }
} catch (e) {
  console.error('[balance] failed', e && e.stack || e);
  process.exitCode = 1;
} finally {
  try { if (browser) await browser.close(); } catch { /* closed */ }
  if (server) server.kill();
}
