// Tracks + scenery checks for fix round 3 (QA-1 #4, #5, #10, #12 tracks half, road ink, walls, void props).
// node tools/scenarios/fix3.mjs [--port 8793] [--mode probe,grid,intro,bridge,skyline,walls,road,perf|all]
//   [--tracks all|meadow,...] [--quality high] [--tag cur]
// probe:   def.shortcut against the analysis pairs, bridge/strait numbers, props standing over a void.
// grid:    the view from the grid during the countdown on every track (the chapter sign in view).
// intro:   the Bosphorus intro cinematic at 0.5 / 2.5 / 4.5 s.
// bridge:  the suspension bridge from the approach, from the deck, from the shore and from above.
// skyline: the Bosphorus skyline from several spots round the lap.
// walls:   the chase camera beside every wall run.
// road:    chase shots on a straight and a corner of every track.
// perf:    draw calls, shadow calls and triangles at a spread of spots round each lap.
// Shots land in tools/out/fix3/<tag>/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const port = +arg('port', 8793);
const modes = String(arg('mode', 'all')).split(',');
const want = (m) => modes.includes(m) || modes.includes('all');
const quality = arg('quality', 'high');
const tag = arg('tag', 'cur');
const trackArg = arg('tracks', 'all');
const TRACKS = trackArg === 'all' ? ['meadow', 'bosphorus', 'glacier', 'desk'] : trackArg.split(',');
const OUT = path.join(ROOT, 'tools', 'out', 'fix3', tag);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

