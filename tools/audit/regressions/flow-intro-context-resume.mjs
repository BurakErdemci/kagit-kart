// Regression (verify round 3): a context loss in the intro pauses at once; after restore and Resume the
// countdown must not pause the same race a second time.
import fs from 'node:fs';
import path from 'node:path';

export async function setup({ root }) {
  for (const file of ['src/main.js', 'src/test/testApi.js']) {
    if (!root || !fs.existsSync(path.join(root, file))) {
      throw new Error(`probe invalid: cannot locate ${file} under root '${root}'`);
    }
  }
}

export default async function ({ page }) {
  const result = await page.evaluate(async () => {
    const kk = window.__kk;
    const g = kk?.game;
    if (!g?.api?.startRace || !g.api.setPaused || !g.api.skipCinematic || !g.events?.on) {
      throw new Error('probe invalid: race, pause, skip or event API missing');
    }
    if (document.hidden) throw new Error('probe invalid: foreground page required');
    const running = g.loop.running;
    const autoPause = g.autoPause;
    const canvas = g.renderer.domElement;
    g.loop.stop();
    kk.setAutoPause(false);
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('probe invalid: intro/setup did not settle in 20 s')), 20000);
    });
    let entered;
    const intro = new Promise((resolve) => { entered = resolve; });
    const off = g.events.on('phase', ({ to }) => { if (to === 'intro') entered(); });
    let pending;
    try {
      pending = g.api.startRace({ track: 'meadow', mode: 'single', seed: 73,
        skipIntro: false, autopilot: true, cpuCount: 0 });
      await Promise.race([
        intro,
        pending.then(() => { throw new Error('probe invalid: setup completed before intro was observed'); }),
        deadline,
      ]);
      if (g.phase !== 'intro' || g.systems.cinematics.shot !== 'intro') {
        throw new Error('probe invalid: real pending intro not reached');
      }
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      if (!g.contextLost) throw new Error('probe invalid: context loss event did not reach game');
      const pausedOnLoss = g.paused;
      canvas.dispatchEvent(new Event('webglcontextrestored'));
      if (g.contextLost) throw new Error('probe invalid: context restoration event did not reach game');
      g.api.setPaused(false);
      if (g.paused) throw new Error('probe invalid: public Resume did not unpause intro');
      g.api.skipCinematic();
      await Promise.race([pending, deadline]);
      if (g.phase !== 'countdown' || !g.race) throw new Error('probe invalid: countdown not reached');
      const before = kk.state();
      kk.simulate(4);
      const after = kk.state();
      const repeatedPause = before.paused && after.raceTime === before.raceTime;
      g.api.setPaused(false);
      kk.simulate(4);
      const resumed = kk.state();
      if (!(resumed.raceTime > after.raceTime)) {
        throw new Error('probe invalid: simulation cannot advance even after another Resume');
      }
      return { pausedOnLoss, repeatedPause,
        before: { phase: before.phase, paused: before.paused, raceTime: before.raceTime },
        after: { phase: after.phase, paused: after.paused, raceTime: after.raceTime },
        resumed: { phase: resumed.phase, paused: resumed.paused, raceTime: resumed.raceTime } };
    } finally {
      clearTimeout(timer);
      off();
      if (g.contextLost) canvas.dispatchEvent(new Event('webglcontextrestored'));
      g.api.quitToTitle();
      kk.setAutoPause(autoPause);
      if (running) g.loop.start();
    }
  });
  return { live: result.repeatedPause, detail: JSON.stringify(result) };
}
