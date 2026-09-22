// Screenshots of the placeholder track's features from the chase camera plus a top view.
// node tools/scenarios/core-shots.mjs [--port 8765] [--quality high|medium|low]
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'out');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const port = +arg('--port', 8765);
const quality = arg('--quality', 'high');

const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

let server = null;
let browser = null;
try {
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await new Promise((r) => setTimeout(r, 100));
  }
  ({ browser } = await launch());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__kk && window.__kk.ready);
  await page.evaluate(async (q) => {
    const kk = window.__kk;
    kk.setAutoPause(false);
    kk.game.api.setSetting('quality', q);
    await kk.startRace({ track: 'meadow', mode: 'single', autopilot: true, skipIntro: true, seed: 11 });
    kk.simulate(3.3);
  }, quality);

  const views = [
    { name: 'ramp', lat: 0, run: 0.35 },
    { name: 'water', lat: -3, run: 0.3 },
    { name: 'pad', lat: -3, run: 0.3 },
    { name: 'tongue', lat: 0, run: 0.3 },
    { name: 'sweeper', lat: 0, run: 0.8 },
  ];
  for (const v of views) {
    await page.evaluate(({ name, lat, run }) => {
      const kk = window.__kk;
      const g = kk.game;
      const L = g.track.length;
      const T = {
        ramp: (g.track.ramps[0].d0 - 26) / L,
        water: 0.78,
        pad: (g.track.pads[1].d0 - 14) / L,
        tongue: g.track.analysis.shortcuts[0].t0,
        sweeper: 0.06,
      }[name];
      kk.teleport(g.player.index, T, lat);
      g.player.vel.set(Math.sin(g.player.heading) * 18, 0, Math.cos(g.player.heading) * 18);
      kk.simulate(run);
    }, v);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `core-${v.name}-${quality}.png`) });
  }
  await page.evaluate(() => { window.__kk.setCamera('top'); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `core-top-${quality}.png`) });
  await page.evaluate(() => { window.__kk.setCamera('side'); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `core-side-${quality}.png`) });
  const info = await page.evaluate(() => ({ perf: window.__kk.perf(), errors: window.__kk.errors.slice() }));
  console.log(JSON.stringify(info));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
