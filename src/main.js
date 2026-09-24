// Boot, phase state machine, race lifecycle (ARCHITECTURE.md §5–§7), fixed-step loop and game.api.
import * as THREE from 'three';
import { BOOK_THEME, config } from './core/config.js';
import { createRng } from './core/rng.js';
import { createEvents } from './core/events.js';
import { createLoop } from './core/loop.js';
import { createStorage } from './core/storage.js';
import { createInput } from './input/input.js';
import { createRenderer } from './render/renderer.js';
import { createMaterials } from './render/materials.js';
import { createPost } from './render/post.js';
import { createCameraRig } from './render/camera.js';
import { buildTrack } from './track/trackBuilder.js';
import { CUP, TRACKS } from './track/defs/index.js';
import { Kart } from './kart/kart.js';
import { createCollisions } from './kart/collisions.js';
import { createGhostPlayer, createGhostRecorder } from './kart/ghost.js';
import { createRace, sortStandings } from './race/race.js';
import { createKartVisual, ROSTER } from './characters/characters.js';
import { createAI } from './ai/ai.js';
import { createItems } from './items/items.js';
import { createAudio } from './audio/audio.js';
import { createUI } from './ui/ui.js';
import { createScenery } from './scenery/scenery.js';
import { createFX } from './fx/fx.js';
import { createCinematics } from './cinematics/cinematics.js';
import { installTestApi } from './test/testApi.js';

document.documentElement.lang = 'tr';

// 'setup' (startRace until intro) neither steps nor pauses, and every race entry ignores calls in it.
const STEP_PHASES = new Set(['countdown', 'race', 'finishing', 'results']);
const PAUSE_PHASES = new Set(['intro', 'countdown', 'race', 'finishing', 'results']);
const QUALITY_LEVELS = ['high', 'medium', 'low'];
const SETTING_CHOICES = {
  quality: ['auto', ...QUALITY_LEVELS],
  reducedMotion: ['auto', 'on', 'off'],
  touchControls: ['auto', 'on', 'off'],
};

const events = createEvents();
const storage = createStorage();

// Stored settings may be old or foreign (the origin is shared): a field is kept only when it has the
// default's type and lies in its domain, unknown keys are dropped.
function readSettings() {
  const defaults = config.settingsDefaults;
  const out = { ...defaults };
  const stored = storage.get('settings', null);
  if (!stored || typeof stored !== 'object') return out;
  for (const key of Object.keys(defaults)) {
    const v = stored[key];
    if (SETTING_CHOICES[key]) { if (SETTING_CHOICES[key].includes(v)) out[key] = v; }
    else if (typeof defaults[key] === 'number') { if (Number.isFinite(v)) out[key] = Math.min(1, Math.max(0, v)); }
    else if (typeof v === typeof defaults[key]) out[key] = v;
  }
  return out;
}

const game = {
  THREE, config, rng: createRng(), events, storage,
  renderer: null, scene: null, camera: null, cameraRig: null, materials: null, post: null,
  settings: readSettings(),
  reducedMotion: false, touch: false, quality: null, fontsReady: Promise.resolve(true),
  input: null,
  phase: 'boot',
  menuScreen: 'title',
  paused: false,
  time: 0, raceTime: 0,
  track: null, trackDef: null, karts: [], player: null, ghost: null,
  race: null,
  gp: { active: false, cup: CUP.slice(), index: 0, standings: {}, lastPlaces: {}, totalTimes: {} },
  mode: 'single', cls: '120',
  selection: { characterId: 'tilki', trackId: CUP[0], cls: '120', mode: 'gp' },
  systems: { ai: null, items: null, audio: null, ui: null, scenery: null, fx: null, cinematics: null },
  api: null,
  // core extras
  loop: null,
  autoPause: true,
  contextLost: false,
  debug: { leaks: [], lastLeakCheck: null },
};
window.__kkGame = game;
const test = installTestApi(game); // error capture as early as possible

const root = document.getElementById('kk-root') || document.body;

