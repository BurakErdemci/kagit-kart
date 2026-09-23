// Core checks for fix round 2 (QA-1 #8, #9, #17, #18, #20.8).
// node tools/scenarios/fix2.mjs [--port 8792] [--mode hitch,finish,water,void|all] [--tracks all|meadow,...]
//   [--quality high] [--tag cur]
// hitch:  real-time race per track: frame deltas in the first 20 s, items fired at 3 s, programs compiled
//         after the race started (names), longest frames.
// finish: finishNow mid-race → a `finish` event with estimated: true for every kart classified by estimate.
// water:  a kart pushed off the Bosphorus bridge: respawn height against the drawn water.
// void:   a kart pushed into a void with the chase camera: screenshots per step, camera height, kill height.
// Shots land in tools/out/fix2/<tag>/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const port = +arg('port', 8792);
const modes = String(arg('mode', 'all')).split(',');
const want = (m) => modes.includes(m) || modes.includes('all');
const quality = arg('quality', 'high');
const tag = arg('tag', 'cur');
const OUT = path.join(ROOT, 'tools', 'out', 'fix2', tag);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});
const saveUrl = (name, url) => {
  const f = path.join(OUT, name + '.png');
  fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
  return path.relative(ROOT, f).replace(/\\/g, '/');
};

