// UI scenario against the real game (ARCHITECTURE.md §17). Screens and HUD states at 1920×1080 (keyboard
// only), a gamepad-only pass (a scripted standard-mapping pad behind navigator.getGamepads), 844×390 touch
// and 390×844 portrait. Checks: nothing but three.js leaves the machine, no web fonts, display type is the
// cut-paper lettering, zero console errors/warnings, listeners/UI DOM/leak check stable across two races.
// Screenshots: tools/out/ui/<context>-<nn>-<state>.png. Starts tools/serve.py itself if the port is free
// and always stops what it started.
// Usage: node tools/scenarios/ui.mjs [--port 8775] [--only desk,pad,touch,portrait] [--head items]
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'out', 'ui');
const arg = (name, fb) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fb);
const port = +arg('--port', 8775);
const only = new Set(String(arg('--only', 'desk,pad,touch,portrait')).split(','));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALLOWED = [`http://127.0.0.1:${port}/`, 'https://cdn.jsdelivr.net/npm/three@0.186.0/'];
// --head items,fx: serve the last committed entry file of those modules (git HEAD) — only for running while
// another lane's folder is half-written. Final verification runs without it.
const headModules = String(arg('--head', '')).split(',').filter(Boolean)
  .map((m) => [m, execFileSync('git', ['show', `HEAD:src/${m}/${m}.js`], { cwd: ROOT, encoding: 'utf8' })]);
if (headModules.length) console.log(`NOTE: serving git HEAD for ${headModules.map((m) => m[0]).join(', ')}`);

function portInUse(p) {
  return new Promise((resolve) => {
    const s = net.connect({ port: p, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.png')) rmSync(path.join(OUT, f));
const shots = [];
const external = [];
const consoleMsgs = [];
let server = null;
let browser = null;

// ------------------------------------------------------------------------------------------ page helpers
async function open(name, contextOpts, init = null) {
  const ctx = await browser.newContext(contextOpts);
  if (init) await ctx.addInitScript(init);
  for (const [mod, body] of headModules) {
    await ctx.route(`**/src/${mod}/${mod}.js`, (route) => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body }));
  }
  const page = await ctx.newPage();
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith('data:') && !u.startsWith('blob:') && !ALLOWED.some((a) => u.startsWith(a))) external.push(u); });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(`[${name}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => consoleMsgs.push(`[${name}] pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__kk && window.__kk.ready, null, { timeout: 30000 });
  await page.evaluate(() => window.__kk.setAutoPause(false));
  await sleep(700);
  let n = 0;
  const T = {
    ctx, page, name,
    ev: (fn, a) => page.evaluate(fn, a),
    async shot(state) {
      n++;
      const f = path.join(OUT, `${name}-${String(n).padStart(2, '0')}-${state}.png`);
      await page.screenshot({ path: f });
      shots.push(path.relative(ROOT, f).replace(/\\/g, '/'));
    },
    async key(k, wait = 320) { await page.keyboard.press(k); await sleep(wait); },
    wait: (fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout }),
    phase: () => page.evaluate(() => window.__kk.game.phase),
    // Focused item's words: cut-paper lettering is an SVG, so its aria-label stands in for its text.
    focus: () => page.evaluate(() => {
      const el = document.querySelector('.kk-ui .is-focus');
      if (!el) return '';
      const labels = [...el.querySelectorAll('svg[aria-label]')].map((s) => s.getAttribute('aria-label'));
      return [...labels, el.textContent].join(' ').trim().replace(/\s+/g, ' ');
    }),
  };
  return T;
}

// Keep kart.item alive while the core stub of items clears it every step (a real items module keeps it).
async function holdItems(T) {
  return T.ev(() => {
    const it = window.__kk.game.systems.items;
    if (!it || it.__uiHold || (it.boxes && it.boxes.length)) return false;
    it.__uiHold = it.update;
    it.update = () => {};
    return true;
  });
}

// Fast-forwards the race synchronously until the named condition holds (or the phase leaves the race).
async function simulateUntil(T, cond, maxSeconds = 200) {
  return T.ev(([name, max]) => {
    const g = window.__kk.game;
    const COND = {
      lap2: (p) => p.lap >= 2,
      lap3: (p) => p.lap >= 3,
      finished: (p) => p.finished || g.phase === 'results',
      results: () => g.phase === 'results',
    };
    for (let s = 0; s < max; s += 0.5) {
      if (!g.player || COND[name](g.player)) break;
      window.__kk.simulate(0.5);
    }
    window.__kk.renderFrame();
    return g.player ? { lap: g.player.lap, finished: g.player.finished, phase: g.phase } : { phase: g.phase };
  }, [cond, maxSeconds]);
}

