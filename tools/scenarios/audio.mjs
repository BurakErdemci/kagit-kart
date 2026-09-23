// Audio checks in the real game (ARCHITECTURE.md §10.3). Prints one JSON line per check; exits 1 on a failure.
// node tools/scenarios/audio.mjs [--port 8774]            live: unlock → title → intro/countdown/GO → balance →
//     pause duck → mute → real-race voicing → item-family events → final lap → finish → results → the four
//     chapter themes → GP podium → title; leaks across two races; §16 budget; spectrogram screenshots.
// node tools/scenarios/audio.mjs --render [--port 8774]   OfflineAudioContext renders of every theme, final lap,
//     stinger, SFX and an engine drive-by through src/audio, written as WAV and measured (peaks, loudness, seams).
// Output: tools/out/audio/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { launch, SOFTWARE_RE } = await import(pathToFileURL(path.join(ROOT, 'tools', 'pw.mjs')).href);
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const port = +arg('--port', 8774);
const RENDER = process.argv.includes('--render');
const OUT = path.join(ROOT, 'tools', 'out', 'audio');
fs.mkdirSync(OUT, { recursive: true });

const inUse = (p) => new Promise((res) => {
  const s = net.connect({ port: p, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});
let failures = 0;
const print = (check, ok, result) => console.log(JSON.stringify({ check, ok, result }));
const verdict = (check, ok, result) => { if (!ok) failures++; print(check, !!ok, result); };

let server = null;
let browser = null;
const consoleLines = [];

async function main() {
try {
  if (!(await inUse(port))) {
    server = spawn('python', [path.join('tools', 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 50 && !(await inUse(port)); i++) await new Promise((r) => setTimeout(r, 100));
  }
  const l = await launch();
  browser = l.browser;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const loc = m.location() || {};
    consoleLines.push({ type: m.type(), text: m.text().slice(0, 300), url: (loc.url || '').replace(/^https?:\/\/[^/]+/, '') });
  });
  page.on('pageerror', (e) => consoleLines.push({ type: 'pageerror', text: String(e).slice(0, 300), url: '' }));
  print('renderer', !SOFTWARE_RE.test(l.renderer), l.renderer);
  if (RENDER) {
    // Renders need only the modules, not the game: a same-origin page (the server's directory listing).
    await page.goto(`http://127.0.0.1:${port}/src/audio/`);
    await runRender(page);
  } else {
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => window.__kk && window.__kk.ready, null, { timeout: 30000 });
    await runLive(page);
  }
  const mine = consoleLines.filter((c) => /\/src\/audio\//.test(c.url) || /\[audio\]/.test(c.text));
  verdict('console: nothing from audio', mine.length === 0, mine.slice(0, 10));
  verdict('console: no errors or warnings at all', consoleLines.length === 0, consoleLines.slice(0, 10));
} catch (e) {
  failures++;
  print('scenario crashed', false, String(e && e.stack || e).slice(0, 800));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
process.exit(failures ? 1 : 0);
}

// ------------------------------------------------------------------------------------------------------
async function runLive(page) {
  const ev = (fn, a) => page.evaluate(fn, a);
  const sleep = (ms) => page.waitForTimeout(ms);
  const A = () => ev(() => {
    const a = window.__kk.game.systems.audio;
    return { state: a.state, key: a.debug.musicKey(), music: a.debug.music(), phase: window.__kk.game.phase };
  });
  const level = async (ms = 1200) => {
    const xs = [];
    for (let t = 0; t < ms; t += 100) { xs.push(await ev(() => window.__kk.game.systems.audio.debug.level())); await sleep(100); }
    const lin = xs.filter(Number.isFinite).map((d) => 10 ** (d / 10));
    return lin.length ? +(10 * Math.log10(lin.reduce((x, y) => x + y, 0) / xs.length)).toFixed(1) : -Infinity;
  };
  const waitPhase = async (phase, ms = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if ((await A()).phase === phase) return true; await sleep(100); }
    return false;
  };
  // Fire and forget: nextRace resolves only when the podium shot ends.
  const api = (fn, ...a) => ev(([f, xs]) => { window.__kk.game.api[f](...xs); }, [fn, a]);
  await installSpectrogram(page);

  verdict('no audio context before a gesture', (await A()).state === 'none', await A());
  await page.mouse.click(640, 360);
  await sleep(2500);
  let s = await A();
  verdict('gesture unlock → running + title music', s.state === 'running' && s.key === 'title', s);
  verdict('title theme audible', (await level()) > -40, await level(600));

  // Music key 150 ms after each phase change; event counts through a tap (taps are not listeners, so
  // core's per-race leak check is unaffected).
  const listeners0 = await ev(() => {
    const kk = window.__kk, g = kk.game, a = g.systems.audio;
    window.__phaseLog = [];
    g.events.on('phase', (e) => {
      const rec = { to: e.to, key: undefined };
      window.__phaseLog.push(rec);
      setTimeout(() => { rec.key = a.debug.musicKey(); rec.stillThere = g.phase === e.to; }, 150);
    });
    window.__evCount = {};
    g.events.tap((name, p) => {
      const k = p && (p.kart || p.a);
      const who = k && k.isPlayer ? 'player' : 'cpu';
      const key = name === 'drift' ? 'drift:' + p.state : name;
      const c = (window.__evCount[key] ||= { player: 0, cpu: 0 });
      c[who]++;
    });
    kk.setAutoPause(false);
    return kk.listenerCount();
  });
  const mem0 = await ev(() => window.__kk.memory());

  // ---- race 1: meadow with its intro -----------------------------------------------------------------
  await ev(() => { window.__kk.startRace({ track: 'meadow', autopilot: true, seed: 3 }); });
  await waitPhase('race');
  await sleep(600);
  const log = await ev(() => window.__phaseLog.slice());
  const at = (p) => log.find((r) => r.to === p);
  const intro = at('intro');
  verdict('intro phase plays the chapter intro', !intro || !intro.stillThere || intro.key === 'intro:meadow', intro || 'no intro phase');
  verdict('countdown is beeps only (music key null)', at('countdown')?.key === null, at('countdown'));
  verdict('race music from GO', at('race')?.key === 'race:meadow', at('race'));
  await ev(() => { window.__kk.game.systems.audio.debug.resetVoiced(); window.__evCount = {}; window.__voicedFrom = performance.now(); });
  await sleep(5000);
  const lRace = await level();
  verdict('race mix level', lRace > -40 && lRace < -8, lRace);
  await page.screenshot({ path: path.join(OUT, 'race.png') });
  const budget = await ev(() => window.__kk.perf());
  verdict('§16 budget in the race view', budget.drawCalls <= 250 && budget.triangles <= 700000,
    { drawCalls: budget.drawCalls, shadowCalls: budget.shadowCalls, triangles: budget.triangles, quality: budget.quality });

  await api('setSetting', 'musicVolume', 0);
  await sleep(300);
  const lFx = await level();
  await api('setSetting', 'musicVolume', 0.7);
  await api('setSetting', 'sfxVolume', 0);
  await sleep(300);
  const lMusic = await level();
  await api('setSetting', 'sfxVolume', 0.9);
  verdict('balance: music not buried under engines + SFX', lMusic - lFx > -6, { lMusic, lEnginesSfx: lFx });

  const cost = await ev(async () => {
    const a = window.__kk.game.systems.audio;
    const orig = a.update, ts = [];
    a.update = (dt) => { const t = performance.now(); orig(dt); ts.push(performance.now() - t); };
    await new Promise((r) => setTimeout(r, 4000));
    a.update = orig;
    ts.sort((x, y) => x - y);
    return { frames: ts.length, meanMs: +(ts.reduce((x, y) => x + y, 0) / ts.length).toFixed(3), p95Ms: +ts[Math.floor(ts.length * 0.95)].toFixed(3), maxMs: +ts[ts.length - 1].toFixed(3) };
  });
  verdict('audio.update cost per frame', cost.p95Ms < 1.5, cost);

  // Real-race voicing: what the karts emitted during ~11 s of racing vs what audio actually voiced.
  const voicing = await ev(() => ({ events: window.__evCount, voiced: window.__kk.game.systems.audio.debug.voiced(), seconds: (performance.now() - window.__voicedFrom) / 1000 }));
  // Judged: kinds the player always hears. land (airTime > 0.2 s), wallHit (0.2 s per kart), bump and
  // drift:cancel are reported only.
  const pairs = { hop: ['hop', true], 'drift:tier': ['tier', true], boost: ['boost', true], land: ['land'], wallHit: ['wall'], bump: ['bump'], 'drift:cancel': ['driftCancel'] };
  const table = {};
  for (const [evName, [sfx]] of Object.entries(pairs)) {
    const e = voicing.events[evName];
    table[evName] = { player: e?.player || 0, cpu: e?.cpu || 0, voiced: voicing.voiced[sfx] || 0 };
  }
  const silentKinds = Object.entries(table).filter(([k, v]) => pairs[k][1] && v.player > 0 && v.voiced === 0).map(([k]) => k);
  verdict('real race: every kind the player emitted was voiced', silentKinds.length === 0, { table, voiced: voicing.voiced, silentKinds });
  const perS = (n) => +((voicing.voiced[n] || 0) / voicing.seconds).toFixed(2);
  const total = Object.values(voicing.voiced).reduce((x, y) => x + y, 0);
  const popups = voicing.events.popup ? voicing.events.popup.player + voicing.events.popup.cpu : 0;
  verdict('real race: SFX density (rustle waves ≤ 2.5/s, bumps ≤ 3/s)', perS('rustle') <= 2.5 && perS('bump') <= 3,
    { seconds: +voicing.seconds.toFixed(1), popupEventsPerS: +(popups / voicing.seconds).toFixed(2), rustlePerS: perS('rustle'), bumpPerS: perS('bump'),
      bumpEventsPerS: +(((table.bump.player + table.bump.cpu) || 0) / voicing.seconds).toFixed(2), allSfxPerS: +(total / voicing.seconds).toFixed(2) });

  // What the SFX layer is on its own (music 0): engines, rustle waves, bumps, boosts.
  await api('setSetting', 'musicVolume', 0);
  await ev(() => window.__spec.capture('meadow race · engines + SFX only (music 0)', 6000));
  await api('setSetting', 'musicVolume', 0.7);

  // Spectrogram of the flow: race → pause (duck) → resume → mute → unmute → music off → on.
  await ev(() => window.__spec.capture('meadow race · pause · resume · mute · unmute · music 0 · music 0.7', 14000, [
    { at: 3000, do: 'pause', label: 'pause' }, { at: 5500, do: 'unpause', label: 'resume' },
    { at: 7500, do: 'mute', label: 'mute' }, { at: 9000, do: 'unmute', label: 'unmute' },
    { at: 10500, do: 'musicOff', label: 'music 0' }, { at: 12300, do: 'musicOn', label: 'music 0.7' },
  ]));
  const flow = await ev(() => window.__spec.summary(1));
  verdict('pause ducks ≥ 6 dB', flow.levels.race - flow.levels.pause >= 6, flow.levels);
  verdict('mute silences (< −80 dB)', flow.levels.mute < -80, flow.levels);
  verdict('unmute restores', flow.levels.unmute > -40, flow.levels);
  await ev(() => window.__spec.draw());
  await page.screenshot({ path: path.join(OUT, 'spectrogram-flow.png') });
  await ev(() => window.__spec.clear());

  // Item / projectile / threat / popup payloads from the §11 table (items and scenery may still be stubs),
  // plus the kart methods that exist today (spinOut, applyInk, startRespawn).
  await ev(() => window.__kk.game.systems.audio.debug.resetVoiced());
  const sent = await ev(async () => {
    const kk = window.__kk, g = kk.game, E = g.events;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const p = g.player;
    const cpu = g.karts.find((k) => !k.isPlayer);
    const near = { x: p.pos.x + 8, y: p.pos.y, z: p.pos.z + 8 };
    const ahead = g.track.pointAt(((p.trackInfo.t + 90 / g.track.length) % 1), 16, {}).pos;
    const sent = [];
    const emit = (name, payload) => { E.emit(name, payload); sent.push(name); };
    emit('itemBox', { kart: p, pos: p.pos });
    await wait(120);
    emit('itemGet', { kart: p, item: 'rocket3' });
    for (const item of ['rocket', 'rocket3', 'gum', 'plane', 'homing', 'ink', 'foil', 'scissors']) {
      await wait(160);
      emit('itemUse', { kart: p, item, backward: false });
    }
    await wait(150);
    emit('projectile', { kind: 'plane', pos: near, owner: p, target: cpu, state: 'spawn' });
    emit('projectile', { kind: 'plane', pos: near, owner: p, target: cpu, state: 'bounce' });
    await wait(120);
    emit('projectile', { kind: 'homing', pos: near, owner: cpu, target: p, state: 'lock' });
    emit('threat', { kart: p, kind: 'homing', eta: 1.5 });
    await wait(400);
    emit('threat', { kart: p, kind: 'homing', eta: 0.5 });
    await wait(200);
    emit('projectile', { kind: 'homing', pos: near, owner: cpu, target: p, state: 'hit' });
    emit('projectile', { kind: 'plane', pos: near, owner: p, target: cpu, state: 'expire' });
    emit('popup', { pos: ahead, size: 4 });
    await wait(200);
    p.graceTime = 0; p.invincibleTime = 0; p.spinTime = 0;
    if (p.respawn.active) p.teleport(p.trackInfo.t, 0);
    p.spinOut('scissors', cpu);
    await wait(300);
    p.applyInk(1);
    await wait(300);
    p.startRespawn();
    await wait(1500);
    return sent;
  });
  const voicedItems = await ev(() => window.__kk.game.systems.audio.debug.voiced());
  const want = ['box', 'itemGet', 'use_rocket', 'use_gum', 'use_plane', 'use_homing', 'use_ink', 'use_foil', 'use_scissors',
    'planeBounce', 'lock', 'threat', 'impact', 'poof', 'rustle', 'hit_scissors', 'ink', 'respawnLift'];
  const missing = want.filter((n) => !voicedItems[n]);
  verdict('item-family and kart-method events are voiced (rocket3 → rocket, popup rustle at ~90 m)', missing.length === 0,
    { sent: sent.length, voiced: voicedItems, missing });

  // Final lap: tempo × 1.12 of the track's own tempo, key up.
  const fl = await ev(() => {
    const kk = window.__kk, g = kk.game;
    for (let i = 0; i < 400 && g.player.lap < g.race.laps; i++) kk.simulate(0.5);
    return { lap: g.player.lap, laps: g.race.laps, defTempo: g.trackDef.music?.tempo };
  });
  await sleep(3500);
  s = await A();
  const expTempo = +(fl.defTempo * 1.12).toFixed(1);
  verdict('final lap: tempo ×1.12 of def.music.tempo and key up', s.music && Math.abs(s.music.tempo - expTempo) < 0.6 && s.music.transpose > 0, { fl, expTempo, music: s.music });

  // The player crosses the line for real (the `finish` event), then the race is concluded.
  await ev(() => window.__kk.game.systems.audio.debug.resetVoiced());
  const fin = await ev(() => {
    const kk = window.__kk, g = kk.game;
    for (let i = 0; i < 400 && !g.player.finished; i++) kk.simulate(0.25);
    return { finished: g.player.finished, place: g.player.place, estimated: !!g.player.estimated, phase: g.phase };
  });
  await sleep(500);
  s = await A();
  const vFin = await ev(() => window.__kk.game.systems.audio.debug.voiced());
  verdict('real finish event → finish-line SFX + fanfare + results queued', fin.finished && !fin.estimated && vFin.finishLine === 1 && s.key === 'results',
    { fin, finishLine: vFin.finishLine || 0, key: s.key, music: s.music });
  await sleep(7000);
  const lRes = await level();
  verdict('results theme audible after the fanfare', lRes > -40, lRes);
  await ev(() => window.__kk.finishNow());
  await sleep(400);
  s = await A();
  verdict('race concluded → results phase keeps the results theme', s.phase === 'results' && s.key === 'results', s);
  await page.screenshot({ path: path.join(OUT, 'results.png') });

  // ---- the four chapter themes ------------------------------------------------------------------------
  const tracks = await ev(() => window.__kk.game.gp.cup.slice());
  let idx = 0;
  for (const id of tracks) {
    await ev(async (t) => {
      await window.__kk.startRace({ track: t, autopilot: true, skipIntro: true, seed: 11 });
      window.__kk.simulate(3.3);
    }, id);
    await sleep(1200);
    const info = await ev(() => {
      const g = window.__kk.game, a = g.systems.audio;
      return { phase: g.phase, key: a.debug.musicKey(), music: a.debug.music(), def: g.trackDef.music };
    });
    const lFull = await level(1500);
    // The strip shows the music alone (SFX bus at 0) so each chapter's own character is visible.
    await api('setSetting', 'sfxVolume', 0);
    await ev(([t, i]) => window.__spec.capture(`${t} · music only · def.music ${JSON.stringify(window.__kk.game.trackDef.music)}`, 6000, [], i), [id, idx]);
    await api('setSetting', 'sfxVolume', 0.9);
    const sum = await ev((i) => window.__spec.summary(i), idx);
    verdict(`chapter theme ${id}`, info.key === `race:${id}` && info.music && Math.abs(info.music.tempo - info.def.tempo) < 0.01 && lFull > -40 && sum.levels.all > -40,
      { ...info, levelFullMix: lFull, levelMusicOnly: sum.levels.all });
    idx++;
  }
  await ev(() => window.__spec.draw());
  await page.screenshot({ path: path.join(OUT, 'spectrogram-chapters.png') });
  await ev(() => window.__spec.clear());

  // Leak check over the five races so far (meadow with intro + the four chapters), back at the title.
  await api('quitToTitle');
  await sleep(1500);
  const end = await ev(() => ({ listeners: window.__kk.listenerCount(), mem: window.__kk.memory(), leaks: window.__kk.leaks() }));
  // listeners0 was read after the scenario's own 'phase' listener was added.
  verdict('no leaks across five races (__kk.leaks, listeners, scene, GPU at the title)',
    end.leaks.leaks.length === 0 && end.listeners === listeners0 && end.mem.objects === mem0.objects &&
      end.mem.geometries === mem0.geometries && end.mem.textures === mem0.textures,
    { listeners0, listeners1: end.listeners, mem0, mem1: end.mem, leaks: end.leaks.leaks, lastCheck: end.leaks.last && end.leaks.last.problems });

  // ---- GP podium ------------------------------------------------------------------------------------
  const names = () => ev(() => { const xs = []; window.__kk.game.scene.traverse((o) => xs.push(`${o.type}:${o.name || ''}`)); return xs; });
  const titleNames = await names();
  await ev(async () => {
    const kk = window.__kk;
    await kk.startGP({ index: 3, autopilot: true, seed: 4 });
    kk.simulate(8);
    kk.finishNow();
  });
  await waitPhase('results', 5000);
  await sleep(600);
  await api('nextRace');
  await waitPhase('podium', 5000);
  await sleep(1500);
  s = await A();
  const lPod = await level();
  verdict('GP podium theme', s.phase === 'podium' && s.key === 'podium' && lPod > -40, { ...s, level: lPod });
  await page.screenshot({ path: path.join(OUT, 'podium.png') });

  await api('quitToTitle');
  await sleep(1500);
  s = await A();
  verdict('back to the title theme', s.key === 'title' && s.phase === 'title', s);

  const end2 = await ev(() => ({ listeners: window.__kk.listenerCount(), mem: window.__kk.memory(), leaks: window.__kk.leaks() }));
  verdict('no leaks after the GP race (__kk.leaks, listeners)', end2.leaks.leaks.length === 0 && end2.listeners === listeners0,
    { listeners0, listeners1: end2.listeners, leaks: end2.leaks.leaks });
  // Audio owns no scene objects or GPU resources; what the podium leaves at the title belongs to its shot.
  const count = (xs) => xs.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
  const c0 = count(titleNames), c1 = count(await names());
  const drift = {};
  for (const k of new Set([...Object.keys(c0), ...Object.keys(c1)])) if ((c0[k] || 0) !== (c1[k] || 0)) drift[k] = [c0[k] || 0, c1[k] || 0];
  print('info: title scene before vs after the GP podium (not audio-owned)', true, { mem: [end.mem, end2.mem], drift });
  print('timings (ms): context in the gesture, graph build next frame, title start, race prepare', true,
    await ev(() => window.__kk.game.systems.audio.debug.timings()));
  const gameErr = await ev(() => ({ errors: window.__kk.errors.slice(0, 10), warnings: window.__kk.warnings.slice(0, 10) }));
  verdict('__kk.errors / __kk.warnings empty', gameErr.errors.length === 0 && gameErr.warnings.length === 0, gameErr);
}

// Spectrogram overlay drawn by the test (never part of the game): log-frequency rows from the master
// analyser, a level trace, and markers for scripted actions.
async function installSpectrogram(page) {
  await page.evaluate(() => {
    const ROWS = 140, LO = 40, HI = 16000;
    const strips = [];
    const act = {
      pause: () => window.__kk.game.api.setPaused(true),
      unpause: () => window.__kk.game.api.setPaused(false),
      mute: () => window.__kk.game.api.toggleMute(),
      unmute: () => window.__kk.game.api.toggleMute(),
      musicOff: () => window.__kk.game.api.setSetting('musicVolume', 0),
      musicOn: () => window.__kk.game.api.setSetting('musicVolume', 0.7),
    };
    let canvas = null;
    window.__spec = {
      async capture(label, ms, script = [], slot = strips.length) {
        const a = window.__kk.game.systems.audio;
        const an = a.debug.analyser();
        const sr = a.ctx.sampleRate, bins = an.frequencyBinCount;
        // Test-only view range; the game never reads the byte spectrum.
        an.minDecibels = -100; an.maxDecibels = -15;
        let prevVoiced = a.debug.voiced();
        const buf = new Uint8Array(bins);
        const edge = [];
        for (let r = 0; r <= ROWS; r++) edge.push(Math.min(bins - 1, Math.round(LO * (HI / LO) ** (r / ROWS) / (sr / 2) * bins)));
        const cols = [], marks = [];
        const t0 = performance.now();
        let si = 0;
        for (;;) {
          const t = performance.now() - t0;
          if (t >= ms) break;
          while (si < script.length && script[si].at <= t) { const x = script[si++]; act[x.do](); marks.push({ t, label: x.label }); }
          an.getByteFrequencyData(buf);
          const col = new Uint8Array(ROWS);
          for (let r = 0; r < ROWS; r++) { let m = 0; for (let b = edge[r]; b <= Math.max(edge[r], edge[r + 1] - 1); b++) m = Math.max(m, buf[b]); col[r] = m; }
          const v = a.debug.voiced(), ticks = [];
          for (const k in v) if (v[k] > (prevVoiced[k] || 0)) ticks.push(k);
          prevVoiced = v;
          cols.push({ t, col, lvl: a.debug.level(), ticks });
          await new Promise((res) => setTimeout(res, 40));
        }
        strips[slot] = { label, ms, cols, marks };
      },
      // Mean level per scripted segment (energy mean), skipping 0.6 s after each action for the fades.
      summary(i) {
        const s = strips[i];
        const seg = {};
        const bounds = [{ t: 0, label: 'race' }, ...s.marks, { t: s.ms, label: null }];
        const mean = (xs) => { const lin = xs.filter(Number.isFinite).map((d) => 10 ** (d / 10)); return lin.length ? +(10 * Math.log10(lin.reduce((x, y) => x + y, 0) / lin.length)).toFixed(1) : -Infinity; };
        for (let j = 0; j + 1 < bounds.length; j++) {
          const a = bounds[j].t + (j ? 600 : 0), b = bounds[j + 1].t;
          seg[bounds[j].label] = mean(s.cols.filter((c) => c.t >= a && c.t < b).map((c) => (c.lvl < -200 ? -200 : c.lvl)));
        }
        seg.all = mean(s.cols.map((c) => (c.lvl < -200 ? -200 : c.lvl)));
        return { label: s.label, levels: seg };
      },
      draw() {
        canvas = document.createElement('canvas');
        const W = 1280, H = 720;
        canvas.width = W; canvas.height = H;
        canvas.style.cssText = 'position:fixed;inset:0;width:1280px;height:720px;z-index:2147483647';
        document.body.appendChild(canvas);
        const g = canvas.getContext('2d');
        g.fillStyle = '#23201c'; g.fillRect(0, 0, W, H);
        const n = strips.length, pad = 10, left = 58, right = 12, top = 8;
        const sh = (H - top - pad * n) / n;
        const heat = (v) => { const x = v / 255; return `rgb(${Math.round(40 + 215 * Math.min(1, x * 1.4))},${Math.round(30 + 200 * Math.max(0, x - 0.3) / 0.7)},${Math.round(60 + 100 * Math.max(0, x - 0.75) / 0.25)})`; };
        strips.forEach((s, i) => {
          const y0 = top + i * (sh + pad), pw = W - left - right;
          g.fillStyle = '#000'; g.fillRect(left, y0, pw, sh);
          const cw = Math.max(1, pw / Math.max(1, s.cols.length) + 0.5);
          for (const c of s.cols) {
            const x = left + (c.t / s.ms) * pw;
            for (let r = 0; r < ROWS; r++) { if (c.col[r] < 8) continue; g.fillStyle = heat(c.col[r]); g.fillRect(x, y0 + sh - (r + 1) * sh / ROWS, cw, sh / ROWS + 0.5); }
          }
          g.font = '11px system-ui'; g.fillStyle = '#cfc6b4';
          for (const f of [100, 1000, 10000]) {
            const yy = y0 + sh - (Math.log(f / LO) / Math.log(HI / LO)) * sh;
            g.fillRect(left - 4, yy, 4, 1); g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), 22, yy + 4);
          }
          g.strokeStyle = '#7fd1ff'; g.lineWidth = 1.5; g.beginPath();
          s.cols.forEach((c, j) => { const v = Math.max(-70, Math.min(0, c.lvl)); const x = left + (c.t / s.ms) * pw, y = y0 + (-v / 70) * sh; j ? g.lineTo(x, y) : g.moveTo(x, y); });
          g.stroke();
          for (const m of s.marks) { const x = left + (m.t / s.ms) * pw; g.fillStyle = '#fff'; g.fillRect(x, y0, 1.5, sh); g.fillText(m.label, x + 4, y0 + 24); }
          // Voiced SFX as ticks along the bottom: one row per family.
          const fam = [['rustle', /^rustle/, '#8fe38f'], ['bump', /^bump/, '#ff6b6b'], ['boost', /^boost/, '#ffd23f'],
            ['hop/land/trick', /^(hop|land|trick)/, '#c792ea'], ['other', /./, '#ffffff']];
          for (const c of s.cols) {
            const x = left + (c.t / s.ms) * pw;
            for (const name of c.ticks) {
              const r = fam.findIndex((f) => f[1].test(name));
              g.fillStyle = fam[r][2]; g.fillRect(x, y0 + sh - 6 - r * 6, 3, 5);
            }
          }
          fam.forEach((f, r) => { g.fillStyle = f[2]; g.font = '9px system-ui'; g.fillText(f[0], left + pw - 70, y0 + sh - 1 - r * 6); });
          g.fillStyle = '#fff'; g.font = 'bold 12px system-ui'; g.fillText(s.label, left + 6, y0 + 12);
          g.font = '10px system-ui'; g.fillStyle = '#7fd1ff'; g.fillText('level 0…−70 dB', W - right - 90, y0 + 12);
        });
      },
      clear() { if (canvas) canvas.remove(); canvas = null; strips.length = 0; },
    };
  });
}

