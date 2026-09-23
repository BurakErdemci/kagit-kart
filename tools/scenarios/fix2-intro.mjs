// Intro-camera frames at fixed times (low grazing views of the road and band, QA-1 #19 evidence shots).
// node tools/scenarios/fix2-intro.mjs [--port 8792] [--tag cur] [--tracks all|meadow,...] [--at 0.5,2.5,4.5]
// [--quality high]. Shots land in tools/out/fix2/<tag>/intro-<track>-<t>s-<quality>.png.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const port = +arg('port', 8792);
const tag = arg('tag', 'cur');
const quality = arg('quality', 'high');
const times = String(arg('at', '2.5')).split(',').map(Number);
const OUT = path.join(ROOT, 'tools', 'out', 'fix2', tag);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

let server = null, browser = null;
try {
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await sleep(100);
  }
  ({ browser } = await launch());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__kk && window.__kk.ready, null, { timeout: 30000 });
  await page.addStyleTag({ content: '#kk-root > :not(canvas) { visibility: hidden !important; }' });
  await page.evaluate((q) => { const kk = window.__kk; kk.setAutoPause(false); if (kk.game.settings.quality !== q) kk.game.api.setSetting('quality', q); }, quality);
  const cup = await page.evaluate(() => window.__kk.game.gp.cup.slice());
  const tracks = arg('tracks', 'all') === 'all' ? cup : arg('tracks').split(',');
  const shots = [];
  for (const track of tracks) {
    await page.evaluate((track) => { window.__kk.startRace({ mode: 'single', track, seed: 4, skipIntro: false, autopilot: true }); }, track);
    await page.waitForFunction(() => window.__kk.game.phase === 'intro', null, { timeout: 30000 });
    const t0 = Date.now();
    for (const t of times) {
      const wait = t * 1000 - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      const f = path.join(OUT, `intro-${track}-${t}s-${quality}.png`);
      await page.screenshot({ path: f });
      shots.push(path.relative(ROOT, f).split(path.sep).join('/'));
    }
    await page.evaluate(() => window.__kk.game.api.quitToTitle());
    await sleep(300);
  }
  const errors = await page.evaluate(() => window.__kk.errors.slice(0, 5));
  console.log(JSON.stringify({ shots, errors }));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
