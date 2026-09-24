// Regression (audit C2): while the WebGL context is lost the race clock stops and the game is
// paused; after a restore it stays paused, and resuming runs the race again.
export default async function ({ page, errors, sleep }) {
  await page.evaluate(async () => {
    const kk = window.__kk;
    await kk.startRace({ mode: 'single', track: 'meadow', laps: 1, seed: 7,
      skipIntro: true, autopilot: true, cpuCount: 0 });
    kk.simulate(3.5);
  });
  const before = await page.evaluate(() => {
    const game = window.__kk.game;
    const gl = game.renderer.getContext();
    const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) throw new Error('WEBGL_lose_context unavailable');
    // getExtension returns null once the context is lost, so keep the handle for the restore.
    window.__probeLoseContext = ext;
    ext.loseContext();
    return { raceTime: game.raceTime, phase: game.phase, paused: game.paused };
  });
  await sleep(1500);
  const lost = await page.evaluate(() => {
    const game = window.__kk.game;
    return { raceTime: game.raceTime, phase: game.phase, paused: game.paused,
      contextLost: game.renderer.getContext().isContextLost() };
  });
  if (!lost.contextLost) throw new Error('WebGL context did not enter lost state');
  // The lost event arrives a task after loseContext(), so a frame or two may still step: allow 0.2 s
  // (a running clock gains ~1.5 s here).
  const clockRan = lost.raceTime > before.raceTime + 0.2;

  const errorsBeforeRestore = errors.length;
  await page.evaluate(() => window.__probeLoseContext.restoreContext());
  await sleep(800);
  const restored = await page.evaluate(() => {
    const game = window.__kk.game;
    return { contextLost: game.renderer.getContext().isContextLost(), paused: game.paused, raceTime: game.raceTime };
  });
  await page.evaluate(() => window.__kk.game.api.setPaused(false));
  await sleep(1000);
  const resumed = await page.evaluate(() => {
    const game = window.__kk.game;
    return { paused: game.paused, raceTime: game.raceTime, drawCalls: window.__kk.perf().drawCalls };
  });
  const newErrors = errors.slice(errorsBeforeRestore);
  const restoreBroken = restored.contextLost || !restored.paused || !(resumed.raceTime > restored.raceTime + 0.3)
    || newErrors.length > 0;
  return {
    live: clockRan || !lost.paused || restoreBroken,
    detail: JSON.stringify({ before, lost, restored, resumed, newErrors: newErrors.slice(0, 3) }),
  };
}
