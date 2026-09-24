// First-impression verification: title, every menu screen, the chapter page turn, intros, podium,
// results/standings, HUD minimap, the ink bottle, at desktop and phone-portrait sizes.
// node tools/scenarios/fix4.mjs [--port 8794] [--tag before|after] [--only title,menus,track,intro,podium,race,ink,portrait,landscape]
//   [--tracks meadow,bosphorus,glacier,desk]
// Screenshots land in tools/out/fix4/<tag>/; a JSON summary is printed at the end.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const port = +arg('--port', 8794);
const tag = arg('--tag', 'after');
const only = arg('--only', 'title,menus,track,intro,podium,race,ink,portrait,landscape').split(',');
const TRACKS = arg('--tracks', 'meadow,bosphorus,glacier,desk').split(',');
const OUT = path.join(ROOT, 'tools', 'out', 'fix4', tag);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

const report = { shots: [], checks: {}, errors: [], console: [] };
let server = null;
let browser = null;

async function openPage(viewport, contextOpts = {}) {
  const context = await browser.newContext({ viewport, ...contextOpts });
  const page = await context.newPage();
  page.on('pageerror', (e) => report.errors.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') report.console.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__kk && window.__kk.ready, null, { timeout: 30000 });
  await page.evaluate(() => window.__kk.setAutoPause(false));
  return { context, page };
}

function shooter(page, prefix) {
  return async (name) => {
    const file = path.join(OUT, `${prefix}-${name}.png`);
    await page.screenshot({ path: file });
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    report.shots.push(rel);
    return rel;
  };
}

const waitPhase = (page, phases, timeout = 60000) => page.waitForFunction((a) => a.includes(window.__kk.game.phase), Array.isArray(phases) ? phases : [phases], { timeout, polling: 50 });
const key = async (page, k, n = 1, gap = 160) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await sleep(gap); } };
const api = (page, fn, ...args) => page.evaluate(([f, a]) => window.__kk.game.api[f](...a), [fn, args]);

// Elements with their own text or buttons that leave the viewport, and text that wraps inside a
// lettering/nowrap element.
const layoutCheck = (page) => page.evaluate(() => {
  const out = [];
  for (const e of document.querySelectorAll('.kk-ui *')) {
    if (e.offsetParent === null || e.closest('[hidden]')) continue;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const b = e.getBoundingClientRect();
    if (b.width < 4 || b.height < 4) continue;
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || e.tagName === 'BUTTON';
    if (!own) continue;
    // index tabs hang off the page edge by design; their labels are checked on their own
    if (e.classList.contains('kk-chtab') || e.classList.contains('kk-step')) continue;
    if (b.right > innerWidth + 1 || b.bottom > innerHeight + 1 || b.left < -1 || b.top < -1) out.push(`off ${String(e.className).slice(0, 40)} "${(e.innerText || '').slice(0, 20)}" [${b.left | 0},${b.top | 0},${b.right | 0},${b.bottom | 0}]`);
  }
  return out.slice(0, 12);
});

