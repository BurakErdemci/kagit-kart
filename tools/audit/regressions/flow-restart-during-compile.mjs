// Regression (audit S2): restarting from results must not step the new race while its shaders
// compile. Compile is held open, 3.5 s of fixed steps are requested, then compile is released.
// Live when the new race's countdown moved during compile, or when setup ends in phase 'countdown'
// with the race already running (the stuck state the audit found).
export default async ({ page }) => {
  const outcome = await page.evaluate(async () => {
    const kk = window.__kk;
    const game = kk.game;
    kk.setAutoPause(false);
    await kk.startRace({ mode: 'single', track: 'meadow', seed: 23, skipIntro: true, autopilot: true });
    kk.simulate(3.5);
    kk.finishNow();
    if (game.phase !== 'results') throw new Error(`could not reach results: ${game.phase}`);

    const renderer = game.renderer;
    const original = renderer.compileAsync;
    let release;
    let entered;
    const gate = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { entered = resolve; });
    renderer.compileAsync = async function (...args) {
      const compiled = original.apply(this, args);
      entered();
      await compiled;
      await gate;
    };
    try {
      const pending = game.api.restartRace();
      await started;
      const atCompile = { phase: game.phase, raceState: game.race.state, countdown: game.race.countdown };
      kk.simulate(3.5);
      const advanced = { phase: game.phase, raceState: game.race.state, countdown: game.race.countdown };
      release();
      await pending;
      const settled = { phase: game.phase, raceState: game.race.state, countdown: game.race.countdown };
      kk.simulate(1);
      return { atCompile, advanced, settled, afterStep: game.phase };
    } finally {
      release();
      renderer.compileAsync = original;
    }
  });
  const steppedDuringCompile = outcome.advanced.raceState !== outcome.atCompile.raceState
    || outcome.advanced.countdown !== outcome.atCompile.countdown;
  const stuck = outcome.settled.phase === 'countdown' && outcome.settled.raceState !== 'countdown' && outcome.afterStep === 'countdown';
  return {
    live: steppedDuringCompile || stuck,
    detail: `at compile ${JSON.stringify(outcome.atCompile)}; after 3.5 s of steps ${JSON.stringify(outcome.advanced)}; `
      + `after setup ${JSON.stringify(outcome.settled)}; after 1 s ${outcome.afterStep}`,
  };
};
