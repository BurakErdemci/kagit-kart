// settings.quality 'auto': a level (features and pixel cap) plus a render scale on top of it follow the
// measured wall-clock frame time in every phase that shows the 3D view.
// Drops are fast and sized by how far the frame time is off: the cost is modelled as pixels × a per-level
// feature factor, so a frame at a third of the target falls several levels at once. Raises are slow probes,
// because a vsync-locked frame time hides the headroom; a probe that has to be taken back doubles the wait
// before the next one. A drop that buys nothing (a display or battery cap at 30 Hz, a CPU-bound frame) is
// undone and further drops wait until the frame time gets clearly worse.
const VIEW_PHASES = new Set(['title', 'menu', 'intro', 'countdown', 'race', 'finishing', 'results', 'podium']);
// Turning the shadow map on recompiles every scene program: raise across that boundary only where a
// stall does not land in the middle of a race.
const CALM_PHASES = new Set(['title', 'menu', 'results', 'podium']);

export function createAutoQuality(game, { levels, apply }) {
  const cfg = game.config.quality;
  const shadowed = (i) => (game.config.render.shadowSize[levels[i]] || 0) > 0;
  const floor = (i) => cfg.scaleFloor[levels[i]] ?? 1;
  const weight = (i) => cfg.levelCost[levels[i]] ?? 1;
  const cost = (i, s) => game.renderer.levelPixels(levels[i]) * s * s * weight(i);
  const target = 1000 / cfg.targetFps;

  let active = false;
  let top = 0, level = 0, scale = 1;
  const samples = [];
  let windowStart = 0, lastNow = 0, lastPhase = '', skip = 0, skipUntil = 0;
  let good = 0, hold = cfg.raiseHold * 1000;
  let probe = null; // state before the last raise, until it has held for a few windows
  let undo = null; // state before the last drop, checked once for a gain
  let blockedAbove = 0; // no drops while the frame time stays at or under this
  const log = []; // last evaluations, for tools/scenarios/lowend.mjs: [ms, phase, frame ms, level, scale, action]
  let evalAt = 0, evalPhase = '', evalF = 0;
  const note = (action) => {
    log.push([Math.round(evalAt), evalPhase, +evalF.toFixed(1), levels[level], +scale.toFixed(2), action]);
    if (log.length > 60) log.shift();
  };

  function set(i, s) {
    level = i;
    scale = s;
    skip = cfg.skipFrames;
    // a software rasteriser runs slow for a while after its buffers are reallocated
    skipUntil = lastNow + cfg.skipTime * 1000;
    samples.length = 0;
    windowStart = 0;
    apply(levels[i], s);
  }

  // Interquartile mean: a shader compile or a GC pause does not move it, alternating vsync frames do.
  function iqm() {
    samples.sort((a, b) => a - b);
    const a = Math.floor(samples.length / 4), b = Math.max(a + 1, Math.ceil(samples.length * 3 / 4));
    let sum = 0;
    for (let i = a; i < b; i++) sum += samples[i];
    return sum / (b - a);
  }

  function evaluate(f, span, phase) {
    if (probe) {
      if (f > target * cfg.dropFactor) {
        const p = probe;
        probe = null;
        good = 0;
        hold = Math.min(hold * 2, cfg.raiseHoldMax * 1000);
        set(p.level, p.scale);
        note('probe failed');
        return;
      }
      if (--probe.windows <= 0) probe = null;
    }
    if (undo) {
      const u = undo;
      undo = null;
      if (f > target * cfg.dropFactor && f > u.f * cfg.noGain) {
        blockedAbove = f * cfg.unblock;
        set(u.level, u.scale);
        note('no gain, undone');
        return;
      }
    }

    if (f > target * cfg.dropFactor) {
      good = 0;
      if (f <= blockedAbove) return;
      const want = cost(level, scale) * (target / f) * cfg.margin;
      let i = level;
      while (i < levels.length - 1 && cost(i, floor(i)) > want) i++;
      const s = Math.min(1, Math.max(floor(i), Math.sqrt(want / cost(i, 1))));
      if (i === level && s >= scale - 0.01) return; // nothing left to give
      undo = { level, scale, f };
      set(i, i === level ? Math.min(s, scale) : s);
      note('drop');
      return;
    }

    if (f > target * cfg.raiseFactor) { good = 0; return; }
    good += span;
    if (good < hold || probe) return;
    good = 0;
    let i = level, s = scale;
    if (scale < 1) s = Math.min(1, scale * cfg.raiseStep);
    else if (level > top && (CALM_PHASES.has(phase) || shadowed(level - 1) === shadowed(level))) {
      i = level - 1;
      s = Math.min(1, Math.max(floor(i), Math.sqrt(cost(level, scale) * cfg.raiseStep * cfg.raiseStep / cost(i, 1))));
    } else return;
    probe = { level, scale, windows: cfg.probeWindows };
    set(i, s);
    note('raise');
  }

  return {
    get active() { return active; },
    get level() { return levels[level]; },
    get scale() { return scale; },
    log,

    // (Re)start auto at `start`, never above `ceiling`.
    start(start, ceiling = start) {
      active = true;
      top = Math.max(0, levels.indexOf(ceiling));
      probe = null;
      undo = null;
      blockedAbove = 0;
      good = 0;
      hold = cfg.raiseHold * 1000;
      set(Math.max(top, levels.indexOf(start)), 1);
    },

    stop() { active = false; },

    frame(now) {
      const dt = lastNow ? now - lastNow : 0;
      lastNow = now;
      if (!active) return;
      const phase = game.phase;
      if (phase !== lastPhase) {
        // frame times of another scene say nothing about the last change
        lastPhase = phase;
        skip = Math.max(skip, cfg.skipFrames);
        samples.length = 0;
        windowStart = 0;
        probe = null;
        undo = null;
        blockedAbove = 0;
      }
      if (!VIEW_PHASES.has(phase) || game.contextLost || (game.loop && game.loop.timeScale !== 1)) {
        samples.length = 0;
        windowStart = 0;
        return;
      }
      if (skip > 0 || now < skipUntil) { skip--; return; }
      if (!(dt > 0) || dt > cfg.maxFrameMs) { samples.length = 0; windowStart = 0; return; }
      if (!windowStart) windowStart = now - dt;
      samples.push(dt);
      if (now - windowStart < cfg.window * 1000 || samples.length < cfg.minFrames) return;
      const span = now - windowStart;
      const f = iqm();
      samples.length = 0;
      windowStart = 0;
      evalAt = now; evalPhase = phase; evalF = f;
      evaluate(f, span, phase);
    },
  };
}