try {
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await sleep(100);
  }
  ({ browser } = await launch());

  // ------------------------------------------------------------------ title + keyboard menu walk, desktop
  if (only.includes('title') || only.includes('menus') || only.includes('track')) {
    const { context, page } = await openPage({ width: 1280, height: 720 });
    const shot = shooter(page, 'desk');
    if (only.includes('title')) {
      await sleep(250); await shot('title-0.25s');
      await sleep(900); await shot('title-1.2s');
      await sleep(2000); await shot('title-3.2s');
      report.checks.titleText = await page.evaluate(() => document.querySelector('.kk-ui')?.innerText.slice(0, 200));
      await page.keyboard.press('Enter');
      // labels carry the real time since the key press (a screenshot itself takes 100–300 ms)
      const t0 = Date.now();
      for (const at of [150, 450, 750, 1100, 1500]) {
        const w = at - (Date.now() - t0);
        if (w > 0) await sleep(w);
        await shot(`title-open-${((Date.now() - t0) / 1000).toFixed(2)}s`);
      }
      await sleep(1500); await shot('mode');
    } else {
      await sleep(800);
      await page.keyboard.press('Enter');
      await sleep(2200);
    }
    report.checks.modeFocus = await page.evaluate(() => document.querySelector('.kk-card.is-focus')?.innerText.split('\n')[0] || null);
    report.checks.modeLayout = await layoutCheck(page);
    if (only.includes('menus') || only.includes('track')) {
      await key(page, 'ArrowRight'); await sleep(300);
      await key(page, 'Enter'); await sleep(900); await shot('class');
      report.checks.classLayout = await layoutCheck(page);
      await key(page, 'Enter'); await sleep(1600); await shot('character');
      report.checks.charLayout = await layoutCheck(page);
      await key(page, 'Enter'); await sleep(1400); await shot('track-meadow');
      report.checks.trackLayout = await layoutCheck(page);
      const pageTitles = [];
      for (const [i, id] of ['bosphorus', 'glacier', 'desk'].entries()) {
        await key(page, 'ArrowDown');
        if (i === 1) { await sleep(250); await shot('track-turn-0.25s'); await sleep(350); await shot('track-turn-0.6s'); await sleep(900); }
        else await sleep(1500);
        await shot('track-' + id);
        pageTitles.push(await page.evaluate(() => ({ sel: window.__kk.game.selection.trackId, card: document.querySelector('.kk-chapter')?.innerText.replace(/\s+/g, ' ').slice(0, 60), page: window.__kk.game.systems.cinematics.pageChapter ?? null })));
      }
      report.checks.trackPages = pageTitles;
      if (only.includes('menus')) {
        await key(page, 'Escape'); await sleep(900);
        await key(page, 'Escape'); await sleep(900);
        await key(page, 'Escape'); await sleep(900);
        await api(page, 'setMenuScreen', 'settings'); await sleep(1100); await shot('settings');
        report.checks.settingsLayout = await layoutCheck(page);
        await api(page, 'setMenuScreen', 'controls'); await sleep(1100); await shot('controls');
        await api(page, 'setMenuScreen', 'title'); await sleep(2400); await shot('back-to-title');
      }
    }
    await context.close();
  }

  // ------------------------------------------------------------------ intros
  if (only.includes('intro')) {
    const { context, page } = await openPage({ width: 1280, height: 720 });
    const shot = shooter(page, 'intro');
    await sleep(600);
    for (const id of TRACKS) {
      await page.evaluate((t) => { window.__kk.startRace({ track: t, mode: 'single', seed: 3 }); }, id);
      await waitPhase(page, 'intro', 30000);
      const t0 = Date.now();
      for (const at of [0.6, 1.6, 2.5, 3.4, 4.4, 5.4]) {
        const w = at * 1000 - (Date.now() - t0);
        if (w > 0) await sleep(w);
        if (await page.evaluate(() => window.__kk.game.phase) !== 'intro') break;
        await shot(`${id}-${at}s`);
      }
      await waitPhase(page, ['countdown', 'race'], 20000);
    }
    await context.close();
  }

  // ------------------------------------------------------------------ podium (GP final race, finished at once)
  if (only.includes('podium')) {
    const { context, page } = await openPage({ width: 1280, height: 720 });
    const shot = shooter(page, 'podium');
    await sleep(600);
    await page.evaluate(() => window.__kk.startGP({ index: 3, standings: { tilki: 42, kurbaga: 45, penguen: 30, ayi: 20 }, seed: 5 }));
    await waitPhase(page, ['intro', 'countdown'], 30000);
    await api(page, 'skipCinematic');
    await waitPhase(page, ['countdown', 'race'], 20000);
    await page.evaluate(() => window.__kk.setTimeScale(8));
    await page.waitForFunction(() => window.__kk.game.raceTime > 8, null, { timeout: 30000 });
    await page.evaluate(() => { window.__kk.setTimeScale(1); window.__kk.finishNow(); });
    await waitPhase(page, 'results', 30000);
    await sleep(1800); await shot('results');
    report.checks.resultsLayout = await layoutCheck(page);
    await key(page, 'Enter'); await sleep(2200); await shot('standings');
    report.checks.standingsHead = await page.evaluate(() => document.querySelector('.kk-board')?.innerText.slice(0, 80));
    await key(page, 'Enter');
    await waitPhase(page, 'podium', 30000);
    const t0 = Date.now();
    for (const at of [0.8, 2.0, 3.0, 4.5, 6.0, 9.0]) {
      const w = at * 1000 - (Date.now() - t0);
      if (w > 0) await sleep(w);
      await shot(`${at}s`);
    }
    report.checks.podiumText = await page.evaluate(() => document.querySelector('.kk-ui')?.innerText.replace(/\s+/g, ' ').slice(0, 200));
    await key(page, 'Enter'); await sleep(2000); await shot('back-to-title');
    report.checks.podiumLeaks = await page.evaluate(() => window.__kk.leaks());
    await context.close();
  }

  // ------------------------------------------------------------------ HUD, minimap over curbs, results
  if (only.includes('race')) {
    const { context, page } = await openPage({ width: 1280, height: 720 });
    const shot = shooter(page, 'race');
    await sleep(600);
    for (const id of ['meadow', 'desk']) {
      await page.evaluate((t) => window.__kk.startRace({ track: t, mode: 'single', seed: 2, skipIntro: true }), id);
      await waitPhase(page, ['countdown', 'race'], 30000);
      await page.waitForFunction(() => window.__kk.game.raceTime > 9, null, { timeout: 30000 });
      await shot(`${id}-hud-9s`);
      await page.waitForFunction(() => window.__kk.game.raceTime > 17, null, { timeout: 30000 });
      await shot(`${id}-hud-17s`);
    }
    await context.close();
  }

  // ------------------------------------------------------------------ ink bottle and drops
  if (only.includes('ink')) {
    const { context, page } = await openPage({ width: 1280, height: 720 });
    const shot = shooter(page, 'ink');
    await sleep(600);
    await page.evaluate(() => window.__kk.startRace({ track: 'meadow', mode: 'single', seed: 4, skipIntro: true }));
    await waitPhase(page, ['countdown', 'race'], 30000);
    await page.waitForFunction(() => window.__kk.game.raceTime > 6, null, { timeout: 30000 });
    // the player throws ink at the karts ahead: the bottle arcs away in front of the chase camera
    await page.evaluate(() => {
      const g = window.__kk.game, p = g.player;
      const other = g.karts.find((k) => !k.isPlayer);
      window.__kk.teleport(other.index, (p.trackInfo.t + 30 / g.track.length) % 1, 1.5);
      window.__kk.giveItem(p.index, 'ink');
    });
    await page.evaluate(() => { window.__kk.game.player.autopilot = false; window.__kk.setControls({ throttle: 1 }); });
    await sleep(400); await shot('held-slot');
    await page.evaluate(() => window.__kk.setControls({ throttle: 1, item: true }));
    await sleep(60);
    await page.evaluate(() => window.__kk.setControls({ throttle: 1 }));
    const t0 = Date.now();
    for (const at of [120, 300, 520, 800, 1100, 1500]) {
      const w = at - (Date.now() - t0);
      if (w > 0) await sleep(w);
      await shot(`thrown-${((Date.now() - t0) / 1000).toFixed(2)}s`);
    }
    report.checks.inkProjectiles = await page.evaluate(() => window.__kk.events().filter((e) => e.name === 'projectile' || e.name === 'itemUse').slice(-4).map((e) => e.name + ':' + (e.detail?.kind || e.detail?.item)));
    // close-ups: freeze the frame and put a test camera beside the bottle in flight, then at the burst
    const close = async (name, where) => {
      const ok = await page.evaluate((w) => {
        const g = window.__kk.game;
        let target = null;
        if (w === 'bottle') target = g.systems.items.projectiles.find((x) => x.kind === 'ink')?.pos;
        else target = g.player.pos.clone().add({ x: 0, y: 0, z: 0 });
        if (!target) return false;
        const t = target.clone();
        g.paused = true;
        const d = w === 'bottle' ? 4.5 : 9;
        g.cameraRig.override = { update(dt, c) { c.position.set(t.x + d, t.y + d * 0.35, t.z + d * 0.6); c.lookAt(t); c.updateMatrixWorld(); } };
        document.querySelector('.kk-ui').style.opacity = '0';
        return true;
      }, where);
      if (!ok) return;
      await sleep(250);
      await shot(name);
      await page.evaluate(() => { const g = window.__kk.game; g.cameraRig.override = null; g.paused = false; document.querySelector('.kk-ui').style.opacity = ''; });
    };
    await page.evaluate(() => { window.__kk.giveItem(window.__kk.game.player.index, 'ink'); });
    await sleep(300);
    await page.evaluate(() => window.__kk.setControls({ throttle: 1, item: true }));
    await sleep(60);
    await page.evaluate(() => window.__kk.setControls({ throttle: 1 }));
    await sleep(220);
    await close('close-bottle', 'bottle');
    await sleep(250);
    await close('close-bottle-2', 'bottle');
    // follow the bottle until it bursts, then look at the burst and at the splats on the road
    const burst = await page.evaluate(async () => {
      const g = window.__kk.game;
      let last = null;
      for (let i = 0; i < 80; i++) {
        const p = g.systems.items.projectiles.find((x) => x.kind === 'ink');
        if (!p) break;
        last = p.pos.clone();
        await new Promise((r) => setTimeout(r, 25));
      }
      return last && { x: last.x, y: last.y, z: last.z };
    });
    for (const [name, wait] of [['close-burst', 60], ['close-splats', 500]]) {
      if (!burst) break;
      await sleep(wait);
      await page.evaluate((b) => {
        const g = window.__kk.game;
        g.paused = true;
        g.cameraRig.override = { update(dt, c) { c.position.set(b.x + 9, b.y + 2, b.z + 9); c.lookAt(b.x, b.y - 3, b.z); c.updateMatrixWorld(); } };
        document.querySelector('.kk-ui').style.opacity = '0';
      }, burst);
      await sleep(250);
      await shot(name);
      await page.evaluate(() => { const g = window.__kk.game; g.cameraRig.override = null; g.paused = false; document.querySelector('.kk-ui').style.opacity = ''; });
    }
    // side view of the player's own bottle: debug side camera
    await page.evaluate(() => window.__kk.setCamera('side'));
    await sleep(200); await shot('side');
    await page.evaluate(() => window.__kk.setCamera(null));
    await context.close();
  }

  // ------------------------------------------------------------------ the whole first-time walk, keyboard
  // title → Grand Prix → class → driver → intro → countdown → race (keys) → finish → results →
  // standings → races 2–4 (finished at once) → podium → back to the title
  if (only.includes('walk')) {
    const { context, page } = await openPage({ width: 1280, height: 720 });
    const shot = shooter(page, 'walk');
    const W = {};
    await sleep(1500); await shot('01-title');
    await page.keyboard.press('Enter'); await sleep(2600); await shot('02-mode');
    W.modeFocus = await page.evaluate(() => document.querySelector('.kk-card.is-focus .kk-h')?.textContent || document.querySelector('.kk-card.is-focus')?.innerText.split('\n')[0]);
    await key(page, 'Enter'); await sleep(1200); await shot('03-class');
    await key(page, 'Enter'); await sleep(1800); await shot('04-character');
    await key(page, 'ArrowRight'); await sleep(1300); await shot('05-character-frog');
    await key(page, 'ArrowLeft'); await sleep(900);
    await key(page, 'Enter');
    await waitPhase(page, ['intro', 'countdown'], 30000);
    await sleep(1500); await shot('06-intro-1.5s');
    await sleep(2000); await shot('07-intro-3.5s');
    await waitPhase(page, 'countdown', 20000);
    await sleep(900); await shot('08-countdown');
    await page.keyboard.down('ArrowUp');
    await waitPhase(page, 'race', 10000);
    await sleep(2500); await shot('09-race-2.5s');
    await page.keyboard.up('ArrowUp');
    await page.evaluate(() => { window.__kk.game.player.autopilot = true; window.__kk.setTimeScale(8); });
    await page.waitForFunction(() => window.__kk.game.player.lap >= 3, null, { timeout: 120000 });
    await page.evaluate(() => window.__kk.setTimeScale(1));
    await sleep(300); await shot('10-final-lap');
    await page.evaluate(() => window.__kk.setTimeScale(8));
    await waitPhase(page, ['finishing', 'results'], 120000);
    await page.evaluate(() => window.__kk.setTimeScale(1));
    await sleep(700); await shot('11-finish');
    await waitPhase(page, 'results', 30000);
    await sleep(1800); await shot('12-results');
    await key(page, 'Enter'); await sleep(1600); await shot('13-standings');
    W.standings = await page.evaluate(() => document.querySelector('.kk-board .kk-kicker')?.textContent);
    for (let r = 2; r <= 4; r++) {
      await key(page, 'Enter');
      await waitPhase(page, ['intro', 'countdown'], 30000);
      await sleep(1200); await shot(`14-race${r}-intro`);
      await api(page, 'skipCinematic');
      await waitPhase(page, ['countdown', 'race'], 20000);
      await page.evaluate(() => { window.__kk.game.player.autopilot = true; window.__kk.setTimeScale(8); });
      await page.waitForFunction(() => window.__kk.game.raceTime > 12, null, { timeout: 60000 });
      await page.evaluate(() => { window.__kk.setTimeScale(1); window.__kk.finishNow(); });
      await waitPhase(page, 'results', 30000);
      await sleep(1500);
      await key(page, 'Enter'); await sleep(1400);
      if (r === 4) await shot('15-final-standings');
    }
    await key(page, 'Enter');
    await waitPhase(page, 'podium', 30000);
    await sleep(1000); await shot('16-podium-1s');
    await sleep(2600); await shot('17-podium-3.6s');
    await sleep(3000); await shot('18-podium-6.6s');
    await key(page, 'Enter'); await sleep(900); await shot('19-back-to-title-0.9s');
    await sleep(1800); await shot('20-back-to-title');
    W.leaks = await page.evaluate(() => window.__kk.leaks().leaks.length);
    W.phase = await page.evaluate(() => [window.__kk.game.phase, window.__kk.game.menuScreen, window.__kk.game.systems.cinematics.book]);
    report.checks.walk = W;
    await context.close();
  }

  // ------------------------------------------------------------------ phone sizes with touch
  for (const [flag, vp] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
    if (!only.includes(flag)) continue;
    const { context, page } = await openPage(vp, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const shot = shooter(page, flag);
    const cdp = await context.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 8, radiusY: 8, force: 1 })) });
    const tap = async (x, y) => { await touch('touchStart', [{ x, y, id: 9 }]); await sleep(60); await touch('touchEnd', []); await sleep(250); };
    const center = (sel, i = 0) => page.evaluate(([s, n]) => {
      const e = [...document.querySelectorAll(s)].filter((x) => x.offsetParent !== null)[n];
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, [sel, i]);
    const checks = {};
    await sleep(1200); await shot('title');
    checks.title = await layoutCheck(page);
    await tap(vp.width / 2, vp.height * 0.72);
    await sleep(1800); await shot('mode');
    checks.mode = await layoutCheck(page);
    let c = await center('.kk-card', 1);
    await tap(c.x, c.y); await sleep(1200); await shot('class');
    checks.class = await layoutCheck(page);
    c = await center('.kk-swatch', 1);
    await tap(c.x, c.y); await sleep(1600); await shot('character');
    checks.character = await layoutCheck(page);
    c = await center('.kk-chip.is-focus');
    await tap(c.x, c.y); await sleep(1600); await shot('track');
    checks.track = await layoutCheck(page);
    // a tap on a tab starts that chapter; --preview looks at the third one with the arrow keys first
    // (that turns the device to keyboard, so the race after it shows key glyphs)
    if (process.argv.includes('--preview')) {
      await key(page, 'ArrowDown', 2, 300); await sleep(1800); await shot('track-glacier');
      checks.trackGlacier = await layoutCheck(page);
    }
    await api(page, 'setMenuScreen', 'settings'); await sleep(1200); await shot('settings');
    checks.settings = await layoutCheck(page);
    await api(page, 'setMenuScreen', 'controls'); await sleep(1200); await shot('controls');
    await api(page, 'setSelection', { mode: 'single' });
    await page.evaluate(() => { window.__kk.game.api.startRace({ track: 'glacier', mode: 'single', seed: 3 }); });
    await waitPhase(page, ['intro', 'countdown', 'race'], 30000);
    await sleep(1400); await shot('intro');
    await api(page, 'skipCinematic');
    await waitPhase(page, ['countdown', 'race'], 20000);
    await sleep(900); await shot('countdown');
    await page.evaluate(() => { window.__kk.game.player.autopilot = true; });
    await page.waitForFunction(() => window.__kk.game.raceTime > 6, null, { timeout: 30000 });
    await shot('race');
    checks.race = await layoutCheck(page);
    await page.evaluate(() => { window.__kk.finishNow(); });
    await waitPhase(page, 'results', 30000);
    await sleep(1800); await shot('results');
    checks.results = await layoutCheck(page);
    // the cup's last race, finished at once, then the ceremony and a tap back to the title
    await page.evaluate(() => window.__kk.startGP({ index: 3, standings: { tilki: 42, kurbaga: 45, penguen: 30 }, seed: 5 }));
    await waitPhase(page, ['intro', 'countdown', 'race'], 30000);
    await api(page, 'skipCinematic');
    await waitPhase(page, ['countdown', 'race'], 20000);
    await page.evaluate(() => { window.__kk.setTimeScale(8); });
    await page.waitForFunction(() => window.__kk.game.raceTime > 8, null, { timeout: 30000 });
    await page.evaluate(() => { window.__kk.setTimeScale(1); window.__kk.finishNow(); });
    await waitPhase(page, 'results', 30000);
    await sleep(1500);
    await api(page, 'nextRace');
    await waitPhase(page, 'podium', 30000);
    await sleep(4200); await shot('podium');
    checks.podium = await layoutCheck(page);
    c = await center('.kk-podium-go');
    if (c) { await tap(c.x, c.y); await sleep(2400); await shot('back-to-title'); }
    checks.backPhase = await page.evaluate(() => [window.__kk.game.phase, window.__kk.game.systems.cinematics.book]);
    report.checks[flag] = checks;
    await context.close();
  }
} catch (e) {
  report.failure = String(e && e.stack || e);
  console.error('FAILED', e);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
  console.log(JSON.stringify({ tag, errors: report.errors, console: report.console.slice(0, 20), checks: report.checks, failure: report.failure || null }, null, 1));
  console.log('shots:', report.shots.length, 'in', path.relative(ROOT, OUT));
}