// Real finish of the player: a one-lap race with the CPU karts held on the grid, so the player crosses the
// line first and the "finishing" phase (BİTİŞ banner, place tag, wait line) is on screen.
async function finishingShot(T) {
  await T.ev(() => window.__kk.startRace({ mode: 'single', track: 'meadow', laps: 1, skipIntro: true }));
  await T.wait(() => window.__kk.game.phase === 'countdown');
  await T.ev(() => window.__kk.simulate(3.2));
  await sleep(1300); // real frames retire the GO numerals before the fast-forward
  await T.ev(() => { for (const k of window.__kk.game.karts) if (!k.isPlayer) k.pinned = true; });
  const st = await simulateUntil(T, 'finished', 120);
  await sleep(700);
  await T.shot('finishing');
  check(`${T.name}: finish — BİTİŞ banner, place tag and wait line`, await T.ev(() => window.__kk.game.phase === 'finishing' &&
    !!document.querySelector('.kk-checker svg[aria-label="Bitiş!"]') && /bekleniyor/.test(document.querySelector('.kk-wait')?.textContent || '')), JSON.stringify(st));
  await T.ev(() => window.__kk.game.api.quitToTitle());
  await sleep(500);
}

// Share of the screen the ink splat covers: its SVG is rasterised off-screen and opaque pixels counted.
function inkCoverage(T) {
  return T.ev(async () => {
    const svg = document.querySelector('.kk-inkl svg');
    if (!svg) return -1;
    const W = 480, H = Math.round(480 * innerHeight / innerWidth);
    const clone = svg.cloneNode(true);
    clone.setAttribute('width', W);
    clone.setAttribute('height', H);
    clone.querySelectorAll('.kk-drip').forEach((d) => d.removeAttribute('class'));
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 100) n++;
    return n / (W * H);
  });
}

const typeCheck = (T) => T.ev(() => {
  const ff = getComputedStyle(document.querySelector('.kk-ui')).fontFamily;
  const links = [...document.querySelectorAll('link')].map((l) => l.href);
  const sheets = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
  return { ff, fonts: document.fonts.size, links, fontFace: /@font-face|@import/i.test(sheets), googleText: /googleapis|gstatic|Shrikhand|Sofia Sans/i.test(sheets + document.documentElement.outerHTML) };
});

async function hudStates(T, tag) {
  const { ev, shot } = T;
  const hold = await holdItems(T);
  if (hold) console.log(`  (${tag}: items is the core stub; kart.item kept alive for the HUD shots)`);
  await ev(() => window.__kk.giveItem(window.__kk.game.player.index, 'rocket3'));
  await sleep(350);
  await shot('item-rocket3');
  check(`${tag}: rocket3 window shows ×3`, await ev(() => document.querySelector('.kk-count')?.textContent === '×3' && getComputedStyle(document.querySelector('.kk-count')).display !== 'none'));
  // The real items module counts the roulette down and grants a random item at 0: check before the shot,
  // then end it by hand (0 written from outside grants nothing) so the landed item is known.
  await ev(() => { const p = window.__kk.game.player; p.item = 'plane'; p.itemCount = 1; p.rouletteDuration = 1.6; p.roulette = 1.6; });
  await sleep(200);
  check(`${tag}: roulette reel spins`, await ev(() => document.querySelector('.kk-reel')?.style.display === 'block'));
  await shot('roulette');
  await ev(() => { const p = window.__kk.game.player; p.item = 'plane'; p.roulette = 0; });
  await sleep(120);
  check(`${tag}: roulette lands with a thud on the item`, await ev(() => document.querySelector('.kk-slot').classList.contains('is-thud') && document.querySelector('.kk-slot-name').textContent === 'Kâğıt Uçak'));
  // Gum trails while the item button is held: with the real items module that is the player's own input.
  if (hold) await ev(() => { const p = window.__kk.game.player; p.item = 'gum'; p.itemCount = 1; p.itemHeld = true; });
  else {
    // use() refuses while spinning or respawning (a real CPU hit can land here), so the press is retried.
    for (let i = 0; i < 6 && !(await ev(() => window.__kk.game.player.itemHeld)); i++) {
      await ev(() => { const kk = window.__kk, p = kk.game.player; p.autopilot = false; p.item = 'gum'; p.itemCount = 1; kk.setControls({ throttle: 1 }); });
      await sleep(150);
      await ev(() => window.__kk.setControls({ throttle: 1, item: true }));
      await sleep(150);
    }
  }
  await sleep(350);
  await shot('item-held');
  check(`${tag}: held gum state`, await ev(() => document.querySelector('.kk-slot').classList.contains('is-held')), await ev(() => { const p = window.__kk.game.player; return JSON.stringify({ item: p.item, held: p.itemHeld, spin: p.spinTime, respawn: p.respawn.active }); }));
  if (hold) await ev(() => { const p = window.__kk.game.player; p.item = null; p.itemHeld = false; });
  else {
    await ev(() => window.__kk.setControls({ throttle: 1 }));
    await sleep(150);
    check(`${tag}: releasing the button drops the gum and clears the held state`, await ev(() => !document.querySelector('.kk-slot').classList.contains('is-held')));
    await ev(() => { const kk = window.__kk; kk.setControls(null); kk.game.player.autopilot = true; });
  }
  await ev(() => { const g = window.__kk.game; g.events.emit('threat', { kart: g.player, kind: 'homing', eta: 1.5 }); });
  await sleep(250);
  await shot('threat');
  check(`${tag}: threat marker at the screen edge`, await ev(() => {
    const t = document.querySelector('.kk-threat');
    if (!t || t.style.display !== 'block') return false;
    const r = t.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return Math.abs(cx - innerWidth / 2) > innerWidth * 0.3 || Math.abs(cy - innerHeight / 2) > innerHeight * 0.3;
  }));
  await sleep(1700);
  await ev(() => window.__kk.game.player.applyInk(3.5));
  await sleep(450);
  await shot('ink');
  const cover = await inkCoverage(T);
  check(`${tag}: ink splat covers ≤ 55% of the screen`, cover > 0.15 && cover <= 0.55, `${(cover * 100).toFixed(1)}%`);
  await sleep(3400);
  check(`${tag}: ink fades out with inkTime`, await ev(() => document.querySelector('.kk-inkl').hidden));
  await ev(() => { const g = window.__kk.game; g.events.emit('wrongWay', { kart: g.player, on: true }); });
  await sleep(300);
  await shot('wrong-way');
  await ev(() => { const g = window.__kk.game; g.events.emit('wrongWay', { kart: g.player, on: false }); });
  check(`${tag}: wrong-way sign clears`, await ev(() => !document.querySelector('.kk-wrong')));
  if (hold) await ev(() => { const it = window.__kk.game.systems.items; if (it?.__uiHold) { it.update = it.__uiHold; delete it.__uiHold; } });
}

