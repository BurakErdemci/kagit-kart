// Cinematics verification: every shot through the real flow (api.setMenuScreen, startRace, a real
// finish, the GP podium), screenshots at several moments, camera continuity at the intro hand-off,
// skip, stop/resolve, reduced motion, leak and listener checks over two races.
// node tools/scenarios/cinematics.mjs [--port 8778] [--only title,select,intro,finish,podium,rm,leaks]
//   [--w 1280 --h 720] [--ui]   (--ui keeps the DOM overlay in the screenshots; default hides it)
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'out', 'cinematics');
mkdirSync(OUT, { recursive: true });
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const port = +arg('--port', 8778);
const W = +arg('--w', 1280), H = +arg('--h', 720);
const only = arg('--only', 'title,select,intro,finish,podium,rm,leaks').split(',');
const keepUI = process.argv.includes('--ui');
const tag = arg('--tag', '');

const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

const report = { shots: [], checks: {}, errors: [], warnings: [] };
let server = null;
let browser = null;

try {
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await new Promise((r) => setTimeout(r, 100));
  }
  let renderer;
  ({ browser, renderer } = await launch());
  report.renderer = renderer;
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => report.errors.push('pageerror ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__kk && window.__kk.ready);
  await page.evaluate(() => { window.__kk.setAutoPause(false); });

  const ui = async (on) => page.evaluate((v) => {
    // opacity, not visibility: UI children may set visibility:visible and show through
    const el = document.querySelector('.kk-ui');
    if (el) el.style.opacity = v ? '' : '0';
  }, on);
  const shoot = async (name, withUI = keepUI) => {
    await ui(withUI);
    const file = path.join(OUT, `${name}${tag}.png`);
    await page.screenshot({ path: file });
    await ui(true);
    const perf = await page.evaluate(() => { const p = window.__kk.perf(); return { calls: p.drawCalls, shadow: p.shadowCalls, tris: p.triangles }; });
    report.shots.push({ name, file: path.relative(ROOT, file), ...perf });
  };
  const wait = (ms) => page.waitForTimeout(ms);
  const api = (fn, ...args) => page.evaluate(([f, a]) => window.__kk.game.api[f](...a), [fn, args]);
  const camState = () => page.evaluate(() => {
    const g = window.__kk.game, c = g.camera;
    return { pos: c.position.toArray().map((v) => +v.toFixed(3)), fov: +c.fov.toFixed(3), override: !!g.cameraRig.override, phase: g.phase, shot: g.systems.cinematics.shot };
  });

  // ---------------------------------------------------------------------------------- title
  if (only.includes('title')) {
    await wait(1200);
    await shoot('title-cover', true);
    await shoot('title-a');
    await api('setMenuScreen', 'mode');
    await wait(200);
    await shoot('title-reveal-0.2s');
    await wait(150);
    await shoot('title-reveal-0.45s');
    await wait(200);
    await shoot('title-reveal-0.75s');
    await wait(1800);
    await shoot('title-mode', true);
    await shoot('title-b');
    await wait(9000);
    await shoot('title-c-11s');
    report.checks.title = await camState();
  }

  // ---------------------------------------------------------------------------------- select
  if (only.includes('select')) {
    if (!only.includes('title')) { await api('setMenuScreen', 'mode'); await wait(1500); }
    await api('setMenuScreen', 'class');
    await wait(300);
    await api('setMenuScreen', 'character', { characterId: 'tilki' });
    await wait(500);
    await shoot('select-blend-0.5s');
    await wait(1500);
    await shoot('select-tilki', true);
    await shoot('select-tilki-clean');
    await api('setMenuScreen', 'character', { characterId: 'kedi' });
    await wait(120);
    await shoot('select-swap-0.12s');
    await wait(230);
    await shoot('select-swap-0.35s');
    await wait(1200);
    await shoot('select-kedi');
    for (const id of ['kurbaga', 'penguen', 'ayi', 'baykus', 'tavsan', 'ahtapot']) {
      await api('setMenuScreen', 'character', { characterId: id });
      await wait(90);
    }
    await wait(1500);
    await shoot('select-ahtapot', true);
    report.checks.selectHeroes = await page.evaluate(() => {
      const g = window.__kk.game;
      let n = 0;
      g.scene.traverse((o) => { if (o.name && o.name.startsWith('hero:')) n++; });
      return n;
    });
    await api('setMenuScreen', 'class');
    await wait(700);
    await shoot('select-back-to-title-0.7s');
    await wait(1200);
  }

  // ---------------------------------------------------------------------------------- intro
  if (only.includes('intro')) {
    report.checks.introBefore = await page.evaluate(() => ({ listeners: window.__kk.listenerCount() }));
    await page.evaluate(() => { window.__introP = window.__kk.startRace({ track: 'meadow', mode: 'single', seed: 5 }); });
    await page.waitForFunction(() => window.__kk.game.phase === 'intro', null, { timeout: 20000 });
    const t0 = Date.now();
    const at = async (sec, name) => { const d = sec * 1000 - (Date.now() - t0); if (d > 0) await wait(d); await shoot(name, true); };
    await at(0.3, 'intro-0.3s');
    await at(1.2, 'intro-1.2s');
    await at(2.3, 'intro-2.3s');
    await at(3.1, 'intro-3.1s');
    await at(4.2, 'intro-4.2s');
    await at(5.4, 'intro-5.4s');
    // hand-off: sample the camera every frame across the end of the intro
    const handoff = await page.evaluate(async () => {
      const g = window.__kk.game;
      const out = [];
      for (let i = 0; i < 90 && out.length < 90; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        out.push({ phase: g.phase, o: !!g.cameraRig.override, p: g.camera.position.toArray(), fov: g.camera.fov });
        if (g.phase === 'countdown' && out.filter((x) => x.phase === 'countdown').length > 5) break;
      }
      let maxJump = 0, jumpAt = null;
      for (let i = 1; i < out.length; i++) {
        const a = out[i - 1].p, b = out[i].p;
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (out[i].phase === 'countdown' && out[i - 1].phase !== 'countdown') jumpAt = { d, fovA: out[i - 1].fov, fovB: out[i].fov };
        maxJump = Math.max(maxJump, d);
      }
      return { frames: out.length, maxStep: +maxJump.toFixed(3), atHandoff: jumpAt, finalPhase: g.phase, override: !!g.cameraRig.override };
    });
    report.checks.introHandoff = handoff;
    await wait(300);
    await shoot('intro-after-countdown', true);
    // skip: a second race, skipped after 1 s
    await page.evaluate(() => { window.__kk.startRace({ track: 'meadow', mode: 'single', seed: 6 }); });
    await page.waitForFunction(() => window.__kk.game.phase === 'intro', null, { timeout: 20000 });
    await wait(1000);
    const skip = await page.evaluate(async () => {
      const g = window.__kk.game;
      const t = performance.now();
      g.api.skipCinematic();
      for (let i = 0; i < 30 && g.phase === 'intro'; i++) await new Promise((r) => requestAnimationFrame(r));
      return { phase: g.phase, ms: Math.round(performance.now() - t), override: !!g.cameraRig.override };
    });
    report.checks.introSkip = skip;
  }

  // ---------------------------------------------------------------------------------- finish
  if (only.includes('finish')) {
    await page.evaluate(async () => {
      const kk = window.__kk;
      await kk.startRace({ track: 'meadow', mode: 'single', seed: 9, laps: 1, skipIntro: true });
    });
    // drive the whole lap synchronously until the player crosses the line
    const crossed = await page.evaluate(() => {
      const kk = window.__kk, g = kk.game;
      for (let i = 0; i < 400 && g.phase !== 'finishing' && g.phase !== 'results'; i++) kk.simulate(0.25);
      return { phase: g.phase, shot: g.systems.cinematics.shot, t: g.raceTime };
    });
    report.checks.finishStart = crossed;
    const t0 = Date.now();
    const at = async (sec, name) => { const d = sec * 1000 - (Date.now() - t0); if (d > 0) await wait(d); await shoot(name, true); };
    await at(0.2, 'finish-0.2s');
    await at(1.4, 'finish-1.4s');
    await at(2.6, 'finish-2.6s');
    await at(4.4, 'finish-4.4s');
    await page.evaluate(() => { const kk = window.__kk; kk.finishNow(); });
    await wait(2200);
    await shoot('finish-results', true);
    await shoot('finish-results-clean');
    report.checks.finishResults = await camState();
  }

  // ---------------------------------------------------------------------------------- podium
  if (only.includes('podium')) {
    await page.evaluate(async () => {
      const kk = window.__kk;
      await kk.startGP({ index: 3, cls: '120', character: 'tilki', seed: 3, standings: { kedi: 30, ayi: 28, tavsan: 25, tilki: 12 } });
      kk.finishNow();
      kk.game.api.nextRace();
    });
    report.checks.podiumPhase = await camState();
    const t0 = Date.now();
    const at = async (sec, name, u = false) => { const d = sec * 1000 - (Date.now() - t0); if (d > 0) await wait(d); await shoot(name, u); };
    await at(0.4, 'podium-0.4s');
    await at(1.3, 'podium-1.3s');
    await at(2.5, 'podium-2.5s');
    await at(3.7, 'podium-3.7s');
    await at(4.6, 'podium-4.6s');
    await at(6.5, 'podium-6.5s', true);
    await at(10, 'podium-10s');
    await at(10.2, 'podium-10s-ui', true);
    report.checks.podiumTop3 = await page.evaluate(() => {
      const g = window.__kk.game;
      const names = [];
      g.scene.traverse((o) => { if (o.name && o.name.startsWith('podium:')) names.push(o.name); });
      return names;
    });
  }

  // ---------------------------------------------------------------------------------- reduced motion
  if (only.includes('rm')) {
    await api('quitToTitle');
    await api('setSetting', 'reducedMotion', 'on');
    await wait(600);
    await api('setMenuScreen', 'mode');
    await wait(200);
    await shoot('rm-title-reveal-0.2s');
    await api('setMenuScreen', 'character', { characterId: 'penguen' });
    await wait(200);
    await shoot('rm-select-cut-0.2s');
    await page.evaluate(() => { window.__kk.startRace({ track: 'meadow', mode: 'single', seed: 7 }); });
    await page.waitForFunction(() => window.__kk.game.phase === 'intro', null, { timeout: 20000 });
    await wait(1000);
    await shoot('rm-intro-1s', true);
    await wait(2300);
    await shoot('rm-intro-3.3s', true);
    await wait(2000);
    await shoot('rm-intro-5.3s', true);
    await page.waitForFunction(() => window.__kk.game.phase === 'countdown', null, { timeout: 20000 });
    await api('setSetting', 'reducedMotion', 'auto');
  }

  // ---------------------------------------------------------------------------------- leaks + promises
  if (only.includes('leaks')) {
    report.checks.leaks = await page.evaluate(async () => {
      const kk = window.__kk, g = kk.game, cin = g.systems.cinematics;
      g.api.quitToTitle();
      await new Promise((r) => setTimeout(r, 300));
      const base = { listeners: kk.listenerCount() };
      const memTitle = kk.memory();
      // two races with intros, finished, then back to the title
      for (const seed of [21, 22]) {
        await kk.startRace({ track: 'meadow', mode: 'single', seed, laps: 1 });
        kk.simulate(2);
        kk.finishNow();
        await new Promise((r) => setTimeout(r, 200));
      }
      g.api.quitToTitle();
      await new Promise((r) => setTimeout(r, 300));
      const after = { listeners: kk.listenerCount() };
      const memAfter = kk.memory();
      // every play resolves: stop resolves false, a replaced shot resolves false, podium completes true
      const results = {};
      const p1 = cin.play('select', { characterId: 'ayi' });
      const p2 = cin.play('title');
      results.replaced = await p1;
      cin.stop();
      results.stopped = await p2;
      results.unknown = await cin.play('nope');
      const p3 = cin.play('podium', { top3: [{ characterId: 'ayi', points: 40 }, { characterId: 'kedi', points: 30 }, { characterId: 'tavsan', points: 20 }] });
      results.podium = await Promise.race([p3, new Promise((r) => setTimeout(() => r('timeout'), 9000))]);
      cin.stop();
      results.overrideAfterStop = !!g.cameraRig.override;
      g.api.quitToTitle();
      return { base, after, memTitle, memAfter, leaks: kk.leaks(), results };
    });
  }

  const tail = await page.evaluate(() => ({ errors: window.__kk.errors.slice(), warnings: window.__kk.warnings.slice() }));
  report.errors.push(...tail.errors);
  report.warnings.push(...tail.warnings);
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
console.log(JSON.stringify(report, null, 1));
