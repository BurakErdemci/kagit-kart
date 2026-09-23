// AUDIO system (ARCHITECTURE.md §10.3). Everything is synthesized with WebAudio at runtime.
// The AudioContext is created inside the first unlock() (a user gesture), so the page never logs an
// autoplay warning. Music follows phase / raceSetup / finalLap / finish; pause ducks; settings set volumes.
import { createBank } from './dsp.js';
import { createMixer } from './mixer.js';
import { createInstruments } from './instruments.js';
import { createMusic } from './music.js';
import { THEMES, CHAPTERS, STINGERS, genericTheme } from './themes.js';
import { createSfx } from './sfx.js';
import { createEngines } from './engine.js';

const ENGINE_PHASES = new Set(['countdown', 'race', 'finishing', 'results']);
const HIT_SFX = { gum: 'hit_gum', plane: 'hit_plane', homing: 'hit_homing', rocket: 'hit_homing', scissors: 'hit_scissors', foil: 'hit_foil', burnout: 'hit_burnout' };
const REF_DIST = 12;
const MAX_DIST = 150;

export function createAudio(game) {
  let ctx = null;
  let A = null;
  let disposed = false;
  const offs = [];
  const L = { x: 0, y: 0, z: 0, rx: 1, ry: 0, rz: 0 };
  const st = {
    trackDef: null,
    cur: null,
    curKey: null,
    playerFinished: false,
    wantSync: true,
    vol: { music: -1, sfx: -1, muted: null },
    rouletteT: 0,
    rouletteFlip: 0,
    wallAt: new WeakMap(),
    voiced: new Map(),
    // Per kart pair (index a·8 + b, a < b), on the audio clock: last bump event, last voiced bump.
    bumpSeen: new Float64Array(64).fill(-9),
    bumpAt: new Float64Array(64).fill(-9),
    // Popups gathered between rustles: scenery emits up to 6/s, which as separate rustles reads as hiss.
    wave: { n: 0, size: 0, x: 0, y: 0, z: 0, next: 0 },
  };

  // ---- context + graph ------------------------------------------------------------------------------
  function build() {
    const t0 = performance.now();
    const bank = createBank(ctx);
    const mix = createMixer(ctx, bank);
    const inst = createInstruments(ctx, bank);
    const music = createMusic(ctx, { music: mix.musicIn, reverb: mix.reverbIn }, inst, bank);
    const sfx = createSfx(ctx, mix.sfxIn, bank);
    const ui = createSfx(ctx, mix.uiIn, bank);
    const engines = createEngines(ctx, mix.engineIn, bank);
    A = { bank, mix, inst, music, sfx, ui, engines };
    st.vol.music = -1;
    applySettings();
    if (st.trackDef) prepareRace();
    st.buildMs = performance.now() - t0;
  }

  function unlock() {
    if (disposed) return false;
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        const t0 = performance.now();
        ctx = new AC({ latencyHint: 'interactive' });
        st.ctxMs = performance.now() - t0;
        // The node graph is built on the next update(), outside the input handler.
        st.needBuild = true;
        st.wantSync = true;
      }
      if (ctx.state !== 'running' && ctx.state !== 'closed') {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
        // Older iOS only unlocks when a buffer starts inside the gesture itself.
        const s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        s.connect(ctx.destination);
        s.start(0);
      }
      return ctx.state === 'running';
    } catch (err) {
      console.error('[audio] unlock failed', err);
      return false;
    }
  }

  function onVisibility() {
    if (!ctx || ctx.state === 'closed') return;
    if (document.hidden) { if (ctx.state === 'running') ctx.suspend().catch(() => {}); }
    else if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }
  document.addEventListener('visibilitychange', onVisibility);

  // ---- settings -------------------------------------------------------------------------------------
  function applySettings() {
    if (!A) return;
    const s = game.settings || {};
    const m = clamp01(s.musicVolume ?? 0.7), f = clamp01(s.sfxVolume ?? 0.9), mu = !!s.muted;
    if (m === st.vol.music && f === st.vol.sfx && mu === st.vol.muted) return;
    st.vol.music = m; st.vol.sfx = f; st.vol.muted = mu;
    A.mix.setVolumes(m, f, mu);
  }

  // ---- music ----------------------------------------------------------------------------------------
  function trackTheme() {
    const def = st.trackDef || game.trackDef;
    return (def && CHAPTERS[def.id]) || genericTheme(def && def.music);
  }

  // def.music.tempo nudges an authored chapter theme by at most ±15% (a 6/8 theme counts dotted quarters,
  // so a number far from the theme's own tempo is a different beat unit and is ignored).
  function trackTempo(th) {
    const def = st.trackDef || game.trackDef;
    const t = +(def && def.music && def.music.tempo);
    return t >= th.tempo * 0.85 && t <= th.tempo * 1.15 ? t : th.tempo;
  }

  function desired() {
    const ph = game.phase;
    const id = (st.trackDef || game.trackDef || {}).id || '?';
    if (ph === 'title' || ph === 'menu') return 'title';
    if (ph === 'intro') return 'intro:' + id;
    if (ph === 'countdown') return null;
    if (ph === 'race' || ph === 'finishing' || ph === 'results') return st.playerFinished ? 'results' : 'race:' + id;
    if (ph === 'podium') return 'podium';
    return null;
  }

  function switchTo(key) {
    const M = A.music;
    if (st.cur) M.stop(st.cur, key && key.startsWith('race:') ? 0.15 : 0.9);
    st.cur = null;
    st.curKey = key;
    if (!key) return;
    const now = ctx.currentTime;
    if (key === 'title') {
      const t0 = performance.now();
      st.cur = M.play(THEMES.title, { fadeIn: 0.4, at: now + 0.05 });
      if (st.titleMs == null) st.titleMs = performance.now() - t0;
    }
    else if (key === 'podium') st.cur = M.play(THEMES.podium, { at: now + 0.1 });
    else if (key === 'results') st.cur = M.play(THEMES.results, { fadeIn: 1.2, at: now + 0.1 });
    else if (key.startsWith('intro:')) {
      const th = trackTheme();
      if (th.intro) st.cur = M.play(th, { form: [th.intro], loopTo: 0, fadeIn: 0.8, at: now + 0.05, tempo: trackTempo(th) });
    } else if (key.startsWith('race:')) {
      const th = trackTheme();
      st.cur = M.play(th, { at: now + 0.02, tempo: trackTempo(th) });
    }
  }

  function syncMusic() {
    if (!A || ctx.state !== 'running') { st.wantSync = true; return; }
    st.wantSync = false;
    const key = desired();
    if (key !== st.curKey) switchTo(key);
  }

  function prepareRace() {
    const t0 = performance.now();
    const th = trackTheme();
    for (const t of [th, THEMES.results, STINGERS.finishWin, STINGERS.finishGood, STINGERS.finishOk, STINGERS.finalLap]) A.music.prepare(t);
    st.prepMs = Math.max(st.prepMs || 0, performance.now() - t0);
  }

  function onPlayerFinish(place) {
    st.playerFinished = true;
    if (!A || ctx.state !== 'running') return;
    const M = A.music;
    play('finishLine', null, { important: true });
    if (st.cur) M.stop(st.cur, 0.35);
    const sting = place === 1 ? STINGERS.finishWin : place <= 3 ? STINGERS.finishGood : STINGERS.finishOk;
    const at = ctx.currentTime + 0.3;
    M.play(sting, { at });
    const resultsAt = at + M.duration(sting) + 0.3;
    st.cur = M.play(THEMES.results, { at: resultsAt, fadeIn: 1.5 });
    st.curKey = 'results';
  }

  // ---- spatial helpers ------------------------------------------------------------------------------
  const isPlayer = (k) => !!k && (k === game.player || k.isPlayer === true);

  // Returns gain 0..1 for a world position relative to the listener and writes the pan into out.pan.
  const sp = { gain: 0, pan: 0 };
  const wavePos = { x: 0, y: 0, z: 0 };
  function spatialPos(p, ref = REF_DIST) {
    const dx = p.x - L.x, dy = p.y - L.y, dz = p.z - L.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    sp.gain = d > MAX_DIST ? 0 : Math.min(1, ref / Math.max(ref, d));
    sp.pan = Math.max(-0.9, Math.min(0.9, (dx * L.rx + dy * L.ry + dz * L.rz) / d));
    return sp;
  }

  function play(name, kartOrPos, p = {}, base = 1) {
    if (!A || ctx.state !== 'running') return false;
    let g = base, pan = 0;
    if (kartOrPos && !isPlayer(kartOrPos)) {
      const pos = kartOrPos.pos || kartOrPos;
      if (pos && typeof pos.x === 'number') {
        spatialPos(pos, p.ref);
        // Other karts' events sit under the player's own; seven CPUs in a pack otherwise bury the music.
        g *= sp.gain * (kartOrPos.pos ? 0.5 : 1);
        pan = sp.pan;
      }
      if (!p.key) p.key = name + ':world';
    }
    if (g < 0.06) return false;
    p.gain = g * (p.gain ?? 1);
    p.pan = pan;
    const ok = A.sfx.play(name, p);
    if (ok) st.voiced.set(name, (st.voiced.get(name) || 0) + 1);
    return ok;
  }

  function updateListener() {
    const cam = game.camera;
    if (cam && cam.matrixWorld) {
      const e = cam.matrixWorld.elements;
      L.x = e[12]; L.y = e[13]; L.z = e[14];
      L.rx = e[0]; L.ry = e[1]; L.rz = e[2];
    } else if (game.player && game.player.pos) {
      const k = game.player;
      L.x = k.pos.x; L.y = k.pos.y; L.z = k.pos.z;
      L.rx = -Math.cos(k.heading || 0); L.ry = 0; L.rz = Math.sin(k.heading || 0);
    }
  }

  // ---- events ---------------------------------------------------------------------------------------
  const on = (name, fn) => offs.push(game.events.on(name, fn));

  on('phase', () => syncMusic());
  on('menu', () => { if (A) A.ui.play('pageTurn', { minGap: 0.15 }); });
  on('uiClick', () => { if (A) A.ui.play('click', { minGap: 0.04 }); });
  on('settings', () => applySettings());
  on('pause', (e) => {
    if (!A) return;
    A.mix.duck(!!e.paused);
    A.ui.play(e.paused ? 'pause' : 'unpause');
  });
  on('raceSetup', (e) => {
    st.trackDef = e.def || game.trackDef || null;
    st.playerFinished = false;
    if (A) prepareRace();
  });
  on('raceTeardown', () => {
    st.playerFinished = false;
    st.wave.n = 0; st.wave.size = 0; st.wave.x = st.wave.y = st.wave.z = 0;
    if (A) A.engines.unbind();
  });
  on('countdown', (e) => {
    if (e.n > 0) play('count', null, { important: true });
    else {
      play('go', null, { important: true });
      if (A && ctx.state === 'running' && !st.playerFinished) {
        const key = 'race:' + ((st.trackDef || game.trackDef || {}).id || '?');
        if (st.curKey !== key) switchTo(key);
      }
    }
  });
  on('lap', (e) => {
    const laps = (game.race && game.race.laps) || 3;
    if (isPlayer(e.kart) && e.lap < laps) play('lap', null, { important: true });
  });
  on('finalLap', (e) => {
    if (!isPlayer(e.kart) || !A) return;
    const r = st.cur && st.curKey && st.curKey.startsWith('race:') && ctx.state === 'running'
      ? A.music.finalLap(st.cur, { sting: true }) : null;
    if (r) {
      const sting = STINGERS.finalLap;
      A.music.play(sting, { at: ctx.currentTime + 0.01, transpose: r.key - sting.key });
      st.stingAt = ctx.currentTime;
    } else play('lap', null, { important: true });
  });
  on('checkpoint', (e) => {
    if (isPlayer(e.kart) && e.split != null) play(e.split <= 0 ? 'splitGood' : 'splitBad', null);
  });
  on('finish', (e) => { if (isPlayer(e.kart)) onPlayerFinish(e.place); });
  // race.conclude() classifies unfinished karts without a `finish` event (test finishNow, estimates).
  on('raceEnd', () => { if (!st.playerFinished && game.player) onPlayerFinish(game.player.place || 8); });
  on('place', (e) => {
    if (isPlayer(e.kart) && game.phase === 'race' && e.prev) play(e.place < e.prev ? 'placeUp' : 'placeDown', null, { minGap: 0.8 });
  });
  on('wrongWay', (e) => { if (isPlayer(e.kart) && e.on) play('wrongWay', null, { minGap: 1 }); });
  on('drift', (e) => {
    if (e.state === 'tier') play('tier', e.kart, { tier: e.tier, minGap: 0.01 }, isPlayer(e.kart) ? 1 : 0.35);
    else if (e.state === 'cancel' && isPlayer(e.kart)) play('driftCancel', null);
  });
  on('hop', (e) => play('hop', e.kart, { minGap: 0.02 }, isPlayer(e.kart) ? 1 : 0.4));
  on('trick', (e) => play('trick', e.kart, {}, isPlayer(e.kart) ? 1 : 0.6));
  on('boost', (e) => play('boost', e.kart, { source: e.source, duration: e.duration, minGap: 0.02 }, isPlayer(e.kart) ? 1 : 0.55));
  on('land', (e) => {
    if ((e.airTime || 0) > 0.2) play('land', e.kart, { intensity: Math.min(1, e.airTime / 1.1), minGap: 0.02 }, isPlayer(e.kart) ? 1 : 0.6);
  });
  on('wallHit', (e) => {
    const k = e.kart;
    const now = ctx ? ctx.currentTime : 0;
    if (k && now - (st.wallAt.get(k) || -1) < 0.2) return;
    if (k) st.wallAt.set(k, now);
    play('wall', k, { intensity: Math.min(1, (e.speed || 10) / 25), minGap: 0.02 }, isPlayer(k) ? 1 : 0.6);
  });
  // Core re-emits a touching pair every 0.2 s (constant impulse), so a pack of CPUs rubbing along gave
  // ~8 bumps/s. A pair is voiced on a new contact (apart ≥ 0.45 s); sustained contact repeats only for
  // the player (every 0.6 s), never for two CPUs.
  on('bump', (e) => {
    if (!e.a || !e.b) return;
    const mine = isPlayer(e.a) || isPlayer(e.b);
    const i = (Math.min(e.a.index, e.b.index) & 7) * 8 + (Math.max(e.a.index, e.b.index) & 7);
    const now = ctx ? ctx.currentTime : 0;
    const fresh = now - st.bumpSeen[i] > 0.45;
    st.bumpSeen[i] = now;
    if (!fresh && !(mine && now - st.bumpAt[i] >= 0.6)) return;
    if (play('bump', mine ? null : e.a, { intensity: Math.min(1, (e.impulse || 3) / 4), minGap: mine ? 0.08 : 0.25 }, mine ? 1 : 0.4)) st.bumpAt[i] = now;
  });
  on('hit', (e) => play(HIT_SFX[e.cause] || 'hit_default', e.kart, { important: isPlayer(e.kart) }, isPlayer(e.kart) ? 1 : 0.7));
  on('respawn', (e) => {
    if (e.stage === 'lift') play('respawnLift', e.kart, {}, isPlayer(e.kart) ? 1 : 0.6);
    else if (e.stage === 'drop') play('respawnDrop', e.kart, {}, isPlayer(e.kart) ? 1 : 0.6);
  });
  on('inked', (e) => { if (isPlayer(e.kart)) play('ink', null, { important: true }); });
  on('itemBox', (e) => play('box', e.kart || e.pos, { minGap: 0.02 }, isPlayer(e.kart) ? 1 : 0.5));
  on('itemGet', (e) => { if (isPlayer(e.kart)) play('itemGet', null); });
  // Each shot of a rocket3 is a rocket.
  on('itemUse', (e) => play('use_' + (e.item === 'rocket3' ? 'rocket' : e.item), e.kart, { minGap: 0.02 }, isPlayer(e.kart) ? 1 : 0.7));
  on('projectile', (e) => {
    const toMe = isPlayer(e.target);
    if (e.state === 'bounce') play('planeBounce', e.pos, { minGap: 0.05 });
    else if (e.state === 'lock' && toMe) play('lock', null, { important: true });
    else if (e.state === 'hit') play('impact', e.pos, { minGap: 0.05 });
    else if (e.state === 'expire') play('poof', e.pos, { minGap: 0.05 });
  });
  on('threat', (e) => { if (isPlayer(e.kart)) play('threat', null, { eta: e.eta, important: true, minGap: 0.05 }); });
  on('popup', (e) => {
    if (!e.pos) return;
    const w = st.wave;
    w.n++;
    w.size = Math.max(w.size, e.size || 3);
    w.x += e.pos.x; w.y += e.pos.y; w.z += e.pos.z;
  });

  // ---- per frame ------------------------------------------------------------------------------------
  function roulette(dt) {
    const k = game.player;
    if (!k || !(k.roulette > 0) || game.paused) { st.rouletteT = 0; return; }
    const total = k.rouletteDuration || 1.6;
    const left = Math.min(1, k.roulette / total);
    st.rouletteT -= dt;
    if (st.rouletteT <= 0) {
      st.rouletteT = 0.055 + 0.13 * (1 - left) * (1 - left);
      st.rouletteFlip ^= 1;
      play('rouletteTick', null, { pitch: st.rouletteFlip ? 0.8 : 0.3, minGap: 0.02 });
    }
  }

  function update(frameDt) {
    if (!ctx || disposed) return;
    if (st.needBuild) {
      st.needBuild = false;
      try { build(); } catch (err) { console.error('[audio] graph build failed', err); }
    }
    if (!A || ctx.state !== 'running') return;
    const dt = Math.min(0.1, frameDt || 0);
    applySettings();
    if (st.wantSync) syncMusic();
    updateListener();
    A.music.pump();
    const active = !!game.player && ENGINE_PHASES.has(game.phase) && !game.paused;
    A.engines.setActive(active);
    if (active) A.engines.update(game, L, game.phase === 'results' ? 0.5 : 1, dt);
    roulette(dt);
    popupWave();
  }

  // One rustle per gathered wave of popups, at their mean position; more pages → a fuller rustle. The
  // irregular gap keeps successive waves from ticking like a metronome.
  function popupWave() {
    const w = st.wave;
    if (!w.n || ctx.currentTime < w.next) return;
    wavePos.x = w.x / w.n; wavePos.y = w.y / w.n; wavePos.z = w.z / w.n;
    // Props unfold 70–110 m ahead; a longer reference distance keeps that rustle audible but distant.
    play('rustle', wavePos, { size: Math.min(1, w.size / 8 + 0.1 * (w.n - 1)), minGap: 0, ref: 45 }, 0.9);
    w.next = ctx.currentTime + 0.45 + 0.2 * Math.random();
    w.n = 0; w.size = 0; w.x = w.y = w.z = 0;
  }

  function dispose() {
    disposed = true;
    for (const off of offs) off();
    offs.length = 0;
    document.removeEventListener('visibilitychange', onVisibility);
    if (A) { A.music.stopAll(0.05); A.engines.dispose(); }
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
    A = null;
  }

  return {
    unlock,
    update,
    dispose,
    get ctx() { return ctx; },
    get state() { return ctx ? ctx.state : 'none'; },
    // Test/debug surface (read-only by convention).
    debug: {
      musicKey: () => st.curKey,
      voices: () => (A ? A.music.active.length : 0),
      music() {
        const c = st.cur;
        return c ? { key: st.curKey, tempo: c.tempo, transpose: c.transpose, section: c.sec && c.sec.name, cycle: c.cycle } : null;
      },
      analyser: () => (A ? A.mix.analyser() : null),
      // ctxMs: inside the gesture; buildMs: bank + graph on the next frame; titleMs: title samples;
      // prepareMs: the slowest raceSetup sample preparation.
      timings: () => ({ ctxMs: st.ctxMs, buildMs: st.buildMs, titleMs: st.titleMs, prepareMs: st.prepMs }),
      setNoteHook: (fn) => { if (A) A.music.setOnNote(fn); },
      level() {
        if (!A) return -Infinity;
        const an = A.mix.analyser();
        const buf = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
        return 10 * Math.log10(s / buf.length + 1e-12);
      },
      playSfx: (name, p) => play(name, null, p || {}),
      // SFX actually started (after distance culling and rate limits), by recipe name.
      voiced: () => Object.fromEntries(st.voiced),
      resetVoiced: () => st.voiced.clear(),
    },
  };
}

function clamp01(v) { v = +v; return v > 1 ? 1 : v > 0 ? v : 0; }
