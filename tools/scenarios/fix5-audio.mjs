// Fix round 5 (audio): the final-lap stinger lands on the "SON TUR" event and the key/tempo change
// follows on the next beat; the Turkish sound hint shows for a pad-only player (audio really locked:
// Chromium launched with --autoplay-policy=user-gesture-required) and goes once a key unlocks audio.
// node tools/scenarios/fix5-audio.mjs [--port 8795]
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'out', 'fix5');
const port = +(process.argv[process.argv.indexOf('--port') + 1] || 8795) || 8795;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

const padInit = () => {
  const pad = { id: 'fix5 pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__pad = pad;
  window.__padSet = (i, on) => { pad.buttons[i] = { pressed: !!on, touched: !!on, value: on ? 1 : 0 }; pad.timestamp++; };
  navigator.getGamepads = () => [pad, null, null, null];
  // Chrome's autoplay rule, emulated (Playwright's Chromium lets audio start without a gesture): a
  // context made or resumed outside a user activation stays suspended.
  const AC = window.AudioContext;
  const resume = AC.prototype.resume;
  AC.prototype.resume = function () { return navigator.userActivation.isActive ? resume.call(this) : Promise.resolve(); };
  // Playwright's evaluate() counts as a user gesture for ~5 s, so the pad's A press comes from a timer
  // here, 12 s after load, long after the last evaluate that could have granted activation.
  setTimeout(() => { window.__padSet(0, true); setTimeout(() => window.__padSet(0, false), 120); }, 12000);
  window.AudioContext = class extends AC {
    constructor(o) { super(o); if (!navigator.userActivation.isActive) this.suspend(); }
  };
};

async function main() {
  let server = null;
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await sleep(100);
  }
  const { browser } = await launch({ extraArgs: ['--autoplay-policy=user-gesture-required'] });
  const R = { errors: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(padInit);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => R.errors.push(String(e.message || e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') R.errors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => window.__kk && window.__kk.ready, null, { timeout: 30000 });

    const hint = () => page.evaluate(() => { const e = document.querySelector('.kk-sound'); return { shown: !!e && !e.hidden, text: e?.textContent, audio: window.__kk.game.systems.audio.state }; });
    const btn = async (i) => { await page.evaluate((i) => window.__padSet(i, true), i); await sleep(90); await page.evaluate((i) => window.__padSet(i, false), i); await sleep(250); };

    // 1) pad only: title → menu with A (timer at 12 s); audio stays locked, the hint appears after a second
    await sleep(15000);
    R.menuHint = await hint();
    await page.screenshot({ path: path.join(OUT, 'audio-hint-menu-pad.png') });
    // 2) a key press is a user gesture: audio unlocks and the hint goes
    await page.keyboard.press('Shift');
    await sleep(600);
    R.afterKey = await hint();
    await page.screenshot({ path: path.join(OUT, 'audio-hint-after-key.png') });

    // 3) final lap: the stinger starts on the event, the race theme changes key/tempo on the next beat
    for (const track of ['bosphorus', 'meadow']) {
      await page.evaluate(async (track) => {
        const kk = window.__kk;
        await kk.startRace({ mode: 'single', track, seed: 2, skipIntro: true, autopilot: true });
      }, track);
      await page.waitForFunction(() => window.__kk.game.phase === 'race', null, { timeout: 20000 });
      await page.evaluate(() => {
        const g = window.__kk.game, A = g.systems.audio;
        window.__fl = null;
        window.__flOff = g.events.on('finalLap', (e) => {
          if (e.kart !== g.player) return;
          const c = A.ctx;
          window.__fl = { at: c.currentTime, before: A.debug.music(), voices: A.debug.voices() };
          setTimeout(() => { window.__fl.after10ms = { voices: A.debug.voices() }; }, 10);
        });
        window.__kk.setTimeScale(16);
      });
      await page.waitForFunction(() => { const p = window.__kk.game.player; return p.lap === 2 && p.progress > 2 * window.__kk.game.track.length - 80; }, null, { polling: 20, timeout: 90000 });
      await page.evaluate(() => window.__kk.setTimeScale(1));
      await page.waitForFunction(() => window.__fl && window.__fl.after10ms, null, { timeout: 20000 });
      const seq = [];
      for (let i = 0; i < 8; i++) {
        seq.push(await page.evaluate(() => {
          const A = window.__kk.game.systems.audio, m = A.debug.music();
          return `${(A.ctx.currentTime - window.__fl.at).toFixed(2)}s key+${m?.transpose} tempo ${m?.tempo?.toFixed(1)} ${m?.section}`;
        }));
        await sleep(150);
      }
      R['finalLap-' + track] = { ...(await page.evaluate(() => window.__fl)), seq };
      await page.evaluate(() => { window.__flOff(); window.__kk.game.api.quitToTitle(); });
      await sleep(400);
    }
    R.kkErrors = await page.evaluate(() => [...window.__kk.errors, ...window.__kk.warnings].slice(0, 10));
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  console.log(JSON.stringify(R, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
