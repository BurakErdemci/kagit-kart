// Fixed-step accumulator loop. Time comes from performance.now() (THREE.Clock is deprecated in r186).

export function createLoop({ step, maxFrameDt, maxSteps, shouldStep, onStep, onFrame }) {
  const loop = {
    timeScale: 1,
    accumulator: 0,
    alpha: 0,
    running: false,
    lastNow: 0,
    frameDt: 0,
    stepsLastFrame: 0,
    rafId: 0,

    start() {
      if (loop.running) return;
      loop.running = true;
      loop.lastNow = performance.now();
      loop.rafId = requestAnimationFrame(tick);
    },

    stop() {
      loop.running = false;
      cancelAnimationFrame(loop.rafId);
    },

    // Synchronous stepping for tests; returns steps run.
    runSteps(n) {
      let done = 0;
      for (let i = 0; i < n; i++) {
        if (!shouldStep()) break;
        onStep(step);
        done++;
      }
      return done;
    },
  };

  function tick(now) {
    if (!loop.running) return;
    loop.rafId = requestAnimationFrame(tick);
    let dt = (now - loop.lastNow) / 1000;
    loop.lastNow = now;
    if (!(dt > 0)) dt = 0;
    if (dt > maxFrameDt) dt = maxFrameDt;
    loop.frameDt = dt;

    let steps = 0;
    if (shouldStep()) {
      loop.accumulator += dt * loop.timeScale;
      const cap = Math.max(1, Math.round(maxSteps * loop.timeScale));
      while (loop.accumulator >= step && steps < cap) {
        onStep(step);
        loop.accumulator -= step;
        steps++;
        if (!shouldStep()) { loop.accumulator = 0; break; }
      }
      // Drop the backlog instead of spiralling.
      if (loop.accumulator > step) loop.accumulator = step * 0.999;
    } else {
      loop.accumulator = 0;
    }
    loop.stepsLastFrame = steps;
    loop.alpha = shouldStep() ? loop.accumulator / step : 1;
    onFrame(dt, loop.alpha, now);
  }

  return loop;
}