// ---------------------------------------------------------------------------------------------
// settings

function resolveReducedMotion() {
  const s = game.settings.reducedMotion;
  if (s === true || s === 'on') return true;
  if (s === false || s === 'off') return false;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

let sawTouch = false;
function resolveTouch() {
  const s = game.settings.touchControls;
  if (s === true || s === 'on') return true;
  if (s === false || s === 'off') return false;
  let coarse = false;
  try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch { /* no media queries */ }
  return coarse || sawTouch;
}

// Level auto has dropped to this session (null until the first drop).
let autoLevel = null;

function resolveQuality() {
  const q = game.settings.quality;
  if (QUALITY_LEVELS.includes(q)) return q;
  if (autoLevel) return autoLevel;
  let coarse = false;
  try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch { /* default */ }
  return coarse ? 'medium' : 'high';
}

function applyQuality(level) {
  // Render targets and the shadow map appear or change size: this race's GPU counts are not comparable.
  if (game.track) qualityChangedDuringRace = true;
  game.quality = level;
  game.renderer.setQuality(level);
  game.post.setQuality(level);
  game.renderer.resize();
  events.emit('quality', { level });
}

// ---------------------------------------------------------------------------------------------
// phases

function clearPause() {
  if (!game.paused) return;
  game.paused = false;
  events.emit('pause', { paused: false });
}

function setPhase(to) {
  const from = game.phase;
  if (from === to) return;
  game.phase = to;
  if (!PAUSE_PHASES.has(to)) clearPause();
  events.emit('phase', { from, to });
}

// ---------------------------------------------------------------------------------------------
// cinematics: main starts and stops shots (§10.8); within a shot cinematics reacts to events itself

let currentShot = null;

function playShot(shot, opts = {}) {
  currentShot = shot;
  let p;
  try { p = game.systems.cinematics.play(shot, opts); } catch (e) { p = Promise.reject(e); }
  return Promise.resolve(p).catch((e) => console.error(`[cinematics] ${shot} failed`, e));
}

function stopShot() {
  currentShot = null;
  game.systems.cinematics?.stop();
}

// ---------------------------------------------------------------------------------------------
// race lifecycle

let raceToken = 0;
let lastRaceOpts = null;
let gpSnapshot = null;
let skipResolve = null;
let ghostRecorder = null;
let collisions = null;
let qualityChangedDuringRace = false;
// A lost context resets three's GPU counters on restore, so this race's GPU counts are not comparable.
let contextLostDuringRace = false;
let pendingSetup = null;

function sceneObjectCount() {
  let n = 0;
  game.scene.traverse(() => { n++; });
  return n;
}

function leakSnapshot() {
  const m = game.renderer.info.memory;
  return { listeners: events.count(), objects: sceneObjectCount(), geometries: m.geometries, textures: m.textures };
}

// three.js allocates render targets and the shadow map on the first render after they change, so
// GPU counts are read after one render of the current scene: before and after then compare alike.
function settledSnapshot() {
  try { game.post.render(game.scene, game.camera); } catch (e) { console.error('[leak] settle render failed', e); }
  return leakSnapshot();
}

let preSetup = null;
let raceCount = 0;

function teardownRace() {
  clearPause();
  if (!game.track) return;
  events.emit('raceTeardown', {});
  const sys = game.systems;
  for (const name of ['fx', 'items', 'ai', 'scenery']) {
    try { sys[name]?.dispose(); } catch (e) { console.error(`[teardown] ${name}.dispose threw`, e); }
    sys[name] = null;
  }
  for (const k of game.karts) {
    if (k.visual) {
      game.scene.remove(k.visual.object3d);
      k.visual.dispose();
      k.visual = null;
    }
  }
  if (game.ghost) {
    game.scene.remove(game.ghost.visual.object3d);
    game.ghost.visual.dispose();
    game.ghost = null;
  }
  game.track.dispose();
  game.karts = [];
  game.player = null;
  game.track = null;
  game.trackDef = null;
  game.race = null;
  ghostRecorder = null;
  collisions = null;
  game.cameraRig.target = null;
  game.cameraRig.snap();
  game.renderer.setTheme(null);
  checkLeaks();
}

function checkLeaks() {
  if (!preSetup) return;
  const post = settledSnapshot();
  const d = game.debug;
  const problems = [];
  if (post.listeners !== preSetup.listeners) problems.push(`event listeners ${preSetup.listeners} → ${post.listeners} ${JSON.stringify(events.counts())}`);
  if (post.objects !== preSetup.objects) problems.push(`scene objects ${preSetup.objects} → ${post.objects}`);
  // GPU memory returns exactly to the pre-setup values (§7.5). Core's shared textures are uploaded at
  // boot (materials.warm), so a module-level cache filled during a race shows up here too.
  if (!qualityChangedDuringRace && !contextLostDuringRace) {
    if (post.geometries !== preSetup.geometries) problems.push(`geometries ${preSetup.geometries} → ${post.geometries}`);
    if (post.textures !== preSetup.textures) problems.push(`textures ${preSetup.textures} → ${post.textures}`);
  }
  d.lastLeakCheck = { pre: preSetup, post, problems };
  if (problems.length) {
    d.leaks.push(...problems);
    console.error(`[leak] race teardown did not return to the pre-setup state: ${problems.join('; ')}`);
  }
  preSetup = null;
}

function normalizeOpts(opts = {}) {
  const sel = game.selection;
  const mode = opts.mode || sel.mode || 'single';
  let track = opts.track || sel.trackId || CUP[0];
  if (!TRACKS[track]) track = CUP[0];
  const cls = String(opts.cls || sel.cls || '120');
  const character = ROSTER.some((c) => c.id === opts.character) ? opts.character : (sel.characterId || ROSTER[0].id);
  return {
    mode, track, cls, character,
    laps: opts.laps ?? TRACKS[track].laps ?? 3,
    seed: opts.seed ?? ((Math.random() * 2 ** 32) >>> 0),
    autopilot: !!opts.autopilot,
    cpuCount: mode === 'tt' ? 0 : Math.max(0, Math.min(7, opts.cpuCount ?? 7)),
    skipIntro: !!opts.skipIntro,
  };
}

function gridOrder(o, player, rng) {
  const others = ROSTER.filter((c) => c.id !== player.id);
  rng.shuffle(others);
  const cpus = others.slice(0, o.cpuCount);
  if (o.mode === 'gp' && game.gp.index > 0) {
    // reverse standings: leader starts last
    const all = [player, ...cpus];
    const order = sortStandings({ ...game.gp, standings: { ...Object.fromEntries(all.map((c) => [c.id, 0])), ...game.gp.standings } });
    const ranked = order.filter((id) => all.some((c) => c.id === id)).map((id) => all.find((c) => c.id === id));
    return ranked.reverse();
  }
  return [...cpus, player];
}

// The phase turns 'setup' synchronously, before the first await: a second activation in the same
// click burst (double-click, key repeat) finds it and gets the setup already running.
function startRace(opts = {}) {
  if (game.phase === 'setup') return pendingSetup;
  const o = normalizeOpts(opts);
  const token = ++raceToken;
  setPhase('setup');
  pendingSetup = setupRace(o, token).catch((e) => {
    // A failed setup must not leave every race entry ignored behind 'setup'.
    if (token === raceToken) {
      try { quitToTitle(); } catch (err) { console.error('[setup] return to title failed', err); }
    }
    throw e;
  });
  return pendingSetup;
}

async function setupRace(o, token) {
  stopShot();
  teardownRace();
  preSetup = settledSnapshot();
  raceCount++;
  qualityChangedDuringRace = false;
  contextLostDuringRace = game.contextLost;
  lastRaceOpts = o;
  if (o.mode !== 'gp') game.gp.active = false;
  if (o.mode === 'gp') gpSnapshot = JSON.parse(JSON.stringify({ standings: game.gp.standings, lastPlaces: game.gp.lastPlaces, totalTimes: game.gp.totalTimes }));

  game.mode = o.mode;
  game.cls = o.cls;
  game.selection = { ...game.selection, characterId: o.character, trackId: o.track, cls: o.cls, mode: o.mode };
  game.rng = createRng(o.seed);
  game.rng.ai = game.rng.fork('ai');
  game.rng.items = game.rng.fork('items');
  game.rng.grid = game.rng.fork('grid');
  game.raceTime = 0;
  clearPause();

  // 2. track
  const def = TRACKS[o.track];
  game.trackDef = def;
  game.track = buildTrack(game, def);
  game.renderer.setTheme(def.theme);

  // 3. karts and visuals
  const playerChar = ROSTER.find((c) => c.id === o.character);
  const order = gridOrder(o, playerChar, game.rng.grid);
  const slots = game.track.gridSlots(order.length);
  game.karts = order.map((ch, i) => {
    const k = new Kart(game, { index: i, character: ch, isPlayer: ch.id === playerChar.id, cls: o.cls });
    k.placeAt(slots[i].pos, slots[i].heading);
    k.place = i + 1;
    return k;
  });
  game.player = game.karts.find((k) => k.isPlayer);
  game.player.autopilot = o.autopilot;
  for (const k of game.karts) {
    const visual = createKartVisual(game, k.character, k);
    k.visual = visual;
    visual.object3d.position.copy(k.pos);
    visual.object3d.quaternion.copy(k.quat);
    game.scene.add(visual.object3d);
  }
  collisions = createCollisions(game);

  // time-trial ghost
  let ghostPlayer = null;
  if (o.mode === 'tt') {
    const best = readTTRecord(ttKey(o));
    if (best?.ghost) {
      const visual = createKartVisual(game, playerChar, null, { ghost: true });
      game.scene.add(visual.object3d);
      ghostPlayer = createGhostPlayer(game, best.ghost, visual);
      game.ghost = ghostPlayer;
    }
    ghostRecorder = createGhostRecorder(config.race.ghostHz);
  }

  game.race = createRace(game, { laps: o.laps, mode: o.mode, ghostPlayer, ghostRecorder });

  // 4. per-race systems
  game.systems.scenery = createScenery(game, def, game.track);
  game.systems.ai = createAI(game);
  game.systems.items = createItems(game);
  game.systems.fx = createFX(game);

  game.cameraRig.target = game.player;
  game.cameraRig.snap();
  game.renderer.sunTarget.copy(game.player.pos);

  // 5.
  events.emit('raceSetup', { track: game.track, karts: game.karts, def, mode: o.mode, cls: o.cls });

  // 6.
  try {
    // Programs are keyed by the bound target's colour space: compile for the target the race renders
    // into (post's linear target on high/medium), or every hidden item/FX program recompiles mid-race.
    const r = game.renderer;
    const prevTarget = r.getRenderTarget();
    r.setRenderTarget(game.post.enabled ? game.post.target : null);
    let compiling;
    try { compiling = r.compileAsync(game.scene, game.camera); } finally { r.setRenderTarget(prevTarget); }
    await compiling;
  } catch (e) {
    console.error('[setup] compileAsync failed', e);
  }
  if (token !== raceToken) return;
  if (game.post.target) {
    const r = game.renderer;
    r.warmShadows(game.track.bounds.clone().expandByScalar(60), () => {
      r.setRenderTarget(game.post.target);
      r.render(game.scene, game.camera);
      r.setRenderTarget(null);
    });
  }

  // 7.
  setPhase('intro');
  if (!o.skipIntro) {
    const skip = new Promise((res) => { skipResolve = res; });
    await Promise.race([playShot('intro', { track: game.track }), skip]);
    skipResolve = null;
    currentShot = null;
    if (token !== raceToken) return;
  }
  game.cameraRig.snap();
  setPhase('countdown');
  events.emit('countdown', { n: 3 });
}

function ttKey(o) {
  return `tt:${o.track}:${o.cls}:${o.character}`;
}

const isNumberArray = (a) => Array.isArray(a) && a.every(Number.isFinite);

// The one reader of stored time-trial records. Times count only when finite and positive; a ghost is
// kept only in the shape createGhostPlayer and splitAt index into, otherwise it is dropped and the
// valid times stay.
function readTTRecord(key) {
  const v = storage.get(key, null);
  if (!v || typeof v !== 'object') return null;
  const rec = {};
  if (Number.isFinite(v.bestLap) && v.bestLap > 0) rec.bestLap = v.bestLap;
  if (Number.isFinite(v.bestRace) && v.bestRace > 0) rec.bestRace = v.bestRace;
  const g = v.ghost;
  if (g && Number.isFinite(g.hz) && g.hz > 0 && isNumberArray(g.frames) && g.frames.length > 0
    && g.frames.length % 4 === 0 && isNumberArray(g.checkpoints)) rec.ghost = g;
  return rec;
}

function getBest({ track, cls, character } = {}) {
  const b = readTTRecord(ttKey({ track, cls: String(cls), character }));
  return b && (b.bestLap || b.bestRace) ? { lap: b.bestLap ?? null, race: b.bestRace ?? null } : null;
}

function onRaceEnd() {
  const o = lastRaceOpts;
  if (!o || o.mode !== 'tt' || !ghostRecorder) return;
  const p = game.player;
  if (!p || p.estimated) return;
  const best = readTTRecord(ttKey(o)) || {};
  const total = p.finishTime;
  const next = { ...best };
  if (p.bestLap != null && (best.bestLap == null || p.bestLap < best.bestLap)) next.bestLap = p.bestLap;
  if (best.bestRace == null || total < best.bestRace) {
    next.bestRace = total;
    next.ghost = ghostRecorder.toData(total, p.lapTimes);
  }
  storage.set(ttKey(o), next);
}

function startGP({ cls, character, seed, index = 0, standings = null } = {}) {
  if (game.phase === 'setup') return pendingSetup;
  const cup = CUP.slice();
  game.gp = { active: true, cup, index: Math.max(0, Math.min(cup.length - 1, index)), standings: {}, lastPlaces: {}, totalTimes: {} };
  if (standings) game.gp.standings = { ...standings };
  return startRace({ mode: 'gp', track: cup[game.gp.index], cls, character, seed });
}

function nextRace() {
  if (game.phase === 'setup') return pendingSetup;
  const gp = game.gp;
  if (!gp.active) return restartRace();
  if (gp.index + 1 < gp.cup.length) {
    gp.index++;
    const o = lastRaceOpts || normalizeOpts({});
    return startRace({ mode: 'gp', track: gp.cup[gp.index], cls: o.cls, character: o.character });
  }
  // podium
  stopShot();
  teardownRace();
  setPhase('podium');
  const top3 = sortStandings(gp).slice(0, 3).map((id) => ({ characterId: id, points: gp.standings[id] || 0 }));
  return playShot('podium', { top3 });
}

function restartRace() {
  if (game.phase === 'setup') return pendingSetup;
  const o = lastRaceOpts;
  if (!o) return startRace({});
  if (o.mode === 'gp' && gpSnapshot) {
    game.gp.standings = { ...gpSnapshot.standings };
    game.gp.lastPlaces = { ...gpSnapshot.lastPlaces };
    game.gp.totalTimes = { ...gpSnapshot.totalTimes };
    game.gp.active = true;
  }
  return startRace({ ...o, seed: undefined });
}

function quitToTitle() {
  raceToken++;
  stopShot();
  teardownRace();
  game.gp.active = false;
  game.menuScreen = 'title';
  setPhase('title');
  playShot('title');
}

function setPaused(on) {
  on = !!on;
  if (on && !PAUSE_PHASES.has(game.phase)) return;
  if (game.paused === on) return;
  game.paused = on;
  events.emit('pause', { paused: on });
}

// Outside a race: the character screen shows the 'select' turntable, every other screen the 'title'
// shot. A shot is only (re)started when it changes; character changes arrive as 'menu' events.
function setMenuScreen(screen, { characterId, trackId } = {}) {
  game.menuScreen = screen;
  if (characterId) game.selection.characterId = characterId;
  if (trackId) game.selection.trackId = trackId;
  if (!game.track) {
    setPhase(screen === 'title' ? 'title' : 'menu');
    const shot = screen === 'character' ? 'select' : 'title';
    if (shot !== currentShot) {
      stopShot();
      playShot(shot, shot === 'select' ? { characterId: game.selection.characterId } : {});
    }
  }
  events.emit('menu', { screen, characterId: characterId ?? game.selection.characterId, trackId: trackId ?? game.selection.trackId });
}

function setSelection(partial) {
  Object.assign(game.selection, partial || {});
}

function skipCinematic() {
  stopShot();
  if (skipResolve) skipResolve();
}

function unlockAudio() {
  const a = game.systems.audio;
  if (!a) return;
  try { a.unlock(); } catch (e) { console.error('[audio] unlock threw', e); }
  if (a.ctx && a.ctx.state === 'running') disarmUnlock();
}

function setSetting(key, value) {
  game.settings[key] = value;
  storage.set('settings', game.settings);
  if (key === 'quality') {
    game.qualityAuto = value === 'auto';
    applyQuality(resolveQuality());
  }
  if (key === 'reducedMotion') game.reducedMotion = resolveReducedMotion();
  if (key === 'touchControls') game.touch = resolveTouch();
  events.emit('settings', { key, value });
}

function toggleMute() {
  setSetting('muted', !game.settings.muted);
}

game.api = { startRace, startGP, nextRace, restartRace, quitToTitle, setPaused, setMenuScreen, setSelection, skipCinematic, unlockAudio, setSetting, toggleMute, getBest };

// ---------------------------------------------------------------------------------------------
// fixed step (§10 order)

function shouldStep() {
  return STEP_PHASES.has(game.phase) && !game.paused && !game.contextLost && !!game.race && !!game.track;
}

function stepSim(dt) {
  const race = game.race;
  const karts = game.karts;
  if (race.state !== 'countdown') game.raceTime += dt;
  // 1. input → player controls
  for (const k of karts) if (k.isPlayer && !k.autopilot) game.input.readPlayer(k.controls);
  // 2.
  game.systems.ai?.update(dt);
  // 3.
  for (const k of karts) k.step(dt);
  // 4.
  collisions.step(dt);
  // 5.
  game.systems.items?.update(dt);
  // 6.
  const before = race.state;
  race.update(dt);
  if (ghostRecorder && game.player && !game.player.finished && race.state !== 'countdown') ghostRecorder.record(game.player, game.raceTime);
  // 7.
  for (const k of karts) Object.assign(k.prevControls, k.controls);

  if (before === 'countdown' && race.state !== 'countdown') setPhase('race');
  if (race.state === 'finishing' && game.phase === 'race') {
    setPhase('finishing');
    playShot('finish', { kart: game.player });
  }
  if (race.state === 'done' && game.phase !== 'results') {
    if (game.phase === 'race' || game.phase === 'countdown') setPhase('finishing');
    setPhase('results');
    onRaceEnd();
  }
}

// ---------------------------------------------------------------------------------------------
// per frame

const perf = { frames: [], lastCalls: 0, lastShadowCalls: 0, lastTriangles: 0 };
const quality = { samples: [], measuring: true, measureStart: 0, interval: 1000 / 60, windowStart: 0, windowFrames: 0, windowTime: 0 };

function autoQuality(now, dtMs) {
  if (game.settings.quality !== 'auto') return;
  const phase = game.phase;
  if (phase === 'title' || phase === 'menu') {
    if (quality.measuring) {
      if (!quality.measureStart) quality.measureStart = now;
      if (dtMs > 0 && dtMs < 200) quality.samples.push(dtMs);
      if (now - quality.measureStart > config.quality.measureTime * 1000 && quality.samples.length > 10) {
        const s = quality.samples.slice().sort((a, b) => a - b);
        quality.interval = s[Math.floor(s.length / 2)];
        quality.measuring = false;
      }
    }
    return;
  }
  if (phase !== 'race' || game.paused) { quality.windowStart = 0; return; }
  if (!quality.windowStart) { quality.windowStart = now; quality.windowFrames = 0; quality.windowTime = 0; return; }
  quality.windowFrames++;
  quality.windowTime += dtMs;
  if (now - quality.windowStart >= config.quality.window * 1000) {
    const mean = quality.windowTime / Math.max(1, quality.windowFrames);
    // Never drop while the game holds ~60 fps, whatever rAF cadence the display reports.
    const slow = mean > config.quality.slowFactor * Math.max(quality.interval, 1000 / 144) && mean > 1000 / 57;
    if (slow) {
      const i = QUALITY_LEVELS.indexOf(game.quality);
      if (i >= 0 && i < QUALITY_LEVELS.length - 1) {
        game.qualityAuto = true;
        autoLevel = QUALITY_LEVELS[i + 1];
        applyQuality(autoLevel);
      }
    }
    quality.windowStart = now;
    quality.windowFrames = 0;
    quality.windowTime = 0;
  }
}

// The pause key only opens the pause menu. Closing it (Devam, back at the pause root) is UI's call
// through api.setPaused(false), so Esc inside a pause sub-screen never unpauses the race beneath it.
function handleGlobalKeys() {
  const input = game.input;
  const nav = input.nav;
  if (nav.pause && !game.paused && (game.phase === 'countdown' || game.phase === 'race' || game.phase === 'finishing')) {
    setPaused(true);
    // The press is used up: UI must not read the same Esc as "back"/"close" this frame.
    nav.pause = false;
    if (input.keyPressed('Escape')) nav.back = false;
  }
  if (input.keyPressed('KeyM')) toggleMute();
  if (input.keyPressed('KeyR') && game.mode === 'tt' && game.track && (game.phase === 'race' || game.phase === 'countdown' || game.phase === 'finishing')) restartRace();
}

let visualTime = 0;
function frame(dt, alpha, now) {
  const input = game.input;
  input.poll(dt);
  handleGlobalKeys();
  game.time += dt;
  const fdt = game.paused ? 0 : dt;
  visualTime += fdt;
  autoQuality(now, dt * 1000);

  const a = shouldStep() ? alpha : 1;
  for (const k of game.karts) {
    const v = k.visual;
    if (!v) continue;
    v.object3d.position.lerpVectors(k.prevPos, k.pos, a);
    v.object3d.quaternion.slerpQuaternions(k.prevQuat, k.quat, a);
    v.update(fdt, a);
  }
  if (game.ghost) {
    if (game.phase !== 'countdown') game.ghost.update(game.raceTime);
    game.ghost.visual.update(fdt, 1);
  }
  const sys = game.systems;
  sys.items?.updateVisual(fdt, a);
  sys.cinematics?.update(fdt);
  game.cameraRig.update(fdt);
  sys.scenery?.update(fdt, game.camera);
  sys.fx?.update(fdt, a);
  sys.ui?.update(fdt);
  sys.audio?.update(fdt);
  game.materials.update(visualTime);

  if (game.player?.visual) game.renderer.sunTarget.copy(game.player.visual.object3d.position);
  game.renderer.updateWorld(game.camera);
  render();
  input.endFrame();
  test.recordFrame(dt, now);
}

function render() {
  const r = game.renderer;
  r.info.reset();
  r.shadowCalls = 0;
  game.post.render(game.scene, game.camera);
  perf.lastCalls = r.info.render.calls;
  perf.lastShadowCalls = r.shadowCalls;
  perf.lastTriangles = r.info.render.triangles;
}

// ---------------------------------------------------------------------------------------------
// audio unlock, auto-pause, resize

const UNLOCK_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'];
let unlockArmed = false;
function onGesture() { unlockAudio(); }
function armUnlock() {
  if (unlockArmed) return;
  unlockArmed = true;
  for (const e of UNLOCK_EVENTS) window.addEventListener(e, onGesture, true);
}
function disarmUnlock() {
  if (!unlockArmed) return;
  unlockArmed = false;
  for (const e of UNLOCK_EVENTS) window.removeEventListener(e, onGesture, true);
}

function autoPauseNow() {
  if (!game.autoPause) return;
  if (game.phase === 'countdown' || game.phase === 'race') setPaused(true);
}

function installWindowHooks() {
  armUnlock();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) autoPauseNow();
    else armUnlock();
  });
  window.addEventListener('blur', autoPauseNow);
  window.addEventListener('gamepaddisconnected', autoPauseNow);
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !sawTouch) { sawTouch = true; game.touch = resolveTouch(); game.input.device = 'touch'; }
  }, true);
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => game.renderer.resize()).observe(root);
  window.addEventListener('resize', () => game.renderer.resize());
  // Nothing draws while the context is lost: stop the race clock and open the pause menu. After a
  // restore the race stays paused until the player resumes.
  const canvas = game.renderer.domElement;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    game.contextLost = true;
    if (game.track) contextLostDuringRace = true;
    setPaused(true);
  });
  canvas.addEventListener('webglcontextrestored', () => { game.contextLost = false; });
}