let server = null, browser = null;
const report = { quality };
try {
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await sleep(100);
  }
  const l = await launch();
  browser = l.browser;
  report.renderer = l.renderer;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__kk && window.__kk.ready, null, { timeout: 30000 });
  await page.evaluate((q) => {
    const kk = window.__kk;
    kk.setAutoPause(false);
    if (kk.game.settings.quality !== q) kk.game.api.setSetting('quality', q);
    if (!kk.game.settings.seenTutorial) kk.game.api.setSetting('seenTutorial', true);
  }, quality);
  const cup = await page.evaluate(() => window.__kk.game.gp.cup.slice());
  const tracks = arg('tracks', 'all') === 'all' ? cup : arg('tracks').split(',');

  if (want('hitch')) {
    report.hitch = {};
    for (const track of tracks) {
      await page.evaluate(async (track) => {
        const kk = window.__kk;
        window.__fxD = []; window.__fxRec = false;
        if (!window.__fxRaf) {
          window.__fxRaf = true;
          let last = performance.now();
          const f = (now) => { if (window.__fxRec) window.__fxD.push(+(now - last).toFixed(1)); last = now; requestAnimationFrame(f); };
          requestAnimationFrame(f);
        }
        await kk.startRace({ mode: 'single', track, seed: 6, skipIntro: false, autopilot: true });
      }, track);
      await page.waitForFunction(() => window.__kk.game.phase === 'race', null, { timeout: 40000 });
      await page.evaluate(() => {
        const r = window.__kk.game.renderer;
        window.__fxRec = true;
        window.__fxP0 = new Set(r.info.programs.map((p) => p.id));
      });
      await sleep(3000);
      await page.evaluate(() => {
        const kk = window.__kk;
        const ids = ['plane', 'homing', 'gum', 'rocket3', 'ink', 'foil', 'plane', 'scissors'];
        kk.game.karts.forEach((k, j) => kk.giveItem(j, ids[j % ids.length]));
      });
      await sleep(17000);
      const r = await page.evaluate(() => {
        window.__fxRec = false;
        const d = window.__fxD, r = window.__kk.game.renderer;
        const sorted = d.slice().sort((a, b) => b - a);
        const fresh = r.info.programs.filter((p) => !window.__fxP0.has(p.id)).map((p) => p.name + ' ' + String(p.cacheKey).slice(0, 160));
        return { frames: d.length, over20: d.filter((x) => x > 20).length, over30: d.filter((x) => x > 30).length, worst: sorted.slice(0, 6),
          worstAt: d.map((x, i) => [i, x]).filter((x) => x[1] > 20).slice(0, 10), newPrograms: fresh, programs: r.info.programs.length };
      });
      report.hitch[track] = r;
      console.log('HITCH', track, JSON.stringify(r));
      await page.evaluate(() => window.__kk.game.api.quitToTitle());
      await sleep(400);
    }
  }

  if (want('finish')) {
    report.finish = await page.evaluate(async () => {
      const kk = window.__kk, g = kk.game;
      kk.logEvents = true;
      await kk.startRace({ mode: 'single', track: 'meadow', seed: 3, skipIntro: true, autopilot: true, laps: 3 });
      const seq = kk.eventSeq();
      kk.simulate(20);
      kk.finishNow();
      const ev = kk.events(seq).filter((e) => e.name === 'finish' || e.name === 'raceEnd');
      const res = g.race.results.map((r) => ({ id: r.kartId, place: r.place, est: r.estimated, t: +r.time.toFixed(2) }));
      g.api.quitToTitle();
      return { finishEvents: ev.filter((e) => e.name === 'finish').length, raceEndAfterFinish: ev.length && ev[ev.length - 1].name === 'raceEnd',
        sample: ev.slice(0, 3).map((e) => ({ name: e.name, kart: e.kartId, detail: e.detail })), results: res };
    });
    console.log('FINISH', JSON.stringify(report.finish));
  }

  if (want('water')) {
    const r = await page.evaluate(async () => {
      const kk = window.__kk, g = kk.game;
      await kk.startRace({ mode: 'single', track: 'bosphorus', seed: 2, skipIntro: true, autopilot: false, cpuCount: 0 });
      kk.simulate(3.2);
      const b = g.trackDef.bridges[0]; const t = (b.from + b.to) / 2;
      const p = g.player; kk.teleport(p.index, t, 0);
      const hw = p.trackInfo.halfWidth, off = p.trackInfo.offroadWidth;
      kk.teleport(p.index, t, hw + off + 3);
      const water = g.track.objects.water;
      const wy = water ? +new g.THREE.Box3().setFromObject(water).max.y.toFixed(2) : null;
      const log = [];
      let lift = null;
      for (let i = 0; i < 400 && !lift; i++) {
        kk.simulate(1 / 60);
        if (i % 10 === 0) log.push(+p.pos.y.toFixed(2));
        if (p.respawn.active) lift = { y: +p.pos.y.toFixed(2), waterY: +p.trackInfo.waterY.toFixed(2), after: +(i / 60).toFixed(2) };
      }
      const out = { deckY: +g.track.samples.py[p.trackInfo.index].toFixed(2), waterMeshTopY: wy, waterLevel: g.trackDef.waterLevel, lift, path: log };
      g.api.quitToTitle();
      return out;
    });
    report.water = r;
    console.log('WATER', JSON.stringify(r));
  }

  if (want('void')) {
    report.void = {};
    for (const [id, code] of [['desk', 2], ['glacier', 2], ['bosphorus', 3]]) {
      await page.evaluate(async (id) => {
        await window.__kk.startRace({ track: id, mode: 'single', autopilot: true, skipIntro: true, seed: 3, cpuCount: 0 });
      }, id);
      await sleep(300);
      const r = await page.evaluate(async (code) => {
        const kk = window.__kk, g = kk.game, tr = g.track, s = tr.samples, N = tr.sampleCount, p = g.player;
        g.loop.timeScale = 1;
        if (g.phase === 'countdown') kk.simulate(3.5);
        g.loop.timeScale = 0;
        let best = null;
        for (const [arr, side] of [[s.edgeLeft, -1], [s.edgeRight, 1]]) {
          let run = 0;
          for (let i = 0; i < 2 * N; i++) {
            if (arr[i % N] === code) { run++; if (!best || run > best.run) best = { run, i: (i - (run >> 1) + N) % N, side }; } else run = 0;
          }
        }
        if (!best) return null;
        const i = best.i, side = best.side, t = i / N, w = s.halfWidth[i] + s.offroad[i];
        p.autopilot = false;
        kk.setControls({ throttle: 0, steer: 0, brake: 0 });
        kk.teleport(p.index, t, side * (w - 1));
        const pt = tr.pointAt(t, side * (w + 4), {});
        p.pos.copy(pt.pos); p.pos.y = s.py[i] + 0.3;
        p.prevPos.copy(p.pos);
        p.vel.set(s.hx[i] * side * 4 + s.tx[i] * 8, 0, s.hz[i] * side * 4 + s.tz[i] * 8);
        p.grounded = false; p.vy = 0;
        g.cameraRig.snap();
        const frames = [];
        g.loop.timeScale = 1;
        for (let k = 0; k < 14; k++) {
          kk.simulate(0.15);
          p.visual.object3d.position.copy(p.pos);
          p.visual.object3d.quaternion.copy(p.quat);
          for (let j = 0; j < 9; j++) g.cameraRig.update(1 / 60);
          g.renderer.sunTarget.copy(p.pos);
          kk.renderFrame();
          frames.push({ k, y: +p.pos.y.toFixed(2), respawn: p.respawn.active ? p.respawn.stage : null, camY: +g.camera.position.y.toFixed(2), url: g.renderer.domElement.toDataURL('image/png') });
          if (p.respawn.active) break;
        }
        g.loop.timeScale = 1;
        kk.setControls(null);
        return { t: +t.toFixed(3), side, pageY: +tr.pageY.toFixed(2), deskY: +(tr.pageY - g.config.track.deskDrop).toFixed(2), killY: +tr.killY.toFixed(2), roadY: +s.py[i].toFixed(2), frames };
      }, code);
      if (!r) { report.void[id] = 'no such edge'; continue; }
      r.frames = r.frames.map((f) => ({ ...f, url: undefined, file: saveUrl(`fall-${id}-${f.k}`, f.url) }));
      report.void[id] = r;
      console.log('VOID', id, JSON.stringify({ ...r, frames: r.frames.map((f) => [f.k, f.y, f.camY, f.respawn]) }));
      await page.evaluate(() => window.__kk.game.api.quitToTitle());
      await sleep(300);
    }
  }

  report.errors = await page.evaluate(() => window.__kk.errors.slice(0, 10));
  report.pageErrors = pageErrors;
  report.leaks = await page.evaluate(() => window.__kk.leaks());
  console.log('END', JSON.stringify({ errors: report.errors, pageErrors, leaks: report.leaks.leaks }));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