// ------------------------------------------------------------------------------------------------------
// Offline renders through the same modules the game runs, loaded from /src/audio/ by the served page.
const RENDER_MODULE = `
import { createBank, prng } from '/src/audio/dsp.js';
import { createMixer } from '/src/audio/mixer.js';
import { createInstruments } from '/src/audio/instruments.js';
import { createMusic } from '/src/audio/music.js';
import { THEMES, CHAPTERS, STINGERS } from '/src/audio/themes.js';
import { createSfx, SFX, SFX_VARIANTS } from '/src/audio/sfx.js';
import { createEngines } from '/src/audio/engine.js';
const SR = 44100;
function setup(seconds) {
  const oc = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const bank = createBank(oc);
  const mix = createMixer(oc, bank, { bare: true });
  mix.setVolumes(1, 1, false);
  return { oc, bank, mix };
}
// Pump the scheduler every chunk of render time, like the live lookahead loop.
function chunked(oc, seconds, chunk, fn) {
  for (let t = chunk; t < seconds - 0.01; t += chunk) {
    const at = Math.round(t * SR / 128) * 128 / SR;
    oc.suspend(at).then(() => { fn(at); oc.resume(); });
  }
}
function wav(buf) {
  const ch = buf.numberOfChannels, n = buf.length, v = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const cs = []; for (let c = 0; c < ch; c++) cs.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, cs[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Uint8Array(v.buffer);
}
async function send(name, buf, meta) {
  const bytes = wav(buf), CH = 3 << 20;
  for (let o = 0; o < bytes.length; o += CH) {
    const sub = bytes.subarray(o, Math.min(bytes.length, o + CH));
    let s = '';
    for (let i = 0; i < sub.length; i += 0x8000) s += String.fromCharCode.apply(null, sub.subarray(i, i + 0x8000));
    await window.__saveChunk(name, btoa(s), o, o + CH >= bytes.length, meta || null);
  }
}
async function music(theme, seconds, finalLapAt) {
  const { oc, bank, mix } = setup(seconds);
  const inst = createInstruments(oc, bank);
  const m = createMusic(oc, { music: mix.musicIn, reverb: mix.reverbIn }, inst, bank);
  const i0 = m.play(theme, { at: 0 });
  let fl = false;
  chunked(oc, seconds, 0.25, (t) => { if (finalLapAt != null && !fl && t >= finalLapAt) { fl = true; m.finalLap(i0); } m.pump(t, t + 0.4); });
  const buf = await oc.startRendering();
  return { buf, loops: (i0.loops || []).slice(), tempo: i0.tempo, transpose: i0.transpose, form: m.duration(theme) };
}
async function engineDriveBy(seconds = 14) {
  const { oc, bank, mix } = setup(seconds);
  const eng = createEngines(oc, mix.engineIn, bank);
  const mk = (i, isPlayer) => ({ index: i, isPlayer, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, speed: 0, baseTop: 25,
    controls: { throttle: 0, steer: 0 }, grounded: true, surface: 'road', drift: { active: false, dir: 0, tier: 0 },
    draft: { charge: 0 }, boostTime: 0, boostStrength: 1, spinTime: 0, invincibleTime: 0, respawn: { active: false } });
  const p = mk(0, true), cpus = [1, 2, 3].map((i) => mk(i, false));
  const game = { player: p, karts: [p, ...cpus], phase: 'race' };
  const L = { x: 0, y: 2.6, z: -6.5, rx: -1, ry: 0, rz: 0 };
  eng.setActive(true);
  const dt = 1 / 60;
  for (let t = dt; t < seconds - 0.02; t += dt) {
    const at = Math.round(t * SR / 128) * 128 / SR;
    oc.suspend(at).then(() => {
      p.controls.throttle = at < 0.8 ? (at > 0.3 ? 1 : 0) : at < 11 ? 1 : 0.3;
      const target = at < 0.8 ? 0 : at < 6.5 ? 25 : at < 8.5 ? 24 : at < 10 ? 13.5 : 22;
      p.speed += (target - p.speed) * Math.min(1, dt * (at < 6.5 ? 0.5 : 1.5));
      p.drift.active = at > 6.5 && at < 8.4; p.drift.dir = 1;
      p.drift.tier = at > 8 ? 3 : at > 7.6 ? 2 : at > 7 ? 1 : 0;
      p.boostTime = at > 8.4 && at < 9.6 ? 9.6 - at : 0;
      p.surface = at > 10 && at < 11.5 ? 'offroad' : 'road';
      p.vel.z = p.speed;
      cpus.forEach((c, i) => { c.speed = 29; c.controls.throttle = 1; c.vel.z = 29; c.pos.x = (i - 1) * 3; c.pos.z = Math.max(-200, Math.min(200, -60 + (at - 3 - i * 1.5) * (29 - p.speed))); });
      eng.update(game, L, 1, dt);
      oc.resume();
    });
  }
  return { buf: await oc.startRendering() };
}
window.__audioRender = async function renderAll() {
  const report = { themes: {}, finals: {}, stingers: {}, sfx: [], ms: {} };
  let t0 = performance.now();
  for (const [name, theme] of Object.entries(THEMES)) {
    const probe = setup(0.1);
    const len = createMusic(probe.oc, { music: probe.mix.musicIn, reverb: probe.mix.reverbIn }, createInstruments(probe.oc, probe.bank), probe.bank).duration(theme);
    const r = await music(theme, len + 8, null);
    report.themes[name] = { seconds: +(len + 8).toFixed(1), form: +len.toFixed(1), loops: r.loops, tempo: r.tempo };
    await send('theme_' + name + '.wav', r.buf, { kind: 'theme', name, loops: r.loops });
  }
  report.ms.themes = Math.round(performance.now() - t0); t0 = performance.now();
  for (const [name, theme] of Object.entries(CHAPTERS)) {
    const r = await music(theme, 34, 3);
    report.finals[name] = { tempo: r.tempo, transpose: r.transpose, baseTempo: theme.tempo };
    await send('finallap_' + name + '.wav', r.buf, { kind: 'final', name });
  }
  for (const [name, theme] of Object.entries(STINGERS)) {
    const probe = setup(0.1);
    const len = createMusic(probe.oc, { music: probe.mix.musicIn, reverb: probe.mix.reverbIn }, createInstruments(probe.oc, probe.bank), probe.bank).duration(theme);
    const { oc, bank, mix } = setup(len + 3);
    const m = createMusic(oc, { music: mix.musicIn, reverb: mix.reverbIn }, createInstruments(oc, bank), bank);
    m.play(theme, { at: 0, once: true });
    chunked(oc, len + 3, 0.25, (t) => m.pump(t, t + 0.4));
    await send('stinger_' + name + '.wav', await oc.startRendering(), { kind: 'stinger', name });
    report.stingers[name] = { seconds: +(len + 3).toFixed(1) };
  }
  report.ms.finalsStingers = Math.round(performance.now() - t0); t0 = performance.now();
  for (const name of Object.keys(SFX)) {
    for (const p of SFX_VARIANTS[name] || [{}]) {
      const label = [name, ...Object.values(p)].join('_');
      const { oc, bank, mix } = setup(2.2);
      createSfx(oc, mix.sfxIn, bank, prng(7)).play(name, { ...p, important: true }, 0.03);
      await send('sfx_' + label + '.wav', await oc.startRendering(), { kind: 'sfx', name: label });
      report.sfx.push(label);
    }
  }
  report.ms.sfx = Math.round(performance.now() - t0); t0 = performance.now();
  await send('engine_driveby.wav', (await engineDriveBy()).buf, { kind: 'engine', name: 'driveby' });
  report.ms.engine = Math.round(performance.now() - t0);
  return report;
};
window.__audioRenderReady = true;
`;