let server = null, browser = null;
const report = { tag, quality };
const shots = [];
try {
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await sleep(100);
  }
  let renderer;
  ({ browser, renderer } = await launch());
  report.renderer = renderer;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__kk && window.__kk.ready, null, { timeout: 30000 });
  await page.evaluate((q) => {
    const kk = window.__kk;
    kk.setAutoPause(false);
    if (kk.game.settings.quality !== q) kk.game.api.setSetting('quality', q);
    if (!kk.game.settings.seenTutorial) kk.game.api.setSetting('seenTutorial', true);
  }, quality);

  const shot = async (name) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    shots.push(path.relative(ROOT, file).replace(/\\/g, '/'));
  };
  const race = (track, extra = {}) => page.evaluate(async (o) => {
    const kk = window.__kk;
    kk.game.cameraRig.override = null;
    kk.setCamera(null);
    kk.game.loop.timeScale = 1;
    await kk.startRace({ mode: 'single', seed: 11, skipIntro: true, autopilot: true, cpuCount: 3, ...o });
  }, { track, ...extra });
  // Chase camera at lap fraction t, lateral lat, moving at 16 m/s, world frozen after 0.25 s.
  const chaseAt = (t, lat = 0, speed = 16) => page.evaluate(({ t, lat, speed }) => {
    const kk = window.__kk, g = kk.game;
    g.cameraRig.override = null;
    kk.setCamera(null);
    g.loop.timeScale = 1;
    if (g.phase === 'countdown') kk.simulate(3.4);
    kk.teleport(g.player.index, ((t % 1) + 1) % 1, lat);
    const p = g.player;
    p.vel.set(Math.sin(p.heading) * speed, 0, Math.cos(p.heading) * speed);
    kk.simulate(0.25);
    g.loop.timeScale = 0;
  }, { t, lat, speed });
  // Fixed camera: eye and target in world space.
  const eyeAt = (eye, at) => page.evaluate(({ eye, at }) => {
    const g = window.__kk.game, T = g.THREE;
    const e = new T.Vector3(...eye), a = new T.Vector3(...at);
    g.cameraRig.override = { update(dt, cam) { cam.position.copy(e); cam.lookAt(a); } };
  }, { eye, at });
  // Put the player at t without moving the camera there (pop-ups follow the camera).
  const perf = () => page.evaluate(() => { const p = window.__kk.perf(); return { calls: p.drawCalls, shadow: p.shadowCalls, tris: p.triangles }; });

  if (want('probe')) {
    report.probe = {};
    for (const id of TRACKS) {
      await race(id, { cpuCount: 0 });
      report.probe[id] = await page.evaluate(() => {
        const g = window.__kk.game, tr = g.track, def = g.trackDef, s = tr.samples, N = tr.sampleCount;
        const found = (tr.analysis?.shortcuts || []).map((x) => ({ t0: +x.t0.toFixed(4), t1: +x.t1.toFixed(4), gap: +x.gap.toFixed(1), saving: Math.round(x.saving) }));
        const sc = def.shortcut ? { from: +def.shortcut.from.toFixed(4), to: +def.shortcut.to.toFixed(4), side: def.shortcut.side } : null;
        // Props whose base lies over a void strip (60 m beyond the band on a void edge).
        const voidHits = [];
        const sc3 = g.systems.scenery;
        const T = g.THREE, m = new T.Matrix4(), v = new T.Vector3();
        const strips = [];
        for (let i = 0; i < N; i++) for (const [arr, sg] of [[s.edgeLeft, -1], [s.edgeRight, 1]]) if (arr[i] === 2) strips.push([i, sg]);
        const overVoid = (x, z) => {
          for (const [i, sg] of strips) {
            const dx = x - s.px[i], dz = z - s.pz[i];
            const along = dx * s.tx[i] + dz * s.tz[i];
            if (Math.abs(along) > 1.5) continue;
            const lat = (dx * s.hx[i] + dz * s.hz[i]) * sg - s.halfWidth[i] - s.offroad[i];
            if (lat > -0.5 && lat < 62) return true;
          }
          return false;
        };
        sc3?.group?.traverse((o) => {
          if (!o.isInstancedMesh || !o.name.startsWith('scenery:') || o.name === 'scenery:tabs') return;
          for (let k = 0; k < o.count; k++) {
            o.getMatrixAt(k, m);
            v.setFromMatrixPosition(m);
            if (overVoid(v.x, v.z)) voidHits.push(o.name);
          }
        });
        const counts = {};
        for (const n of voidHits) counts[n] = (counts[n] || 0) + 1;
        return { length: +tr.length.toFixed(1), shortcut: sc, found, overVoid: counts, pageY: tr.pageY };
      });
      console.log(id, JSON.stringify(report.probe[id]));
    }
  }

  if (want('grid')) {
    for (const id of TRACKS) {
      await race(id);
      await page.waitForFunction(() => window.__kk.game.phase === 'countdown', null, { timeout: 15000 });
      await page.evaluate(() => { window.__kk.game.loop.timeScale = 0; });
      await sleep(1200);
      await shot(`grid-${id}`);
      // The sign seen from the far side (should never be a dark slab).
      await page.evaluate(() => {
        const g = window.__kk.game, T = g.THREE;
        let sign = null;
        g.systems.scenery.group.traverse((o) => { if (o.name === 'scenery:chapterSign') sign = o; });
        if (!sign) return;
        const m = new T.Matrix4(); sign.getMatrixAt(0, m);
        const p = new T.Vector3().setFromMatrixPosition(m);
        const f = new T.Vector3(0, 0, 1).applyMatrix4(m.clone().setPosition(0, 0, 0)).setY(0).normalize();
        const eye = p.clone().addScaledVector(f, -34).add(new T.Vector3(0, 7, 0));
        const at = p.clone().add(new T.Vector3(0, 7, 0));
        g.cameraRig.override = { update(dt, cam) { cam.position.copy(eye); cam.lookAt(at); } };
      });
      await sleep(600);
      await shot(`signback-${id}`);
      await page.evaluate(() => { const g = window.__kk.game; g.cameraRig.override = null; g.loop.timeScale = 1; });
    }
  }

  if (want('intro') && TRACKS.includes('bosphorus')) {
    // startRace resolves only after the intro has played, so it is not awaited here.
    await page.evaluate(() => {
      const kk = window.__kk;
      kk.game.cameraRig.override = null; kk.setCamera(null); kk.game.loop.timeScale = 1;
      window.__introDone = kk.startRace({ mode: 'single', track: 'bosphorus', seed: 11, skipIntro: false, autopilot: true, cpuCount: 7 });
    });
    await page.waitForFunction(() => window.__kk.game.phase === 'intro', null, { timeout: 15000, polling: 20 });
    await sleep(500); await shot('intro-bosphorus-0.5s');
    await sleep(2000); await shot('intro-bosphorus-2.5s');
    await sleep(2000); await shot('intro-bosphorus-4.5s');
    await page.evaluate(() => window.__introDone);
  }

  if (want('bridge') && TRACKS.includes('bosphorus')) {
    await race('bosphorus');
    const b = await page.evaluate(() => {
      const g = window.__kk.game, def = g.trackDef, tr = g.track, s = tr.samples, N = tr.sampleCount;
      const [a, z] = def.decor.bridge;
      const i = Math.round(((a + z) / 2) * N) % N;
      return { from: a, to: z, mid: (a + z) / 2, x: s.px[i], y: s.py[i], z: s.pz[i], hx: s.hx[i], hz: s.hz[i], tx: s.tx[i], tz: s.tz[i], L: tr.length, pageY: tr.pageY };
    });
    report.bridge = b;
    for (const [name, d] of [['approach-120', -120], ['approach-60', -60], ['approach-20', -20], ['deck-mid', (b.to - b.from) * b.L * 0.45]]) {
      await chaseAt(b.from + d / b.L, 0);
      await sleep(900);
      await shot(`bridge-${name}`);
    }
    // From the European shore, low, looking across at the span; and from far out on the strait.
    const side = (lat, up, look = 0) => [b.x + b.hx * lat - b.tx * look, b.pageY + up, b.z + b.hz * lat - b.tz * look];
    await eyeAt(side(-150, 14, 60), [b.x, b.y + 10, b.z]);
    await sleep(900); await shot('bridge-shore');
    await eyeAt(side(170, 40, -140), [b.x, b.y + 8, b.z]);
    await sleep(900); await shot('bridge-strait');
    await eyeAt([b.x + b.tx * -40 + b.hx * 30, b.y + 60, b.z + b.tz * -40 + b.hz * 30], [b.x, b.pageY, b.z]);
    await sleep(900); await shot('bridge-above');
    await page.evaluate(() => { const g = window.__kk.game; g.cameraRig.override = null; g.loop.timeScale = 1; });
    report.bridgePerf = await perf();
  }

  if (want('skyline') && TRACKS.includes('bosphorus')) {
    await race('bosphorus');
    for (const t of [0.02, 0.12, 0.3, 0.45, 0.6, 0.75, 0.9]) {
      await chaseAt(t, 0);
      await sleep(900);
      await shot(`skyline-${t.toFixed(2)}`);
    }
    await page.evaluate(() => { const g = window.__kk.game; g.cameraRig.override = null; g.loop.timeScale = 1; });
  }

  if (want('walls')) {
    for (const id of TRACKS) {
      await race(id);
      const spots = await page.evaluate(() => {
        const tr = window.__kk.game.track, s = tr.samples, N = tr.sampleCount;
        const out = [];
        for (const [arr, sg] of [[s.edgeLeft, -1], [s.edgeRight, 1]]) {
          for (let i = 0; i < N; i++) {
            if (arr[i] === 1 && arr[(i - 1 + N) % N] !== 1) out.push({ t: ((i + 14) % N) / N, lat: sg * s.halfWidth[(i + 14) % N] * 0.5 });
          }
        }
        return out;
      });
      for (const [k, sp] of spots.entries()) {
        await chaseAt(sp.t - 12 / 1200, sp.lat);
        await sleep(800);
        await shot(`wall-${id}-${k}`);
      }
    }
    await page.evaluate(() => { const g = window.__kk.game; g.cameraRig.override = null; g.loop.timeScale = 1; });
  }

  if (want('road')) {
    for (const id of TRACKS) {
      await race(id);
      const spots = await page.evaluate(() => {
        const tr = window.__kk.game.track, s = tr.samples, N = tr.sampleCount;
        const wrap = (i) => ((i % N) + N) % N;
        let straight = 0, best = Infinity, corner = 0, cmax = 0;
        for (let i = 0; i < N; i += 4) {
          let acc = 0;
          for (let k = 0; k < 60; k++) acc += Math.abs(s.curvature[wrap(i + k)]);
          if (acc < best && Math.abs(i - tr.startIndex) > 80) { best = acc; straight = i; }
        }
        for (let i = 0; i < N; i++) if (Math.abs(s.curvature[i]) > cmax && s.rampId[i] < 0) { cmax = Math.abs(s.curvature[i]); corner = i; }
        return { straight: straight / N, corner: wrap(corner - 28) / N };
      });
      for (const [name, t] of Object.entries(spots)) {
        await chaseAt(t, 0);
        await sleep(800);
        await shot(`road-${id}-${name}`);
      }
    }
    await page.evaluate(() => { const g = window.__kk.game; g.cameraRig.override = null; g.loop.timeScale = 1; });
  }

  if (want('perf')) {
    report.perf = {};
    for (const id of TRACKS) {
      await race(id, { cpuCount: 7 });
      const rows = [];
      for (let k = 0; k < 12; k++) {
        await chaseAt(k / 12 + 0.01, 0);
        await sleep(500);
        rows.push(await perf());
      }
      const max = rows.reduce((a, r) => (r.calls > a.calls ? r : a), rows[0]);
      report.perf[id] = { maxCalls: max.calls, shadowAtMax: max.shadow, maxTris: Math.max(...rows.map((r) => r.tris)), calls: rows.map((r) => r.calls) };
      console.log('perf', id, JSON.stringify(report.perf[id]));
    }
    await page.evaluate(() => { const g = window.__kk.game; g.cameraRig.override = null; g.loop.timeScale = 1; });
  }

  const tail = await page.evaluate(() => {
    const kk = window.__kk;
    kk.game.api.quitToTitle();
    return { errors: kk.errors.slice(0, 20), warnings: kk.warnings.slice(0, 20), layout: kk.layoutWarnings() };
  });
  await sleep(400);
  report.leaks = await page.evaluate(() => window.__kk.leaks());
  Object.assign(report, tail, { pageErrors });
  report.shots = shots;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  const { shots: _s, probe: _p, ...brief } = report;
  console.log(JSON.stringify(brief));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
