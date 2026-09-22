// Game-flow checks: GP → results → podium → title, time trial best + ghost + splits, pause,
// quality levels, test API extras, and a touch-device smoke run (844×390, hasTouch, isMobile).
// node tools/scenarios/core-flow.mjs [--port 8765]
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'out');
const port = +(process.argv[process.argv.indexOf('--port') + 1] || 8765) || 8765;
const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

let server = null;
let browser = null;
const print = (check, result) => console.log(JSON.stringify({ check, result }));
try {
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await new Promise((r) => setTimeout(r, 100));
  }
  ({ browser } = await launch());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__kk && window.__kk.ready);

  print('gp', await page.evaluate(async () => {
    const kk = window.__kk, g = kk.game;
    kk.setAutoPause(false);
    await kk.startGP({ cls: '120', character: 'kedi', seed: 2 });
    const grid = g.karts.map((k) => k.id);
    kk.simulate(220);
    const r = { phaseAfterRace: g.phase, playerLast: grid[grid.length - 1] === 'kedi', results: g.race?.results?.map((x) => `${x.place}.${x.characterId} +${x.points}=${x.totalPoints}${x.estimated ? '*' : ''}`), standings: { ...g.gp.standings } };
    await g.api.nextRace();
    r.phaseAfterNext = g.phase;
    r.trackAfterPodium = g.track === null;
    g.api.quitToTitle();
    r.phaseAfterQuit = g.phase;
    r.gpActive = g.gp.active;
    return r;
  }));

  print('timeTrial', await page.evaluate(async () => {
    const kk = window.__kk, g = kk.game;
    g.storage.remove('tt:meadow:120:tilki');
    await kk.startRace({ track: 'meadow', mode: 'tt', laps: 1, character: 'tilki', cls: '120', skipIntro: true, seed: 4 });
    const karts = g.karts.length;
    kk.simulate(70);
    const first = { phase: g.phase, time: g.player.finishTime, stored: g.storage.get('tt:meadow:120:tilki', null) };
    await g.api.restartRace();
    const hasGhost = !!g.ghost;
    const n0 = kk.eventSeq();
    kk.simulate(40);
    kk.renderFrame();
    const splits = kk.events(n0).filter((e) => e.name === 'checkpoint' && e.kartId === g.player.id).map((e) => e.detail.split);
    const ghostVisible = g.ghost?.visual.object3d.visible;
    g.api.quitToTitle();
    return {
      soloKarts: karts, phase: first.phase, time: first.time && +first.time.toFixed(2),
      storedBestRace: first.stored?.bestRace && +first.stored.bestRace.toFixed(2), storedBestLap: first.stored?.bestLap && +first.stored.bestLap.toFixed(2),
      ghostFrames: first.stored?.ghost?.frames?.length / 4, ghostCheckpoints: first.stored?.ghost?.checkpoints,
      ghostOnRestart: hasGhost, ghostVisible, splits,
    };
  }));

  print('pause', await page.evaluate(async () => {
    const kk = window.__kk, g = kk.game;
    await kk.startRace({ track: 'meadow', skipIntro: true, seed: 6 });
    kk.simulate(4);
    const t0 = g.raceTime;
    g.api.setPaused(true);
    kk.simulate(2);
    const t1 = g.raceTime;
    const pausedPhase = g.phase;
    g.api.setPaused(false);
    kk.simulate(1);
    return { phase: pausedPhase, frozen: t1 === t0, resumed: g.raceTime > t1 };
  }));

  print('testApi', await page.evaluate(() => {
    const kk = window.__kk, g = kk.game;
    kk.giveItem(0, 'rocket3');
    const item = g.karts[0].item;
    return {
      giveItemStub: item, // the items stub clears items every step; the real module keeps them
      listenerCount: kk.listenerCount(),
      eventsLogged: kk.events().length,
      statsKeys: Object.keys(kk.stats()),
      perfKeys: Object.keys(kk.perf()),
    };
  }));

  for (const q of ['medium', 'low']) {
    await page.evaluate((level) => { window.__kk.game.api.setSetting('quality', level); }, q);
    await page.evaluate(() => { window.__kk.simulate(0.5); });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, `core-quality-${q}.png`) });
    print(`quality-${q}`, await page.evaluate(() => { const p = window.__kk.perf(); return { quality: p.quality, post: p.post, drawCalls: p.drawCalls, shadowCalls: p.shadowCalls, pixelRatio: p.pixelRatio }; }));
  }
  await page.evaluate(() => { window.__kk.game.api.setSetting('quality', 'auto'); window.__kk.game.api.quitToTitle(); });
  print('errors', await page.evaluate(() => window.__kk.errors.slice()));
  print('leaks', await page.evaluate(() => window.__kk.leaks()));

  // touch smoke run
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const tp = await ctx.newPage();
  await tp.goto(`http://127.0.0.1:${port}/`);
  await tp.waitForFunction(() => window.__kk && window.__kk.ready);
  await tp.tap('button[data-a=start]');
  await tp.waitForFunction(() => window.__kk.game.phase === 'countdown' || window.__kk.game.phase === 'race', null, { timeout: 15000 });
  await tp.waitForTimeout(3500);
  await tp.screenshot({ path: path.join(OUT, 'core-touch.png') });
  print('touch', await tp.evaluate(() => ({ touch: window.__kk.game.touch, quality: window.__kk.game.quality, phase: window.__kk.game.phase, errors: window.__kk.errors.slice() })));
  await ctx.close();
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
