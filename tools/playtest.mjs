// Automated autopilot playtest (ARCHITECTURE.md §17).
// node tools/playtest.mjs [--port 8765] [--tracks all|meadow,...] [--laps 3] [--seed 1] [--shots|--no-shots] [--cls 120] [--uncapped]
// --uncapped disables vsync and the frame-rate limit so fpsMean shows headroom instead of the 60 Hz cap.
// Prints one JSON line per track; exits 1 if a track does not finish, logs errors, leaks, or renders in software.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, SOFTWARE_RE } from './pw.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'tools', 'out');

function parseArgs(argv) {
  const a = { port: 8765, tracks: 'all', laps: 3, seed: 1, shots: true, cls: '120', fpsWindow: 10, timeScale: 4, uncapped: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--port') { a.port = +v; i++; }
    else if (k === '--tracks') { a.tracks = v; i++; }
    else if (k === '--laps') { a.laps = +v; i++; }
    else if (k === '--seed') { a.seed = +v; i++; }
    else if (k === '--cls') { a.cls = String(v); i++; }
    else if (k === '--fps-window') { a.fpsWindow = +v; i++; }
    else if (k === '--time-scale') { a.timeScale = +v; i++; }
    else if (k === '--shots') a.shots = true;
    else if (k === '--no-shots') a.shots = false;
    else if (k === '--uncapped') a.uncapped = true;
  }
  return a;
}

function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

