// LOOK lane: chase/top/side/overview screenshots of every track's surfaces, plus budget and leak numbers.
// node tools/scenarios/look.mjs [--port 8780] [--quality high|medium|low] [--tracks meadow,desk]
//                               [--views start,straight,...] [--tag cur] [--cpus 2] [--width 1280 --height 720]
//                               [--hud 0] (hide the DOM HUD so the ground is not covered)
// Shots land in tools/out/look/<tag>/<track>-<view>-<quality>.png. The world is frozen (timeScale 0)
// while a shot settles, so before/after pairs frame the same moment.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const port = +arg('--port', 8780);
const quality = arg('--quality', 'high');
const tag = arg('--tag', 'cur');
const cpus = +arg('--cpus', 2);
const width = +arg('--width', 1280), height = +arg('--height', 720);
const ALL_VIEWS = ['start', 'straight', 'corner', 'ramp', 'unfold', 'pad', 'water', 'wall', 'void', 'hole', 'dip', 'top', 'side', 'overview', 'edge', 'gutter'];
const views = (arg('--views', '') || ALL_VIEWS.join(',')).split(',').filter(Boolean);
const OUT = path.join(ROOT, 'tools', 'out', 'look', tag);
fs.mkdirSync(OUT, { recursive: true });

const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

let server = null;
let browser = null;
const report = { quality, tag, tracks: [], errors: [], warnings: [] };
try {
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await new Promise((r) => setTimeout(r, 100));
  }
  let renderer;
  ({ browser, renderer } = await launch());
  report.renderer = renderer;
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (e) => report.errors.push('pageerror: ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__kk && window.__kk.ready, null, { timeout: 30000 });
  if (arg('--hud', '1') === '0') await page.addStyleTag({ content: '#kk-root > :not(canvas) { visibility: hidden !important; }' });
  const trackIds = (arg('--tracks', '') || '').split(',').filter(Boolean);
  const ids = trackIds.length ? trackIds : await page.evaluate(async () => (await import('/src/track/defs/index.js')).CUP.slice());

  for (const id of ids) {
    await page.evaluate(async ({ id, q, cpus }) => {
      const kk = window.__kk;
      kk.setAutoPause(false);
      if (kk.game.settings.quality !== q) kk.game.api.setSetting('quality', q);
      if (!kk.game.settings.seenTutorial) kk.game.api.setSetting('seenTutorial', true);
      await kk.startRace({ track: id, mode: 'single', autopilot: true, skipIntro: true, seed: 11, cpuCount: cpus });
      kk.game.loop.timeScale = 0;
      // Feature positions from the track data (lap fractions + lateral), computed once per track.
      const g = kk.game, tr = g.track, s = tr.samples, N = tr.sampleCount, L = tr.length;
      const wrap = (i) => ((i % N) + N) % N;
      const firstRun = (arr, code) => {
        for (let i = 0; i < N; i++) if (arr[i] === code && arr[wrap(i - 1)] !== code) return i;
        return -1;
      };
      const find = (code) => {
        const l = firstRun(s.edgeLeft, code), r = firstRun(s.edgeRight, code);
        if (l < 0 && r < 0) return null;
        const i = l >= 0 ? l : r;
        return { t: wrap(i + 12) / N, lat: (l >= 0 ? -1 : 1) * s.halfWidth[wrap(i + 12)] * 0.55 };
      };
      let straight = 0, best = Infinity;
      for (let i = 0; i < N; i += 4) {
        let acc = 0;
        for (let k = 0; k < 60; k++) acc += Math.abs(s.curvature[wrap(i + k)]);
        if (acc < best && Math.abs(i - tr.startIndex) > 80) { best = acc; straight = i; }
      }
      let corner = 0, cmax = 0;
      for (let i = 0; i < N; i++) if (Math.abs(s.curvature[i]) > cmax && s.rampId[i] < 0) { cmax = Math.abs(s.curvature[i]); corner = i; }
      let dip = 0, dmax = -Infinity;
      for (let i = 0; i < N; i += 2) {
        let a = 0;
        for (let k = -25; k <= 25; k++) a += s.py[wrap(i + k)];
        const d = a / 51 - s.py[i];
        if (d > dmax) { dmax = d; dip = i; }
      }
      window.__lookSpots = {
        straight: { t: straight / N, lat: 0 },
        corner: { t: wrap(corner - 28) / N, lat: 0 },
        ramp: tr.ramps[0] ? { t: (tr.ramps[0].d0 - 26) / L, lat: 0 } : null,
        pad: tr.pads[0] ? { t: (tr.pads[0].d0 - 14) / L, lat: tr.pads[0].lateral * 0.5 } : null,
        water: find(3), wall: find(1), void: find(2),
        dip: dmax > 0.4 ? { t: wrap(dip - 22) / N, lat: 0 } : null,
      };
    }, { id, q: quality, cpus });

    const trackInfo = { id, shots: [], perf: null };
    for (const v of views) {
      const ok = await page.evaluate(async (v) => {
        const kk = window.__kk, g = kk.game, rig = g.cameraRig;
        rig.override = null;
        kk.setCamera(null);
        const spot = window.__lookSpots[v];
        if (v === 'start') return true;
        if (v === 'unfold') return !!g.track.rampMeshes[0];
        if (g.phase === 'countdown') { g.loop.timeScale = 1; kk.simulate(3.4); g.loop.timeScale = 0; }
        if (['top', 'side'].includes(v)) {
          const sp = window.__lookSpots.straight;
          kk.teleport(g.player.index, sp.t, 0);
          kk.setCamera(v);
          return true;
        }
        if (v === 'hole') {
          // above the road edge, looking down into the cut past the band
          const sp = window.__lookSpots.void;
          if (!sp) return false;
          const tr = g.track, side = Math.sign(sp.lat), N = tr.sampleCount;
          const t = (sp.t + 20 / tr.length) % 1, i = Math.round(t * N) % N;
          const w = tr.samples.halfWidth[i] + tr.samples.offroad[i];
          const eye = tr.pointAt(t, side * (w - 6), {}).pos.clone().add(new g.THREE.Vector3(0, 6, 0));
          const at = tr.pointAt((t + 22 / tr.length) % 1, side * (w + 18), {}).pos.clone();
          at.y = tr.pageY - 5;
          rig.override = { update(dt, cam) { cam.position.copy(eye); cam.lookAt(at); } };
          return true;
        }
        if (v === 'gutter') {
          // straight down where the road crosses the book's spine (x = page centre)
          const tr = g.track, s = tr.samples, b = tr.bounds;
          const cx = (b.min.x + b.max.x) / 2;
          let bi = 0;
          for (let i = 0; i < tr.sampleCount; i++) if (Math.abs(s.px[i] - cx) < Math.abs(s.px[bi] - cx)) bi = i;
          const eye = new g.THREE.Vector3(cx + 0.01, tr.pageY + 70, s.pz[bi] + 30);
          const at = new g.THREE.Vector3(cx, tr.pageY, s.pz[bi]);
          rig.override = { update(dt, cam) { cam.position.copy(eye); cam.lookAt(at); } };
          return true;
        }
        if (v === 'overview' || v === 'edge') {
          const b = g.track.bounds, py = g.track.pageY;
          const m = g.config.track.pageMargin;
          const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
          const eye = new g.THREE.Vector3(), at = new g.THREE.Vector3();
          // overview: high outside the page corner looking back at it; edge: low, outside the far edge
          if (v === 'overview') { eye.set(b.max.x + m + 140, py + 230, b.max.z + m + 180); at.set(b.max.x + m - 120, py, b.max.z + m - 120); }
          else { eye.set(cx + 30, py + 5, b.max.z + m + 55); at.set(cx - 10, py - 1, b.max.z + m); }
          rig.override = { update(dt, cam) { cam.position.copy(eye); cam.lookAt(at); } };
          return true;
        }
        if (!spot) return false;
        kk.teleport(g.player.index, spot.t, spot.lat);
        const p = g.player;
        p.vel.set(Math.sin(p.heading) * 16, 0, Math.cos(p.heading) * 16);
        g.loop.timeScale = 1;
        kk.simulate(0.25);
        g.loop.timeScale = 0;
        return true;
      }, v);
      if (!ok) continue;
      if (v === 'unfold') {
        // scenery drives popup ramps every frame, so set, render and read the canvas in one task
        const shots = await page.evaluate(() => {
          const kk = window.__kk, g = kk.game, rig = g.cameraRig, tr = g.track;
          const r = tr.ramps[0], e = tr.rampMeshes[0];
          if (!r || !e?.setUnfold) return null;
          const side = tr.pointAt((r.d0 - 8) / tr.length, -tr.samples.halfWidth[0] - 6, {}).pos.clone();
          const mid = tr.pointAt(((r.d0 + r.d1) / 2) / tr.length, 0, {}).pos.clone();
          side.y += 4;
          rig.override = { update(dt, cam) { cam.position.copy(side); cam.lookAt(mid); } };
          const out = [];
          for (const u of [0.2, 0.6, 1]) {
            e.setUnfold(u);
            rig.update(0);
            kk.renderFrame();
            out.push(g.renderer.domElement.toDataURL('image/png'));
          }
          return out;
        });
        if (shots) {
          shots.forEach((url, k) => {
            const file = path.join(OUT, `${id}-unfold${k}-${quality}.png`);
            fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
            trackInfo.shots.push(path.relative(ROOT, file).replace(/\\/g, '/'));
          });
        }
        continue;
      }
      await page.waitForTimeout(v === 'start' ? 250 : 700);
      const file = path.join(OUT, `${id}-${v}-${quality}.png`);
      await page.screenshot({ path: file });
      trackInfo.shots.push(path.relative(ROOT, file).replace(/\\/g, '/'));
      if (v === 'straight') trackInfo.perf = await page.evaluate(() => { const p = window.__kk.perf(); return { drawCalls: p.drawCalls, shadowCalls: p.shadowCalls, triangles: p.triangles }; });
    }
    await page.evaluate(() => { const g = window.__kk.game; g.cameraRig.override = null; window.__kk.setCamera(null); g.loop.timeScale = 1; });
    report.tracks.push(trackInfo);
  }
  if (views.includes('title')) {
    await page.evaluate(() => window.__kk.game.api.quitToTitle());
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, `title-${quality}.png`) });
  }
  const tail = await page.evaluate(() => {
    const kk = window.__kk;
    kk.game.api.quitToTitle();
    return { errors: kk.errors.slice(0, 20), warnings: kk.warnings.filter((w) => !w.startsWith('[track:')).slice(0, 20), layout: kk.layoutWarnings(), leaks: kk.leaks() };
  });
  await page.waitForTimeout(300);
  const leaks2 = await page.evaluate(() => window.__kk.leaks());
  Object.assign(report, { errors: report.errors.concat(tail.errors), warnings: tail.warnings, layout: tail.layout, leaks: leaks2 });
  console.log(JSON.stringify(report, null, 1));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