// ---------------------------------------------------------------------------------------------
// boot

function boot() {
  game.reducedMotion = resolveReducedMotion();
  game.touch = resolveTouch();
  game.qualityAuto = !QUALITY_LEVELS.includes(game.settings.quality);

  let renderer;
  try {
    renderer = createRenderer(game, root);
  } catch (e) {
    const card = document.getElementById('kk-boot');
    if (card) card.innerHTML = 'Kâğıt Kart<small>Bu tarayıcı WebGL2 desteklemiyor.</small>';
    console.error('[boot] WebGL renderer failed', e);
    return;
  }
  game.renderer = renderer;
  game.scene = renderer.scene;
  game.camera = renderer.camera;
  game.materials = createMaterials(renderer, config);
  game.materials.warm();
  game.post = createPost(renderer, game.materials, config);
  game.cameraRig = createCameraRig(game, game.camera);
  game.input = createInput(game);
  renderer.setTheme(BOOK_THEME);
  applyQuality(resolveQuality());

  game.camera.position.set(0, 4, -10);
  game.camera.lookAt(0, 1, 0);

  game.systems.audio = createAudio(game);
  game.systems.ui = createUI(game);
  game.systems.cinematics = createCinematics(game);

  installWindowHooks();

  game.loop = createLoop({
    step: config.STEP,
    maxFrameDt: config.MAX_FRAME_DT,
    maxSteps: config.MAX_STEPS_PER_FRAME,
    shouldStep,
    onStep: stepSim,
    onFrame: frame,
  });
  test.attach({ stepSim, shouldStep, render, perf, setPhase, leakSnapshot: settledSnapshot });

  document.getElementById('kk-boot')?.remove();
  setPhase('title');
  playShot('title');
  game.loop.start();
  renderer.domElement.focus?.();
  test.ready();
}

// Any throw during boot leaves a half-built page: say so on the boot card, above the canvas and UI.
function showBootFailure(e) {
  console.error('[boot] failed', e);
  game.loop?.stop();
  let card = document.getElementById('kk-boot');
  if (!card) {
    card = document.createElement('div');
    card.id = 'kk-boot';
  }
  card.dataset.failed = 'boot';
  root.appendChild(card);
  const reason = String((e && e.message) || e || '').slice(0, 120);
  const small = document.createElement('small');
  small.textContent = `Oyun başlatılamadı: ${reason}`;
  card.replaceChildren('Kâğıt Kart', small);
}

try {
  boot();
} catch (e) {
  showBootFailure(e);
}