async function startServer(port) {
  const child = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 50; i++) {
    if (await portInUse(port)) return child;
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error(`serve.py did not start on port ${port}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runTrack(page, trackId, args, log) {
  const shots = [];
  const shot = async (name) => {
    if (!args.shots) return;
    const file = path.join(OUT, `${trackId}-${name}.png`);
    await page.screenshot({ path: file });
    shots.push(path.relative(ROOT, file).replace(/\\/g, '/'));
  };
  const before = await page.evaluate(() => ({ e: window.__kk.errors.length, w: window.__kk.warnings.length }));
  await page.evaluate(async (o) => {
    window.__kk.setAutoPause(false);
    window.__kk.setTimeScale(1);
    await window.__kk.startRace(o);
  }, { track: trackId, laps: args.laps, seed: args.seed, autopilot: true, skipIntro: true, mode: 'single', cls: args.cls });

  await sleep(1300);
  await shot('countdown');
  await page.waitForFunction(() => window.__kk.game.phase === 'race', null, { timeout: 15000 });

  // fps from a separate real-time window at timeScale 1
  await sleep(args.fpsWindow * 1000 + 200);
  const perf = await page.evaluate(() => window.__kk.perf());

  await page.evaluate((ts) => window.__kk.setTimeScale(ts), args.timeScale);
  let tookMid = false, tookDrift = false, tookFinish = false;
  const deadline = Date.now() + (args.laps * 100 / args.timeScale + 60) * 1000;
  let st;
  for (;;) {
    st = await page.evaluate(() => {
      const s = window.__kk.state();
      return { phase: s.phase, raceTime: s.raceTime, lap: s.player?.lap, drift: s.player?.drift, finished: s.player?.finished };
    });
    if (!tookDrift && st.drift && st.drift.active && st.drift.tier >= 1) {
      await page.evaluate(() => window.__kk.setTimeScale(1));
      await sleep(120);
      await shot('drift');
      tookDrift = true;
      await page.evaluate((ts) => window.__kk.setTimeScale(ts), args.timeScale);
    }
    if (!tookMid && st.lap >= 2 && st.phase === 'race') { await shot('mid'); tookMid = true; }
    if (!tookFinish && (st.phase === 'finishing' || st.phase === 'results')) {
      await page.evaluate(() => window.__kk.setTimeScale(1));
      await sleep(250);
      await shot('finish');
      tookFinish = true;
      await page.evaluate((ts) => window.__kk.setTimeScale(ts), args.timeScale);
    }
    if (st.phase === 'results') break;
    if (Date.now() > deadline) { log(`timeout on ${trackId} at raceTime ${st.raceTime}`); break; }
    await sleep(250);
  }
  await page.evaluate(() => window.__kk.setTimeScale(1));
  if (st.phase === 'results') { await sleep(400); await shot('results'); }

  const data = await page.evaluate(() => {
    const kk = window.__kk;
    const s = kk.state();
    return { state: s, stats: kk.stats(), results: s.race?.results || null, errors: kk.errors.slice(), warnings: kk.warnings.slice() };
  });
  const errors = data.errors.slice(before.e);
  const layout = data.warnings.slice(before.w).filter((w) => w.startsWith(`[track:${trackId}]`));
  const player = data.state.player;
  const results = data.results || [];
  const cpuResults = results.filter((r) => r.kartId !== player.id);
  const cpuTimes = cpuResults.map((r) => r.time).filter((t) => t != null);
  const cpuIds = data.state.karts.filter((k) => !k.isPlayer).map((k) => k.id);
  const laps = args.laps;
  let t2 = 0, items = 0;
  for (const id of cpuIds) {
    const r = data.stats.driftReleases[id] || { t2: 0, t3: 0 };
    t2 += (r.t2 || 0) + (r.t3 || 0);
    items += data.stats.itemUses[id] || 0;
  }
  const n = Math.max(1, cpuIds.length);
  const line = {
    track: trackId,
    finished: data.state.phase === 'results' && !!player.finished && !results.find((r) => r.kartId === player.id)?.estimated,
    raceTime: player.finishTime != null ? +player.finishTime.toFixed(2) : null,
    lapTimes: player.lapTimes.map((t) => +t.toFixed(2)),
    errors: errors.length,
    warnings: layout.length,
    fpsMean: perf.fps,
    frameMsP95: perf.frameMsP95,
    drawCalls: perf.drawCalls,
    shadowCalls: perf.shadowCalls,
    triangles: perf.triangles,
    renderer: perf.renderer,
    winnerToLastSpread: cpuTimes.length ? +(Math.max(...cpuTimes) - Math.min(...cpuTimes)).toFixed(2) : null,
    placeChanges: data.stats.placeChanges,
    driftTier2PerLapPerCpu: +(t2 / laps / n).toFixed(2),
    itemUsesPerCpu: +(items / n).toFixed(2),
    autopilotPlace: player.place,
    quality: perf.quality,
    shots,
    errorSamples: errors.slice(0, 5),
    layoutWarnings: layout,
  };
  const rangeWarnings = [];
  if (args.cls === '120') for (const [i, t] of line.lapTimes.entries()) if (t < 38 || t > 58) rangeWarnings.push(`lap ${i + 1} ${t}s outside 38–58`);
  if (line.winnerToLastSpread != null && line.winnerToLastSpread > 25) rangeWarnings.push(`CPU winner-to-last ${line.winnerToLastSpread}s > 25`);
  if (line.driftTier2PerLapPerCpu < 2) rangeWarnings.push(`tier-2+ drifts per lap per CPU ${line.driftTier2PerLapPerCpu} < 2`);
  if (line.placeChanges < 15) rangeWarnings.push(`place changes ${line.placeChanges} < 15`);
  if (line.itemUsesPerCpu < 4) rangeWarnings.push(`item uses per CPU ${line.itemUsesPerCpu} < 4`);
  if (line.warnings > 0) rangeWarnings.push(`${line.warnings} trackBuilder layout warnings`);
  line.rangeWarnings = rangeWarnings;
  return line;
}

async function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(OUT, { recursive: true });
  const log = (...m) => console.error('[playtest]', ...m);
  let server = null;
  let browser = null;
  let exitCode = 0;
  const cleanup = async () => {
    try { if (browser) await browser.close(); } catch { /* already closed */ }
    browser = null;
    if (server) { server.kill(); server = null; }
  };
  process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

  try {
    if (!(await portInUse(args.port))) { server = await startServer(args.port); log(`started serve.py on ${args.port}`); }
    else log(`using the server already on ${args.port}`);
    const l = await launch({ extraArgs: args.uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [] });
    browser = l.browser;
    log(`browser ${l.mode}; flags: ${l.flags.join(' ')}`);
    log(`renderer: ${l.renderer}`);
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`http://127.0.0.1:${args.port}/`);
    await page.waitForFunction(() => window.__kk && window.__kk.ready, null, { timeout: 30000 });
    const available = await page.evaluate(() => window.__kk.game.gp.cup.slice());
    const tracks = args.tracks === 'all' ? available : args.tracks.split(',').map((s) => s.trim()).filter(Boolean);
    const bootErrors = await page.evaluate(() => window.__kk.errors.slice());
    if (bootErrors.length) { log('boot errors:', bootErrors); exitCode = 1; }

    const lines = [];
    for (const id of tracks) {
      const line = await runTrack(page, id, args, log);
      lines.push(line);
      console.log(JSON.stringify(line));
      await page.evaluate(() => window.__kk.game.api.quitToTitle());
    }

    // Leak probe: a second race on the first track, then back to the title; compare with the first teardown.
    const probe = await page.evaluate(async (o) => {
      const kk = window.__kk;
      const first = kk.memory();
      await kk.startRace(o);
      kk.simulate(6);
      kk.renderFrame();
      kk.game.api.quitToTitle();
      const second = kk.memory();
      return { first, second, leaks: kk.leaks() };
    }, { track: tracks[0], laps: 1, seed: args.seed + 1, skipIntro: true, autopilot: true });
    const leak = probe.second.objects !== probe.first.objects || probe.second.geometries > probe.first.geometries ||
      probe.second.textures > probe.first.textures || probe.second.listeners !== probe.first.listeners || probe.leaks.leaks.length > 0;
    console.log(JSON.stringify({ leakProbe: { before: probe.first, after: probe.second, coreLeaks: probe.leaks.leaks, leak } }));

    const finalErrors = await page.evaluate(() => window.__kk.errors.slice());
    for (const line of lines) {
      if (!line.finished) { log(`${line.track}: did not finish`); exitCode = 1; }
      if (line.errors > 0) { log(`${line.track}: ${line.errors} errors`, line.errorSamples); exitCode = 1; }
      if (SOFTWARE_RE.test(line.renderer || '')) { log(`${line.track}: software renderer ${line.renderer}`); exitCode = 1; }
      for (const w of line.rangeWarnings) log(`${line.track}: warning: ${w}`);
    }
    if (leak) { log('leak detected', JSON.stringify(probe)); exitCode = 1; }
    if (finalErrors.length) { log('errors after leak probe:', finalErrors.slice(0, 5)); exitCode = 1; }
    const top4 = lines.filter((l) => l.autopilotPlace <= 4).length;
    if (lines.length >= 4 && top4 < 3) log(`warning: autopilot top 4 on only ${top4} of ${lines.length} tracks`);
  } catch (e) {
    log('failed:', e && e.stack || e);
    exitCode = 1;
  } finally {
    await cleanup();
  }
  process.exit(exitCode);
}

main();
