// Regression (verify V2/V3): a blur or a context loss while the race is being set up had no race to
// pause, so the countdown ran with the player away. The countdown must start paused after either;
// a blur followed by a focus must not pause it.
async function gatedSetup(page, during) {
  return page.evaluate(async (during) => {
    const kk = window.__kk;
    const game = kk.game;
    const original = game.renderer.compileAsync;
    const wasRunning = game.loop.running;
    const oldAutoPause = game.autoPause;
    game.loop.stop();
    kk.setAutoPause(true);
    let release, entered, failed;
    const gate = new Promise((res) => { release = res; });
    const compiled = new Promise((res, rej) => { entered = res; failed = rej; });
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('setup did not settle in 20 s')), 20000); });
    game.renderer.compileAsync = async function (...args) {
      try { await original.apply(this, args); entered(); await gate; } catch (e) { failed(e); throw e; }
    };
    try {
      const pending = game.api.startRace({ mode: 'single', track: 'meadow', seed: 37,
        skipIntro: true, autopilot: true, cpuCount: 0 });
      pending.catch(failed);
      await Promise.race([compiled, timeout]);
      if (game.phase !== 'setup') throw new Error('compile gate no longer measures setup');
      if (during === 'blur') window.dispatchEvent(new Event('blur'));
      if (during === 'blur-focus') { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); }
      if (during === 'context') {
        const ext = game.renderer.getContext().getExtension('WEBGL_lose_context');
        if (!ext) throw new Error('WEBGL_lose_context unavailable');
        ext.loseContext();
        await new Promise((r) => setTimeout(r, 300));
        ext.restoreContext();
        await new Promise((r) => setTimeout(r, 500));
        if (game.contextLost) throw new Error('context did not restore');
      }
      release();
      await Promise.race([pending, timeout]);
      if (!game.race) throw new Error('setup completed without a race');
      const before = { phase: game.phase, paused: game.paused, raceTime: game.raceTime };
      kk.simulate(4);
      return { before, after: { phase: game.phase, paused: game.paused, raceTime: game.raceTime } };
    } finally {
      release();
      clearTimeout(timer);
      game.renderer.compileAsync = original;
      kk.setAutoPause(oldAutoPause);
      if (wasRunning) game.loop.start();
    }
  }, during);
}

export default async function ({ page }) {
  const blur = await gatedSetup(page, 'blur');
  const context = await gatedSetup(page, 'context');
  const refocus = await gatedSetup(page, 'blur-focus');
  const ran = (r) => r.after.raceTime > r.before.raceTime;
  return {
    live: ran(blur) || ran(context) || !ran(refocus) || blur.before.phase !== 'countdown',
    detail: JSON.stringify({ blur, context, refocus }),
  };
}
