// Low-end performance timeline: fps, quality level and render scale per second on the title and in a race,
// under software rendering (the school-PC case) and on the real GPU with a throttled CPU (the phone case).
// node tools/scenarios/lowend.mjs [--mode soft-1366,soft-phone,gpu-cpu6|all] [--port 8797] [--title 12]
//   [--race 20] [--track bosphorus] [--quality auto] [--levels minimal,low,...] [--shots tag]
// soft-1366:  SwiftShader, 1366x768, DPR 1
// soft-phone: SwiftShader, 915x412, DPR 2.6, touch (phone pixel counts in software)
// gpu-cpu6:   hardware ANGLE, CPU throttled x6, 915x412, DPR 2.6, touch
// Every mode starts a fresh context (empty storage, so quality is 'auto' unless --quality says otherwise).
// Title: seconds from the first title frame. Race: seconds from startRace (skipIntro); "settled" is the
// mean fps from 6 s after the phase was reached to the end of the segment. --levels adds a fixed-quality
// race measurement per level (5 s each) for a per-feature breakdown. Prints tables and one JSON line per mode.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GPU_FLAGS, STEADY_FLAGS, loadPlaywright } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const port = +arg('port', 8797);
const modeArg = String(arg('mode', 'all'));
const titleSec = +arg('title', 12);
const raceSec = +arg('race', 20);
const track = arg('track', 'bosphorus');
const quality = arg('quality', 'auto');
const levels = arg('levels', '') ? String(arg('levels', '')).split(',') : [];
const shotsTag = arg('shots', '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SOFT = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'];
const MODES = {
  'soft-1366': { args: SOFT, viewport: { width: 1366, height: 768 }, dpr: 1, touch: false, cpu: 1 },
  'soft-phone': { args: SOFT, viewport: { width: 915, height: 412 }, dpr: 2.6, touch: true, cpu: 1 },
  'gpu-cpu6': { args: GPU_FLAGS, viewport: { width: 915, height: 412 }, dpr: 2.6, touch: true, cpu: 6 },
};
const modes = modeArg === 'all' ? Object.keys(MODES) : modeArg.split(',');
for (const m of modes) if (!MODES[m]) { console.error(`unknown mode ${m}`); process.exit(2); }

const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