// ------------------------------------------------------------------------------------------ run
try {
  if (!(await portInUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await portInUse(port)); i++) await sleep(100);
  }
  const l = await launch();
  browser = l.browser;
  console.log(`renderer: ${l.renderer}`);

  // ======================================================================== desktop, keyboard only
  if (only.has('desk')) {
    const T = await open('desk', { viewport: { width: 1920, height: 1080 } });
    const { ev, shot, key, wait } = T;
    const tc = await typeCheck(T);
    check('body text uses the system stack (config.fonts.body)', /system-ui/.test(tc.ff) && !/Sofia|Shrikhand/.test(tc.ff), tc.ff);
    check('no web fonts: no @font-face/@import, no font links, document.fonts empty', tc.fonts === 0 && !tc.fontFace && !tc.googleText && !tc.links.length, JSON.stringify(tc));
    const listeners0 = await ev(() => window.__kk.listenerCount());
    await shot('title');
    check('title: cloth cover with the cut-paper logo', await ev(() => !document.querySelector('.kk-coverwrap').hidden && !!document.querySelector('.kk-cover-title svg[aria-label="Kâğıt Kart"]')));
    const dom0 = await ev(() => document.querySelectorAll('.kk-ui *').length);
    await key('Enter', 1300);
    check('Enter opens the book → mode', await ev(() => window.__kk.game.menuScreen === 'mode' && window.__kk.game.phase === 'menu'));
    await shot('mode');
    check('menu headings are lettering SVGs', await ev(() => !!document.querySelector('.kk-head svg[aria-label="Nasıl yarışalım?"]')));
    await key('ArrowUp');
    check('↑ from the mode cards reaches Ayarlar', (await T.focus()).includes('Ayarlar'), await T.focus());
    await key('Enter', 600);
    check('settings screen open', await ev(() => window.__kk.game.menuScreen === 'settings'));
    const vol0 = await ev(() => window.__kk.game.settings.musicVolume);
    await key('ArrowLeft');
    const vol1 = await ev(() => window.__kk.game.settings.musicVolume);
    check('← on Müzik lowers musicVolume through api.setSetting', vol1 < vol0, `${vol0} → ${vol1}`);
    await key('ArrowRight');
    await key('ArrowDown'); await key('ArrowDown'); await key('ArrowDown');
    await shot('settings');
    await key('Escape', 600);
    check('Esc on settings → back to mode', await ev(() => window.__kk.game.menuScreen === 'mode'));
    await key('ArrowUp'); await key('ArrowRight');
    check('→ reaches Kontroller', (await T.focus()).includes('Kontroller'), await T.focus());
    await key('Enter', 600);
    await key('ArrowRight');
    await shot('controls');
    check('controls: device tabs switch with ←/→', await ev(() => document.querySelector('.kk-devtab.is-on')?.textContent === 'Oyun kolu'));
    await key('Escape', 600);
    await key('ArrowDown');
    check('↓ from the top buttons returns to a mode card', /Grand Prix|Tek Yarış|Zamana Karşı/.test(await T.focus()), await T.focus());
    for (let i = 0; i < 3 && !(await T.focus()).startsWith('Tek Yarış'); i++) await key('ArrowLeft');
    await key('Enter', 700);
    check('Tek Yarış → class', await ev(() => window.__kk.game.menuScreen === 'class' && window.__kk.game.selection.mode === 'single'));
    await shot('class');
    await key('Enter', 700);
    await shot('character');
    await key('ArrowRight', 450);
    check('character focus drives api.setMenuScreen(character)', await ev(() => window.__kk.game.selection.characterId !== 'tilki'));
    await shot('character-2');
    await key('Enter', 700);
    check('→ track screen (chapter tabs)', await ev(() => window.__kk.game.menuScreen === 'track'));
    await key('ArrowDown', 450);
    check('track focus drives setMenuScreen(track)', await ev(() => window.__kk.game.selection.trackId === 'bosphorus'));
    await shot('track');
    // Hold the intro shot open until "Geç" (the cinematics stub would resolve it at once).
    await ev(() => {
      const c = window.__kk.game.systems.cinematics;
      c.__uiPlay = c.play;
      c.play = (shot, o) => (shot === 'intro' ? new Promise(() => {}) : c.__uiPlay(shot, o));
    });
    await key('Enter', 200);
    await wait(() => window.__kk.game.phase === 'intro');
    await sleep(900);
    await shot('intro');
    check('intro chapter card names the track', await ev(() => !!document.querySelector('.kk-intro svg[aria-label="Boğaz Gecesi"]')));
    await key('Enter', 200);
    await wait(() => window.__kk.game.phase === 'countdown', null, 15000);
    await ev(() => { const c = window.__kk.game.systems.cinematics; c.play = c.__uiPlay; delete c.__uiPlay; });
    check('Enter skips the intro', true);
    await sleep(350);
    await shot('countdown');
    check('first race: controls card during the countdown', await ev(() => !!document.querySelector('.kk-teach')));
    // Start boost for real: throttle pressed ~0.85 s before GO and held.
    await wait(() => window.__kk.game.race?.countdown === 1, null, 5000);
    await sleep(140);
    await T.page.keyboard.down('ArrowUp');
    await wait(() => window.__kk.game.phase === 'race', null, 5000);
    await sleep(380);
    await shot('go');
    await T.page.keyboard.up('ArrowUp');
    check('start grade tag after a perfect start', await ev(() => [...document.querySelectorAll('.kk-grade svg')].some((s) => /çıkış/.test(s.getAttribute('aria-label')))),
      await ev(() => String(window.__kk.game.race.startGrade)));
    await ev(() => { window.__kk.game.player.autopilot = true; });
    await sleep(2600);
    await shot('race');
    // Cost of ui.update per frame over ~2 s of racing, and the frame's GL budget (§16; the UI itself is DOM only).
    const cost = await ev(async () => {
      const ui = window.__kk.game.systems.ui, orig = ui.update, t = [];
      ui.update = (dt) => { const a = performance.now(); orig(dt); t.push(performance.now() - a); };
      await new Promise((r) => setTimeout(r, 2000));
      ui.update = orig;
      t.sort((a, b) => a - b);
      const p = window.__kk.perf();
      return { frames: t.length, meanMs: +(t.reduce((s, x) => s + x, 0) / t.length).toFixed(3), p95Ms: +t[Math.floor(t.length * 0.95)].toFixed(3),
        drawCalls: p.drawCalls, shadowCalls: p.shadowCalls, triangles: p.triangles };
    });
    console.log(`  ui.update + frame budget: ${JSON.stringify(cost)}`);
    check('ui.update costs < 0.5 ms per frame on average', cost.meanMs < 0.5, JSON.stringify(cost));
    check('race frame within §16: ≤ 250 draw calls, ≤ 700k triangles', cost.drawCalls <= 250 && cost.triangles <= 700000, `${cost.drawCalls} calls, ${cost.triangles} tris`);
    await hudStates(T, 'desk');
    // Hints fire from real driving: corner (steering into a bend) and the first drift spark.
    const hints = await ev(() => { try { return JSON.parse(localStorage.getItem('kk1:uiHints') || '{}'); } catch { return {}; } });
    check('a one-time contextual hint has fired', Object.keys(hints).length > 0, JSON.stringify(hints));
    let st = await simulateUntil(T, 'lap2');
    await sleep(380);
    await shot('lap-flip');
    check('lap line: page-corner flip', await ev(() => !!document.querySelector('.kk-flip')), JSON.stringify(st));
    st = await simulateUntil(T, 'lap3');
    await sleep(420);
    await shot('final-lap');
    check('"SON TUR" banner slams in once', await ev(() => document.querySelectorAll('.kk-banner svg[aria-label="Son tur"]').length === 1), JSON.stringify(st));
    // pause: Esc opens (core), Esc on a sub-page goes back, Esc at the root resumes (UI)
    await key('Escape', 450);
    check('Esc pauses → pause menu', await ev(() => window.__kk.game.paused && !!document.querySelector('.kk-pause')));
    await shot('pause');
    await key('ArrowDown'); await key('ArrowDown'); await key('Enter', 500);
    check('pause → Ayarlar sub-page', await ev(() => !!document.querySelector('.kk-layer .kk-form')));
    await shot('pause-settings');
    await key('Escape', 450);
    check('Esc on the sub-page → back to the contents, still paused', await ev(() => window.__kk.game.paused && !!document.querySelector('.kk-pause')));
    await key('Escape', 450);
    check('Esc at the contents resumes', await ev(() => !window.__kk.game.paused && !document.querySelector('.kk-pause')));
    await key('KeyP', 400);
    await key('KeyP', 400);
    check('P opens and P closes the pause', await ev(() => !window.__kk.game.paused));
    st = await simulateUntil(T, 'finished', 260);
    await sleep(650);
    if (await ev(() => window.__kk.game.phase === 'finishing')) {
      await shot('finishing');
      check('finish: BİTİŞ banner + place tag', await ev(() => !!document.querySelector('.kk-checker svg[aria-label="Bitiş!"]')));
      await ev(() => window.__kk.finishNow());
    }
    await wait(() => window.__kk.game.phase === 'results', null, 15000);
    await sleep(1500);
    await shot('results');
    check('results board lists every kart', await ev(() => document.querySelectorAll('.kk-board .kk-tr:not(.kk-th)').length === window.__kk.game.karts.length));
    check('results place numerals are lettering', await ev(() => !!document.querySelector('.kk-board .kk-pl svg[aria-label="1."]')));
    await key('Enter', 400);
    await wait(() => ['intro', 'countdown'].includes(window.__kk.game.phase), null, 20000);
    check('"Tekrar yarış" restarts (race 2)', true);
    await wait(() => window.__kk.game.phase === 'countdown', null, 15000);
    await sleep(400);
    check('controls card only on the first race', await ev(() => !document.querySelector('.kk-teach')));
    await key('Escape', 450);
    await key('ArrowDown'); await key('ArrowDown'); await key('ArrowDown'); await key('ArrowDown');
    check('pause → "Menüye dön" focused', (await T.focus()).includes('Menüye dön'), await T.focus());
    await key('Enter', 900);
    check('Menüye dön → title', await ev(() => window.__kk.game.phase === 'title'));
    const leaks = await ev(() => window.__kk.leaks());
    check('two races: core leak check clean', leaks.leaks.length === 0, JSON.stringify(leaks.last?.problems || leaks.leaks));
    check('listener count back to the boot value', listeners0 === await ev(() => window.__kk.listenerCount()), `${listeners0} → ${await ev(() => window.__kk.listenerCount())}`);
    const dom1 = await ev(() => document.querySelectorAll('.kk-ui *').length);
    check('UI DOM back to its title size', dom1 === dom0, `${dom0} → ${dom1}`);

    // ---- time trial: track tabs with records, split vs ghost, results with a record stamp
    await key('Enter', 1300);
    await key('ArrowRight');
    check('mode → Zamana Karşı focused', (await T.focus()).startsWith('Zamana Karşı'), await T.focus());
    await key('Enter', 700); await key('Enter', 700); await key('Enter', 700);
    await shot('track-tt');
    await key('Enter', 200);
    await wait(() => window.__kk.game.phase === 'countdown', null, 20000);
    await wait(() => window.__kk.game.phase === 'race', null, 8000);
    await ev(() => { const g = window.__kk.game; g.player.autopilot = true; g.events.emit('checkpoint', { kart: g.player, index: 0, lap: 1, split: -0.42 }); });
    await sleep(350);
    await shot('tt-split');
    check('TT split vs ghost shown', await ev(() => document.querySelector('.kk-split')?.classList.contains('is-on')));
    await ev(() => window.__kk.game.api.quitToTitle());
    await sleep(500);
    await ev(() => window.__kk.startRace({ mode: 'tt', track: 'meadow', cls: '120', character: 'tilki', laps: 1, skipIntro: true }));
    await wait(() => window.__kk.game.phase === 'countdown');
    st = await simulateUntil(T, 'results', 150);
    await wait(() => window.__kk.game.phase === 'results', null, 15000);
    await sleep(1600);
    await shot('tt-results');
    check('TT results: lap table + "Yeni rekor!" stamp', await ev(() => !!document.querySelector('.kk-rekor svg')), JSON.stringify(st));
    await ev(() => window.__kk.game.api.quitToTitle());
    await sleep(500);
    await key('Enter', 1300);
    for (let i = 0; i < 3 && !(await T.focus()).startsWith('Zamana Karşı'); i++) await key('ArrowRight');
    await key('Enter', 700); await key('Enter', 700); await key('Enter', 700);
    check('TT track tabs show the record', await ev(() => /Rekor/.test(document.querySelector('.kk-best')?.textContent || '')),
      await ev(() => JSON.stringify({ screen: window.__kk.game.menuScreen, sel: window.__kk.game.selection, best: document.querySelector('.kk-best')?.textContent, keys: Object.keys(localStorage).filter((k) => k.includes('tt:')) })));
    await ev(() => window.__kk.game.api.quitToTitle());
    await sleep(500);

    await finishingShot(T);

    // ---- Grand Prix: last race → results with points → standings → podium → title
    await ev(() => window.__kk.startGP({ index: 3, standings: { tilki: 30, kurbaga: 34, penguen: 20, ayi: 25, kedi: 12, baykus: 18, tavsan: 6, ahtapot: 9 } }).catch(() => {}));
    await wait(() => ['intro', 'countdown', 'race'].includes(window.__kk.game.phase));
    await ev(() => window.__kk.game.api.skipCinematic());
    await wait(() => ['countdown', 'race'].includes(window.__kk.game.phase));
    await ev(() => window.__kk.finishNow());
    await wait(() => window.__kk.game.phase === 'results');
    await sleep(1500);
    await shot('results-gp');
    await key('Enter', 1500);
    await shot('standings');
    check('standings board shown', await ev(() => !!document.querySelector('.kk-board .kk-h svg[aria-label="Kupa sıralaması"]')));
    await key('Enter', 2600);
    check('last GP race → podium', await ev(() => window.__kk.game.phase === 'podium'));
    await shot('podium');
    await key('Enter', 900);
    check('podium → title', await ev(() => window.__kk.game.phase === 'title'));
    const errs = await ev(() => ({ errors: window.__kk.errors.slice(), warnings: window.__kk.warnings.slice() }));
    check('desk: no console errors', errs.errors.length === 0, errs.errors.slice(0, 3).join(' | '));
    check('desk: no console warnings', errs.warnings.length === 0, errs.warnings.slice(0, 3).join(' | '));
    await T.ctx.close();
  }

  // ======================================================================== gamepad only
  if (only.has('pad')) {
    const padInit = () => {
      const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
      const pad = { id: 'scripted pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
      window.__pad = pad;
      Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null], configurable: true });
    };
    const T = await open('pad', { viewport: { width: 1920, height: 1080 } }, padInit);
    const { ev, shot, wait } = T;
    const B = { A: 0, B: 1, X: 2, Y: 3, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
    const btn = async (b, wait2 = 330) => {
      await ev((i) => { const x = window.__pad.buttons[i]; x.pressed = true; x.value = 1; }, b);
      await sleep(90);
      await ev((i) => { const x = window.__pad.buttons[i]; x.pressed = false; x.value = 0; }, b);
      await sleep(wait2);
    };
    await btn(B.A, 1300);
    check('pad: A opens the book', await ev(() => window.__kk.game.menuScreen === 'mode'));
    await shot('mode');
    check('pad: prompts show pad buttons', await ev(() => [...document.querySelectorAll('.kk-prompts .kk-padb')].map((e) => e.textContent).join('') === 'AB'));
    await btn(B.UP);
    await btn(B.A, 600);
    check('pad: ↑ + A → settings', await ev(() => window.__kk.game.menuScreen === 'settings'));
    const q0 = await ev(() => window.__kk.game.settings.sfxVolume);
    await btn(B.DOWN); await btn(B.LEFT);
    check('pad: d-pad changes a setting', await ev((q) => window.__kk.game.settings.sfxVolume < q, q0));
    await btn(B.RIGHT);
    await btn(B.B, 600);
    check('pad: B → back to mode', await ev(() => window.__kk.game.menuScreen === 'mode'));
    await btn(B.DOWN);
    await btn(B.A, 700);
    await btn(B.A, 700);
    await shot('character');
    await btn(B.RIGHT, 400);
    await btn(B.A, 700);
    check('pad: reached the track screen', await ev(() => window.__kk.game.menuScreen === 'track'));
    await btn(B.B, 700);
    check('pad: B on track → character', await ev(() => window.__kk.game.menuScreen === 'character'));
    await btn(B.A, 700);
    await btn(B.A, 200);
    await wait(() => ['intro', 'countdown'].includes(window.__kk.game.phase), null, 20000);
    await wait(() => window.__kk.game.phase === 'countdown', null, 15000);
    await sleep(400);
    await shot('countdown');
    check('pad: controls card lists pad buttons', await ev(() => !!document.querySelector('.kk-teach .kk-padb')));
    await wait(() => window.__kk.game.phase === 'race', null, 8000);
    await btn(B.START, 400);
    check('pad: Start pauses', await ev(() => window.__kk.game.paused && !!document.querySelector('.kk-pause')));
    await shot('pause');
    await btn(B.B, 400);
    check('pad: B at the contents resumes', await ev(() => !window.__kk.game.paused));
    await btn(B.START, 400);
    await btn(B.START, 400);
    check('pad: Start closes the pause again', await ev(() => !window.__kk.game.paused));
    await btn(B.START, 400);
    for (let i = 0; i < 4; i++) await btn(B.DOWN);
    await btn(B.A, 900);
    check('pad: pause → Menüye dön → title', await ev(() => window.__kk.game.phase === 'title'));
    const errs = await ev(() => ({ errors: window.__kk.errors.slice(), warnings: window.__kk.warnings.slice() }));
    check('pad: no console errors or warnings', !errs.errors.length && !errs.warnings.length, [...errs.errors, ...errs.warnings].slice(0, 3).join(' | '));
    await T.ctx.close();
  }

  // ======================================================================== phone landscape, touch
  if (only.has('touch')) {
    const T = await open('touch', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const { ev, shot, wait, page } = T;
    const tap = async (sel, wait2 = 700) => {
      const box = await page.locator(sel).first().boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(wait2);
    };
    await shot('title');
    await page.touchscreen.tap(422, 300);
    await sleep(1400);
    check('touch: tap opens the book', await ev(() => window.__kk.game.menuScreen === 'mode'));
    await shot('mode');
    check('touch: no key prompts on a touch device', await ev(() => getComputedStyle(document.querySelector('.kk-prompts')).display === 'none'));
    await tap('.kk-minibtn >> nth=0');
    await shot('settings');
    await tap('.kk-back');
    await tap('.kk-minibtn >> nth=1');
    await shot('controls');
    await tap('.kk-back');
    await tap('.kk-card >> nth=1');
    await shot('class');
    await tap('.kk-swatch >> nth=1');
    await shot('character');
    await tap('.kk-chip >> nth=4');
    check('touch: one tap picks a driver → track', await ev(() => window.__kk.game.menuScreen === 'track' && window.__kk.game.selection.characterId === 'kedi'));
    await shot('track');
    await tap('.kk-chtab >> nth=2', 200);
    await wait(() => window.__kk.game.phase === 'countdown', null, 20000);
    await sleep(400);
    await shot('countdown');
    check('touch: controls shown', await ev(() => window.__kk.game.touch && !document.querySelector('.kk-touch').hidden));
    check('touch: controls card shows touch controls', await ev(() => /DRIFT/.test(document.querySelector('.kk-teach')?.textContent || '')));
    const fire = (sel, type, id, dx = 0) => ev(([s, t, i, d]) => {
      const el = document.querySelector(s);
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent(t, { pointerId: i, pointerType: 'touch', bubbles: true, cancelable: true, clientX: r.left + r.width / 2 + d, clientY: r.top + r.height / 2 }));
    }, [sel, type, id, dx]);
    await fire('.kk-steer', 'pointerdown', 11, -100);
    await fire('.kk-steer', 'pointermove', 11, -30);
    await fire('.kk-tgas', 'pointerdown', 12);
    await fire('.kk-tdrift', 'pointerdown', 13);
    let t = await ev(() => ({ ...window.__kk.game.input.touch }));
    check('touch: steer + gas + drift held by three fingers', t.steer > 0.5 && t.throttle === 1 && t.drift === true, JSON.stringify(t));
    await fire('.kk-tgas', 'pointerup', 12);
    t = await ev(() => ({ ...window.__kk.game.input.touch }));
    check('touch: lifting one finger releases only its control', t.throttle === 0 && t.drift === true && t.steer > 0.5, JSON.stringify(t));
    await fire('.kk-tdrift', 'pointercancel', 13);
    await fire('.kk-steer', 'pointerup', 11);
    t = await ev(() => ({ ...window.__kk.game.input.touch }));
    check('touch: cancel/up release everything', t.steer === 0 && !t.drift, JSON.stringify(t));
    await wait(() => window.__kk.game.phase === 'race', null, 10000);
    await ev(() => { window.__kk.game.player.autopilot = true; });
    await sleep(1800);
    await shot('race');
    await hudStates(T, 'touch');
    await simulateUntil(T, 'lap3');
    await sleep(420);
    await shot('final-lap');
    await tap('.kk-tpause', 450);
    check('touch: ❚❚ pauses', await ev(() => window.__kk.game.paused));
    await shot('pause');
    await tap('.kk-tocrow >> nth=2', 500);
    await shot('pause-settings');
    await tap('.kk-form .kk-btn', 450);
    await tap('.kk-tocrow >> nth=0', 450);
    check('touch: Devam resumes', await ev(() => !window.__kk.game.paused));
    await ev(() => window.__kk.finishNow());
    await wait(() => window.__kk.game.phase === 'results');
    await sleep(1500);
    await shot('results');
    await tap('.kk-btn >> nth=1', 900);
    check('touch: results → Menüye dön', await ev(() => window.__kk.game.phase === 'title'));
    await finishingShot(T);
    await ev(() => window.__kk.startRace({ mode: 'tt', track: 'meadow', laps: 1, skipIntro: true }));
    await wait(() => window.__kk.game.phase === 'countdown');
    await simulateUntil(T, 'results', 150);
    await wait(() => window.__kk.game.phase === 'results', null, 15000);
    await sleep(1500);
    await shot('tt-results');
    await ev(() => window.__kk.startGP({ index: 3, standings: { tilki: 30, kurbaga: 34, penguen: 20, ayi: 25, kedi: 12, baykus: 18, tavsan: 6, ahtapot: 9 } }).catch(() => {}));
    await wait(() => ['intro', 'countdown', 'race'].includes(window.__kk.game.phase));
    await ev(() => window.__kk.game.api.skipCinematic());
    await wait(() => ['countdown', 'race'].includes(window.__kk.game.phase));
    await ev(() => window.__kk.finishNow());
    await wait(() => window.__kk.game.phase === 'results');
    await sleep(1500);
    await shot('results-gp');
    await tap('.kk-btn.is-primary', 1500);
    await shot('standings');
    await tap('.kk-btn.is-primary', 2600);
    await shot('podium');
    check('touch: podium reached by taps', await ev(() => window.__kk.game.phase === 'podium'));
    await tap('.kk-btn.is-primary', 900);
    const leaks = await ev(() => window.__kk.leaks());
    check('touch: core leak check clean', leaks.leaks.length === 0, JSON.stringify(leaks.leaks));
    const errs = await ev(() => ({ errors: window.__kk.errors.slice(), warnings: window.__kk.warnings.slice() }));
    check('touch: no console errors or warnings', !errs.errors.length && !errs.warnings.length, [...errs.errors, ...errs.warnings].slice(0, 3).join(' | '));
    await T.ctx.close();
  }

  // ======================================================================== phone portrait
  if (only.has('portrait')) {
    const T = await open('portrait', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const { ev, shot, wait, page } = T;
    await shot('title');
    // Reduced motion (setting): the cover opening becomes a cut and the pop-up cards do not animate.
    await ev(() => window.__kk.game.api.setSetting('reducedMotion', 'on'));
    await sleep(100);
    await page.touchscreen.tap(195, 600);
    await sleep(250);
    check('reduced motion: the book opens with a cut, cards do not pop', await ev(() => document.querySelector('.kk-ui').classList.contains('kk-rm') &&
      getComputedStyle(document.querySelector('.kk-coverwrap')).visibility === 'hidden' && [...document.querySelectorAll('.kk-pop')].every((e) => e.getAnimations().length === 0)));
    await ev(() => window.__kk.game.api.setSetting('reducedMotion', 'auto'));
    await sleep(1100);
    await shot('mode');
    await ev(() => window.__kk.startRace({ skipIntro: true, autopilot: true }));
    await wait(() => window.__kk.game.phase === 'race', null, 20000);
    await sleep(1500);
    await shot('race');
    check('portrait: one-time "Yatay çevirirsen daha iyi" hint shown (and remembered)', await ev(() => {
      try { return JSON.parse(localStorage.getItem('kk1:uiHints') || '{}').portrait === true; } catch { return false; }
    }));
    const errs = await ev(() => ({ errors: window.__kk.errors.slice(), warnings: window.__kk.warnings.slice() }));
    check('portrait: no console errors or warnings', !errs.errors.length && !errs.warnings.length, [...errs.errors, ...errs.warnings].slice(0, 3).join(' | '));
    await T.ctx.close();
  }

  check('nothing downloaded but three.js (no fonts, no assets)', external.length === 0, external.slice(0, 5).join(' | '));
  check('browser console: no errors or warnings', consoleMsgs.length === 0, consoleMsgs.slice(0, 5).join(' | '));
} catch (e) {
  check('scenario ran to the end', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
  try { if (browser) await browser.close(); } catch { /* already closed */ }
  if (server) server.kill();
}
const failed = checks.filter((c) => !c.ok).length;
console.log(JSON.stringify({ scenario: 'ui', passed: checks.length - failed, failed, shots: shots.length }));
process.exit(failed ? 1 : 0);
