// DOM overlay for every screen and the HUD (ARCHITECTURE.md §10.4). Changes game flow only through
// game.api.*, reads menu presses from game.input.nav and writes game.input.touch.
import { ROSTER } from '../characters/characters.js';
import { TRACKS, CUP } from '../track/defs/index.js';
import { h, svg, fmtTime } from './dom.js';
import { SPEAKER } from './icons.js';
import { buildCSS } from './style.js';
import { createMenus, createIntroCard } from './menus.js';
import { createHUD } from './hud.js';
import { createPause, createResults, createPodium } from './panels.js';
import { createTouch } from './touch.js';
import { createHints } from './hints.js';

const GLYPHS = {
  keyboard: { confirm: 'Enter', back: 'Esc', drift: 'Space', item: 'X', brake: '↓', pause: 'Esc' },
  gamepad: { confirm: 'A', back: 'B', drift: 'RB', item: 'X', brake: 'B', pause: 'Start' },
  touch: { confirm: null, back: null, drift: 'DRIFT', item: 'EŞYA', brake: 'FREN', pause: '❚❚' },
};
const NO_NAV = { up: false, down: false, left: false, right: false, confirm: false, back: false, pause: false };

export function createUI(game) {
  const offs = [];
  const style = document.createElement('style');
  style.id = 'kk-ui-style';
  style.textContent = buildCSS(game.config?.fonts?.body);
  document.head.appendChild(style);

  const host = document.getElementById('kk-root') || document.body;
  const root = h('div', { class: 'kk-ui', lang: 'tr' });
  host.appendChild(root);

  let prevStandings = null;
  // Core starts input.device at 'keyboard'; on a touch device that is only true once a key or pad press arrives.
  let sawNav = false;

  const ctx = {
    game,
    api(name, ...args) {
      const fn = game.api?.[name];
      if (typeof fn !== 'function') return undefined;
      try {
        const r = fn.apply(game.api, args);
        if (r && typeof r.then === 'function') r.catch((err) => console.error(`[ui] api.${name} failed`, err));
        return r;
      } catch (err) {
        console.error(`[ui] api.${name} threw`, err);
        return undefined;
      }
    },
    click() { game.events?.emit?.('uiClick', {}); },
    device() {
      const d = game.input?.device;
      if (d === 'keyboard' && game.touch && !sawNav) return 'touch';
      if (d === 'gamepad' || d === 'touch' || d === 'keyboard') return d;
      if (game.input?.pad?.connected) return 'gamepad';
      return game.touch ? 'touch' : 'keyboard';
    },
    reduced: () => !!game.reducedMotion,
    roster: () => (Array.isArray(ROSTER) ? ROSTER : []),
    tracks: () => TRACKS || {},
    cup: () => (Array.isArray(CUP) && CUP.length ? CUP : Object.keys(TRACKS || {})),
    best(trackId) {
      const q = { track: trackId, cls: String(game.selection?.cls ?? '120'), character: game.selection?.characterId || 'tilki' };
      const fn = game.api?.getBest;
      if (typeof fn === 'function') {
        try { return fn.call(game.api, q) || null; } catch { return null; }
      }
      // Fallback until core exposes api.getBest: core keeps TT bests under tt:<track>:<cls>:<character>.
      const b = ctx.store.get(`tt:${q.track}:${q.cls}:${q.character}`, null);
      return b && (b.bestLap || b.bestRace) ? { lap: b.bestLap ?? null, race: b.bestRace ?? null } : null;
    },
    fmt: fmtTime,
    prevStandings: () => prevStandings,
    store: {
      get: (k, fb) => { try { return game.storage?.get ? game.storage.get(k, fb) : fb; } catch { return fb; } },
      set: (k, v) => { try { game.storage?.set?.(k, v); } catch { /* storage is best effort */ } },
    },
    glyphs(scope = root) {
      const dev = ctx.device();
      for (const g of scope.querySelectorAll('[data-glyph]')) {
        const t = GLYPHS[dev][g.dataset.glyph];
        if (t == null) { g.hidden = true; continue; }
        g.hidden = false;
        g.textContent = t;
        g.className = dev === 'gamepad' ? (t.length > 1 ? 'kk-padb kk-wide' : 'kk-padb') : 'kk-key';
      }
    },
  };

  // Layers, bottom to top.
  const hud = createHUD(ctx);
  const touch = createTouch(ctx);
  const hints = createHints(ctx);
  const menus = createMenus(ctx);
  const pause = createPause(ctx);
  const results = createResults(ctx);
  const podium = createPodium(ctx);
  const hudLayer = h('div', { class: 'kk-layer' }, hud.el);
  const introLayer = h('div', { class: 'kk-layer' });
  // Settings → "FPS göster": a quiet counter, measured on wall time so it also reads while paused.
  const fpsEl = h('div', { class: 'kk-fps' });
  fpsEl.hidden = true;
  let fpsT0 = 0, fpsFrames = 0;
  // Audio unlocks only on a key, click or tap (§2); a gamepad press is not a user gesture in Chrome, so a
  // pad-only player can reach the menus or a race in silence. After a second of that, ask once, quietly.
  const soundEl = h('div', { class: 'kk-sound', role: 'status' }, svg(SPEAKER), 'Ses için bir tuşa bas ya da dokun');
  soundEl.hidden = true;
  const canSound = !!(window.AudioContext || window.webkitAudioContext);
  let lockedFor = 0;
  // Hints sit under the HUD: a threat marker or a banner must never hide behind a teaching note.
  root.append(hud.inkEl, hints.el, hudLayer, touch.el, menus.layer, introLayer, results.el, podium.el, menus.coverWrap, pause.el, fpsEl, soundEl);
  touch.bindSlot(hud.slot);
  hudLayer.hidden = true;
  pause.el.hidden = true;
  introLayer.hidden = true;
  menus.coverWrap.hidden = true;

  const onCtx = (e) => e.preventDefault();
  host.addEventListener('contextmenu', onCtx);
  offs.push(() => host.removeEventListener('contextmenu', onCtx));

  // ------------------------------------------------------------- events
  const on = (name, fn) => { const off = game.events?.on?.(name, fn); if (off) offs.push(off); };
  on('raceSetup', (p) => {
    const st = game.gp?.active ? game.gp.standings : null;
    prevStandings = st && Object.values(st).some((v) => v > 0) ? { ...st } : null;
    hud.bind(p || {});
    hints.bind({ track: p?.track || game.track, def: p?.def || game.trackDef });
  });
  on('raceTeardown', () => { hud.unbind(); hints.unbind(); intro = null; introLayer.replaceChildren(); });
  on('countdown', (p) => { hud.onCountdown(p); hints.onCountdown(p); });
  on('lap', (p) => hud.onLap(p));
  on('finalLap', (p) => hud.onFinalLap(p));
  on('checkpoint', (p) => hud.onCheckpoint(p));
  on('finish', (p) => hud.onFinish(p));
  on('place', (p) => hud.onPlace(p));
  on('wrongWay', (p) => hud.onWrongWay(p));
  on('inked', (p) => hud.onInked(p));
  on('threat', (p) => hud.onThreat(p));
  on('boost', (p) => hud.onBoost(p));
  on('hit', (p) => hud.onHit(p));
  on('drift', (p) => hints.onDrift(p));
  on('itemGet', (p) => hints.onItemGet(p));
  on('settings', () => { menus.refresh(); pause.refresh(); touch.refresh(); });

  // ------------------------------------------------------------- view state, derived from game state every frame
  let view = 'none';
  let intro = null;
  let pauseOpen = false;
  let lastDevice = '';
  let lastReduced = null;
  let lastTouchRace = null;

  function desiredView() {
    const p = game.phase;
    if (p === 'title' || p === 'menu') {
      const s = game.menuScreen;
      return !s || s === 'title' ? 'title' : 'menu:' + s;
    }
    if (p === 'intro') return 'intro';
    if (p === 'countdown' || p === 'race' || p === 'finishing') return 'race';
    if (p === 'results') return 'results';
    if (p === 'podium') return 'podium';
    return 'none';
  }

  function enter(next) {
    const prev = view;
    view = next;
    const isMenu = next.startsWith('menu:');
    const wasMenu = prev.startsWith('menu:');

    if (next === 'title') {
      menus.hide();
      menus.coverWrap.hidden = false;
      if (wasMenu) menus.closeCover();
      else menus.setCoverInstant(false);
    } else if (isMenu) {
      if (prev === 'title') menus.openCover();
      else menus.setCoverInstant(true);
      menus.show(next.slice(5));
    } else {
      menus.hide();
      menus.coverWrap.hidden = true;
    }

    introLayer.hidden = next !== 'intro';
    if (next === 'intro') {
      intro = createIntroCard(ctx);
      introLayer.replaceChildren(intro.el);
    } else if (intro) {
      intro = null;
      introLayer.replaceChildren();
    }

    hudLayer.hidden = next !== 'race';
    if (next !== 'race') hud.reset();

    if (next !== 'results') results.close();
    if (next === 'podium') podium.open(); else podium.close();
  }

  function update(frameDt = 0) {
    const want = desiredView();
    if (want !== view) enter(want);
    if (view === 'results' && results.ready() && results.stale()) results.open();

    const dev = ctx.device();
    if (dev !== lastDevice) {
      lastDevice = dev;
      root.classList.toggle('kk-touch-ui', dev === 'touch');
      ctx.glyphs(root);
    }
    const rm = !!game.reducedMotion;
    if (rm !== lastReduced) { lastReduced = rm; root.classList.toggle('kk-rm', rm); }

    const paused = !!game.paused && (view === 'race' || view === 'results' || view === 'intro');
    if (paused !== pauseOpen) {
      pauseOpen = paused;
      pause.el.hidden = !paused;
      if (paused) pause.open(); else pause.close();
    }

    const touchRace = !!game.touch && view === 'race' && !paused;
    if (touchRace !== lastTouchRace) {
      lastTouchRace = touchRace;
      touch.setActive(touchRace);
      root.classList.toggle('kk-touch-race', touchRace);
    }

    const nav = game.input?.nav || NO_NAV;
    if (!sawNav && (nav.up || nav.down || nav.left || nav.right || nav.confirm || nav.back || nav.pause)) sawNav = true;
    if (pauseOpen) pause.handle(nav);
    else if (view === 'results') results.handle(nav);
    else if (view === 'podium') podium.handle(nav);
    else if (view === 'intro') intro?.handle(nav);
    else if (view === 'title' || view.startsWith('menu:')) menus.handle(nav);

    if (view === 'race') hud.update(frameDt);
    hints.update(frameDt, view);

    // Locked means: a pad player has no gesture yet, or a gesture created the context but it did not
    // start. A keyboard/mouse/touch player always gestures on the title, so a missing context there
    // only happens under test automation, which drives races through __kk.
    const audio = game.systems?.audio;
    const st = audio?.state;
    const padOnly = game.input?.device === 'gamepad' || !!game.input?.pad?.connected;
    const locked = canSound && !!audio && st !== 'running' && (st !== 'none' || padOnly) && !game.settings?.muted && !document.hidden;
    lockedFor = locked && view !== 'title' && view !== 'none' ? lockedFor + Math.min(frameDt, 0.1) : 0;
    if (soundEl.hidden !== lockedFor < 1) soundEl.hidden = lockedFor < 1;

    const showFps = !!game.settings?.showFps;
    if (fpsEl.hidden === showFps) { fpsEl.hidden = !showFps; fpsT0 = 0; fpsEl.textContent = ''; }
    if (showFps) {
      const now = performance.now();
      if (!fpsT0) { fpsT0 = now; fpsFrames = 0; }
      fpsFrames++;
      if (now - fpsT0 >= 500) {
        fpsEl.textContent = `${Math.round((fpsFrames * 1000) / (now - fpsT0))} FPS`;
        fpsT0 = now;
        fpsFrames = 0;
      }
    }
  }

  function dispose() {
    for (const off of offs) off();
    offs.length = 0;
    hud.dispose();
    menus.dispose();
    pause.dispose();
    results.dispose();
    podium.dispose();
    touch.dispose();
    hints.dispose();
    root.remove();
    style.remove();
  }

  return { update, dispose };
}