async function runRender(page) {
  const files = new Map();
  const parts = new Map();
  await page.exposeFunction('__saveChunk', (name, b64, offset, last, meta) => {
    if (!parts.has(name)) parts.set(name, []);
    parts.get(name).push([offset, Buffer.from(b64, 'base64')]);
    if (!last) return;
    const buf = Buffer.concat(parts.get(name).sort((a, b) => a[0] - b[0]).map((x) => x[1]));
    parts.delete(name);
    fs.writeFileSync(path.join(OUT, name), buf);
    files.set(name, { buf, meta });
  });
  await page.addScriptTag({ type: 'module', content: RENDER_MODULE });
  await page.waitForFunction(() => window.__audioRenderReady === true, null, { timeout: 30000 });
  page.setDefaultTimeout(0);
  const t0 = Date.now();
  const report = await page.evaluate(() => window.__audioRender());
  print('render: files and time', true, { files: files.size, seconds: (Date.now() - t0) / 1000, ms: report.ms });

  const an = {};
  for (const [name, { buf, meta }] of files) an[name] = { ...analyse(buf, meta && meta.loops), meta };
  fs.writeFileSync(path.join(OUT, 'render-report.json'), JSON.stringify({ report, analysis: an }, null, 1));

  const clipped = Object.entries(an).filter(([, a]) => a.clip > 0 || a.peakDb > -0.1).map(([f, a]) => [f, a.peakDb, a.clip]);
  verdict('no clipping in any render (peak < −0.1 dBFS, no full-scale samples)', clipped.length === 0,
    { clipped, loudestSfx: top(an, 'sfx_', 'peakDb'), loudestMusic: top(an, 'theme_', 'peakDb') });
  const themes = Object.entries(an).filter(([f]) => f.startsWith('theme_'));
  const rms = themes.map(([f, a]) => [f.slice(6, -4), a.bodyRmsDb]);
  const spread = Math.max(...rms.map((x) => x[1])) - Math.min(...rms.map((x) => x[1]));
  verdict('theme loudness balanced (body RMS spread ≤ 3 dB)', spread <= 3, { spread: +spread.toFixed(2), rms });
  const gaps = themes.filter(([, a]) => a.silentQuarterSeconds > 0).map(([f, a]) => [f, a.silentQuarterSeconds]);
  verdict('no silent gaps inside the themes', gaps.length === 0, gaps);
  const seams = themes.map(([f, a]) => [f.slice(6, -4), a.seams]);
  const badSeam = seams.filter(([, ss]) => ss.some((x) => Math.abs(x.jumpDb) > 6 || x.afterDb < -40));
  verdict('loop seams continuous (level jump across each loop point ≤ 6 dB)', badSeam.length === 0, seams);
  const finals = Object.entries(report.finals).map(([k, v]) => [k, v.tempo / v.baseTempo, v.transpose]);
  verdict('final-lap renders: ×1.12 tempo, key up', finals.every(([, r, tr]) => Math.abs(r - 1.12) < 0.01 && tr > 0), finals);
  const silentSfx = Object.entries(an).filter(([f, a]) => f.startsWith('sfx_') && a.rmsDb < -60).map(([f]) => f);
  verdict('every SFX render is audible', silentSfx.length === 0, { count: report.sfx.length, silentSfx });
}