let server = null;
if (!(await inUse(port))) {
  server = spawn(process.platform === 'win32' ? 'python' : 'python3', [path.join(ROOT, 'tools', 'serve.py'), String(port)],
    { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 50 && !(await inUse(port)); i++) await sleep(100);
}

// One sample per animation frame, recorded in the page so the timeline costs no round trips.
const RECORDER = () => {
  window.__lowend = [];
  const rec = (now) => {
    const g = window.__kkGame;
    if (g && g.renderer && g.phase !== 'boot') {
      const c = g.renderer.domElement;
      window.__lowend.push([now, g.phase, g.quality, g.renderer.renderScale ?? 1, c.width, c.height]);
    }
    requestAnimationFrame(rec);
  };
  requestAnimationFrame(rec);
};

const takeFrames = (page) => page.evaluate(() => { const f = window.__lowend; window.__lowend = []; return f; });

// frames: [now, phase, quality, scale, w, h]; t0 in page ms
function timeline(frames, t0, t1) {
  const rows = [];
  for (let s = 0; t0 + s * 1000 < t1; s++) {
    const a = t0 + s * 1000, b = Math.min(t1, a + 1000);
    const f = frames.filter((x) => x[0] >= a && x[0] < b);
    if (!f.length) { rows.push({ t: s, fps: 0, phase: '-', q: '-', scale: '-', px: '-' }); continue; }
    const last = f[f.length - 1];
    rows.push({ t: s, fps: +(f.length * 1000 / (b - a)).toFixed(1), phase: last[1], q: last[2], scale: +(+last[3]).toFixed(2), px: `${last[4]}x${last[5]}` });
  }
  return rows;
}

function settle(frames, from, to) {
  const f = frames.filter((x) => x[0] >= from && x[0] < to);
  if (f.length < 2) return { fps: 0, frames: f.length };
  const last = f[f.length - 1];
  const fps = (f.length - 1) * 1000 / (f[f.length - 1][0] - f[0][0]);
  return { fps: +fps.toFixed(1), q: last[2], scale: +(+last[3]).toFixed(2), px: `${last[4]}x${last[5]}`, mp: +(last[4] * last[5] / 1e6).toFixed(2) };
}

const printRows = (label, rows) => {
  console.log(`  ${label}`);
  console.log('    t(s) | fps   | phase      | quality | scale | canvas');
  for (const r of rows) console.log(`    ${String(r.t).padStart(4)} | ${String(r.fps).padStart(5)} | ${String(r.phase).padEnd(10)} | ${String(r.q).padEnd(7)} | ${String(r.scale).padStart(5)} | ${r.px}`);
};

const { chromium } = loadPlaywright();
const results = [];
try {
  for (const mode of modes) {
    const M = MODES[mode];
    const browser = await chromium.launch({ headless: true, args: [...M.args, ...STEADY_FLAGS] });
    try {
      const context = await browser.newContext({ viewport: M.viewport, deviceScaleFactor: M.dpr, hasTouch: M.touch, isMobile: M.touch });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      if (quality !== 'auto') {
        await page.addInitScript((q) => { localStorage.setItem('kk1:settings', JSON.stringify({ quality: q })); }, quality);
      }
      await page.addInitScript(RECORDER);
      if (M.cpu > 1) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: M.cpu });
      }
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.waitForFunction(() => window.__kk && window.__kk.ready, null, { timeout: 180000 });
      const renderer = await page.evaluate(() => window.__kk.perf().renderer);

      // title: from the first recorded title frame
      await page.waitForFunction(() => (window.__lowend || []).length > 0, null, { timeout: 60000 });
      const tStart = await page.evaluate(() => window.__lowend[0][0]);
      await sleep(titleSec * 1000);
      const tf = await takeFrames(page);
      const tEnd = tf.length ? tf[tf.length - 1][0] : tStart;
      const titleRows = timeline(tf, tStart, tEnd);
      const titleSettled = settle(tf, tStart + 6000, tEnd + 1);
      const hint = await page.evaluate(() => {
        const el = document.querySelector('[data-kk-hint="hwaccel"]');
        return el ? el.textContent.trim() : null;
      });
      if (shotsTag) {
        const out = path.join(ROOT, 'tools', 'out', 'lowend', shotsTag);
        fs.mkdirSync(out, { recursive: true });
        await page.screenshot({ path: path.join(out, `${mode}-title.png`) });
      }

      // race: from the startRace call; settled from 6 s after the phase turned 'race'
      const r0 = await page.evaluate(() => performance.now());
      await page.evaluate((t) => {
        const kk = window.__kk;
        kk.setAutoPause(false);
        window.__lowendRace = kk.startRace({ mode: 'single', track: t, laps: 3, seed: 5, autopilot: true, skipIntro: true });
      }, track);
      await page.waitForFunction(() => window.__kk.game.phase === 'race', null, { timeout: 240000, polling: 250 });
      const raceAt = await page.evaluate(() => performance.now());
      await sleep(raceSec * 1000);
      const rf = await takeFrames(page);
      const rEnd = rf.length ? rf[rf.length - 1][0] : raceAt;
      const raceRows = timeline(rf, r0, rEnd);
      const raceSettled = settle(rf, raceAt + 6000, rEnd + 1);
      if (shotsTag) await page.screenshot({ path: path.join(ROOT, 'tools', 'out', 'lowend', shotsTag, `${mode}-race.png`) });

      const fixed = [];
      for (const lv of levels) {
        await page.evaluate((q) => window.__kk.game.api.setSetting('quality', q), lv);
        await sleep(2000);
        await takeFrames(page);
        await sleep(5000);
        const f = await takeFrames(page);
        const perf = await page.evaluate(() => window.__kk.perf());
        fixed.push({ level: lv, ...settle(f, 0, Infinity), drawCalls: perf.drawCalls, shadowCalls: perf.shadowCalls, triangles: perf.triangles });
      }

      const decisions = await page.evaluate(() => (window.__kk.game.autoQuality?.log || []).slice());

      console.log(`\n== ${mode}: ${renderer}; ${M.viewport.width}x${M.viewport.height} DPR ${M.dpr}${M.cpu > 1 ? ` CPU x${M.cpu}` : ''}; quality setting ${quality}`);
      console.log(`  hint: ${hint ? JSON.stringify(hint) : 'none'}`);
      printRows('title (s from first title frame)', titleRows);
      console.log(`  title settled (6 s..end): ${JSON.stringify(titleSettled)}`);
      printRows(`race on ${track} (s from startRace; phase race at ${((raceAt - r0) / 1000).toFixed(1)} s)`, raceRows);
      console.log(`  race settled (race+6 s..end): ${JSON.stringify(raceSettled)}`);
      if (decisions.length) {
        console.log(`  auto decisions (s from first title frame; startRace at ${((r0 - tStart) / 1000).toFixed(1)} s): frame ms, then level and scale after`);
        for (const [t, ph, f, q, sc, what] of decisions) console.log(`    ${((t - tStart) / 1000).toFixed(1).padStart(6)} ${ph.padEnd(9)} ${String(f).padStart(6)} ms  ${q.padEnd(7)} ${String(sc).padEnd(4)} ${what}`);
      }
      for (const f of fixed) console.log(`  fixed ${f.level}: ${JSON.stringify(f)}`);
      if (errors.length) console.log(`  errors: ${errors.slice(0, 5).join(' | ')}`);
      results.push({ mode, renderer, hint: !!hint, title: titleSettled, race: raceSettled, raceReachedS: +((raceAt - r0) / 1000).toFixed(1), fixed, errors: errors.length });
      await page.evaluate(() => window.__kk.game.api.quitToTitle());
    } finally {
      await browser.close();
    }
  }
} finally {
  if (server) server.kill();
}
console.log('');
for (const r of results) console.log(JSON.stringify(r));
