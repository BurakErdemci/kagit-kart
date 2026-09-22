// window.__kk (ARCHITECTURE.md §17). Installed first so it captures errors from the whole boot.

function fmtArg(a) {
  if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? ' @ ' + String(a.stack).split('\n')[1]?.trim() : ''}`;
  if (typeof a === 'object' && a !== null) {
    try { return JSON.stringify(a).slice(0, 300); } catch { return String(a); }
  }
  return String(a);
}

function summarize(payload) {
  const out = {};
  for (const k in payload) {
    const v = payload[k];
    if (v == null || typeof v !== 'object') out[k] = v;
    else if (v.id !== undefined && v.character) out[k] = v.id; // Kart
    else if (Array.isArray(v) && v.every((x) => x == null || typeof x !== 'object')) out[k] = v.slice(0, 16);
    else if (typeof v.x === 'number' && typeof v.z === 'number') out[k] = { x: +v.x.toFixed(2), y: +(v.y || 0).toFixed(2), z: +v.z.toFixed(2) };
  }
  return out;
}

export function installTestApi(game) {
  const errors = [];
  const warnings = [];
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.error = (...args) => { errors.push(args.map(fmtArg).join(' ')); origError(...args); };
  console.warn = (...args) => { warnings.push(args.map(fmtArg).join(' ')); origWarn(...args); };
  window.addEventListener('error', (e) => errors.push(`onerror: ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => errors.push(`unhandledrejection: ${fmtArg(e.reason)}`));

  const log = [];
  let seq = 0;
  let stats = null;
  // The per-event log builds a summary object per event, so it only runs under automation
  // (Playwright sets navigator.webdriver) or when a console session sets __kk.logEvents = true.
  // The counters behind stats() are cheap and always on.
  let logEvents = false;
  try { logEvents = navigator.webdriver === true; } catch { /* no navigator */ }
  function resetStats() {
    stats = { driftReleases: {}, itemUses: {}, placeChanges: 0, drifts: {}, boosts: {} };
  }
  resetStats();
  game.events.tap((name, payload) => {
    const kartId = payload?.kart?.id ?? payload?.a?.id ?? null;
    if (logEvents) {
      log.push({ seq: ++seq, t: +game.raceTime.toFixed(3), name, kartId, detail: summarize(payload || {}) });
      if (log.length > 300) log.shift();
    }
    if (name === 'raceSetup') resetStats();
    else if (name === 'drift' && payload.state === 'release' && payload.tier >= 1) {
      const r = (stats.driftReleases[kartId] ||= { t1: 0, t2: 0, t3: 0 });
      r['t' + payload.tier]++;
    } else if (name === 'itemUse') stats.itemUses[kartId] = (stats.itemUses[kartId] || 0) + 1;
    else if (name === 'place') stats.placeChanges++;
    else if (name === 'boost') stats.boosts[payload.source] = (stats.boosts[payload.source] || 0) + 1;
  });

  const frames = []; // [now, dtMs] pairs over the last 10 s
  let internals = null;
  let rendererString = null;

  function kartState(k) {
    return {
      id: k.id, place: k.place, lap: k.lap, progress: +k.progress.toFixed(2), finished: k.finished,
      finishTime: k.finishTime, pos: { x: +k.pos.x.toFixed(2), y: +k.pos.y.toFixed(2), z: +k.pos.z.toFixed(2) },
      speed: +k.speed.toFixed(2), item: k.item,
      drift: { active: k.drift.active, dir: k.drift.dir, tier: k.drift.tier, charge: +k.drift.charge.toFixed(2) },
      boostTime: +k.boostTime.toFixed(3), spinTime: +k.spinTime.toFixed(3),
      // extras
      isPlayer: k.isPlayer, autopilot: k.autopilot, grounded: k.grounded, airTime: +k.airTime.toFixed(3),
      surface: k.surface, lateral: +k.trackInfo.lateral.toFixed(2), t: +k.trackInfo.t.toFixed(4),
      respawn: k.respawn.active ? k.respawn.stage : null, boostSource: k.boostSource, lapTimes: k.lapTimes.slice(),
      heading: +k.heading.toFixed(4),
    };
  }

  function state() {
    const karts = game.karts.map(kartState);
    return {
      phase: game.phase, raceTime: +game.raceTime.toFixed(3), paused: game.paused,
      player: game.player ? kartState(game.player) : null,
      karts,
      race: game.race ? { state: game.race.state, countdown: game.race.countdown, laps: game.race.laps, startGrade: game.race.startGrade, results: game.race.results } : null,
    };
  }

  function perf() {
    const n = frames.length / 2;
    let fps = 0, p95 = 0;
    if (n > 1) {
      const span = (frames[frames.length - 2] - frames[0]) / 1000;
      fps = span > 0 ? (n - 1) / span : 0;
      const d = [];
      for (let i = 1; i < frames.length; i += 2) d.push(frames[i]);
      d.sort((a, b) => a - b);
      p95 = d[Math.min(d.length - 1, Math.floor(d.length * 0.95))];
    }
    if (!rendererString && game.renderer) {
      try {
        const gl = game.renderer.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        rendererString = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      } catch (e) { rendererString = 'unknown'; }
    }
    const p = internals?.perf || {};
    return {
      fps: +fps.toFixed(1), frameMsP95: +(p95 || 0).toFixed(2),
      drawCalls: p.lastCalls ?? 0, shadowCalls: p.lastShadowCalls ?? 0, triangles: p.lastTriangles ?? 0,
      renderer: rendererString,
      // extras
      quality: game.quality, pixelRatio: game.renderer?.getPixelRatio(), post: game.post?.enabled,
      memory: game.renderer ? { ...game.renderer.info.memory, programs: game.renderer.info.programs?.length ?? 0 } : null,
    };
  }

  const kk = {
    ready: false,
    errors,
    warnings,
    game,
    get logEvents() { return logEvents; },
    set logEvents(on) { logEvents = !!on; },
    startRace(opts = {}) {
      return game.api.startRace({ autopilot: true, ...opts });
    },
    async startGP({ index = 0, standings = null, cls, character, seed, autopilot = true } = {}) {
      await game.api.startGP({ index, standings, cls, character, seed });
      if (game.player) game.player.autopilot = autopilot;
    },
    simulate(seconds) {
      const steps = Math.round(seconds / game.config.STEP);
      for (let i = 0; i < steps; i++) {
        if (!internals.shouldStep()) break;
        internals.stepSim(game.config.STEP);
      }
      return state();
    },
    renderFrame() {
      game.renderer.updateWorld(game.camera);
      internals.render();
    },
    state,
    giveItem(kartIndex, itemId) {
      const k = game.karts[kartIndex];
      if (!k) return false;
      k.item = itemId;
      k.itemCount = itemId === 'rocket3' ? 3 : 1;
      k.roulette = 0;
      return true;
    },
    teleport(kartIndex, t, lateral = 0) {
      const k = game.karts[kartIndex];
      if (!k) return false;
      k.teleport(t, lateral);
      if (k.visual) { k.visual.object3d.position.copy(k.pos); k.visual.object3d.quaternion.copy(k.quat); }
      game.cameraRig.snap();
      return true;
    },
    finishNow() {
      if (!game.race) return false;
      game.race.finishNow();
      if (internals.shouldStep()) internals.stepSim(game.config.STEP);
      return true;
    },
    playShot(name, opts = {}) {
      return Promise.resolve(game.systems.cinematics.play(name, opts));
    },
    setTimeScale(n) {
      game.loop.timeScale = Math.max(1, Math.min(16, n));
    },
    setCamera(mode) {
      game.cameraRig.debugMode = mode === 'chase' || !mode ? null : mode;
      game.cameraRig.snap();
    },
    perf,
    events(sinceSeq = 0) { return sinceSeq ? log.filter((e) => e.seq > sinceSeq) : log.slice(); },
    eventSeq() { return seq; },
    listenerCount() { return game.events.count(); },
    stats() {
      const lapTimes = {};
      for (const k of game.karts) lapTimes[k.id] = k.lapTimes.slice();
      return { driftReleases: stats.driftReleases, itemUses: stats.itemUses, placeChanges: stats.placeChanges, lapTimes, boosts: stats.boosts };
    },
    // extras
    setControls(partial) { game.input.testControls = partial || null; },
    setAutoPause(on) { game.autoPause = !!on; },
    memory() { return internals?.leakSnapshot(); },
    leaks() { return { leaks: game.debug.leaks.slice(), last: game.debug.lastLeakCheck }; },
    layoutWarnings() { return warnings.filter((w) => w.startsWith('[track:')); },
  };
  window.__kk = kk;

  return {
    attach(x) { internals = x; },
    ready() { kk.ready = true; },
    recordFrame(dt, now) {
      frames.push(now, dt * 1000);
      while (frames.length > 4 && now - frames[0] > 10000) frames.splice(0, 2);
    },
  };
}