function top(an, prefix, key) {
  return Object.entries(an).filter(([f]) => f.startsWith(prefix)).sort((a, b) => b[1][key] - a[1][key]).slice(0, 3).map(([f, a]) => [f, a[key]]);
}

// Node-side measurement of the 16-bit WAV (independent of the browser's numbers).
function analyse(b, loops = null) {
  const ch = b.readUInt16LE(22), sr = b.readUInt32LE(24), n = (b.length - 44) / (2 * ch);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = b.readInt16LE(44 + i * 2 * ch) / 32768;
    R[i] = ch > 1 ? b.readInt16LE(44 + i * 2 * ch + 2) / 32768 : L[i];
  }
  const db = (x) => 20 * Math.log10(x + 1e-12);
  const pw = (a, z) => { let s = 0; const lo = Math.max(0, a), hi = Math.min(n, z); for (let j = lo; j < hi; j++) s += (L[j] * L[j] + R[j] * R[j]) / 2; return 10 * Math.log10(s / Math.max(1, hi - lo) + 1e-12); };
  let peak = 0, clip = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (a > peak) peak = a;
    if (a >= 0.999) clip++;
    sum += (L[i] * L[i] + R[i] * R[i]) / 2;
  }
  // Body: skip the first 2 s (fade-in) and the last second.
  const bodyRmsDb = n > 4 * sr ? pw(2 * sr, n - sr) : 10 * Math.log10(sum / n + 1e-12);
  let silentQuarterSeconds = 0;
  const q = Math.floor(sr / 4);
  for (let i = 2 * sr; i + q <= n - sr; i += q) if (pw(i, i + q) < -55) silentQuarterSeconds++;
  const seams = (loops || []).filter((t) => t > 1 && t * sr + sr < n).map((t) => {
    const i = Math.round(t * sr);
    const before = pw(i - sr, i), after = pw(i, i + sr);
    return { t: +t.toFixed(2), beforeDb: +before.toFixed(1), afterDb: +after.toFixed(1), jumpDb: +(after - before).toFixed(1) };
  });
  return { seconds: +(n / sr).toFixed(1), peakDb: +db(peak).toFixed(2), clip, rmsDb: +(10 * Math.log10(sum / n + 1e-12)).toFixed(2), bodyRmsDb: +bodyRmsDb.toFixed(2), silentQuarterSeconds, seams };
}

// Last, so every const above (RENDER_MODULE) is initialised before main runs.
await main();
