// Regression (audit C6): a stored non-positive time-trial record must be replaced by a new positive
// finish time.
export async function setup({ page }) {
  await page.addInitScript(() => {
    localStorage.setItem('kk1:tt:meadow:120:tilki', JSON.stringify({ bestRace: 0, bestLap: 0 }));
  });
}

export default async function ({ page }) {
  const result = await page.evaluate(async () => {
    const kk = window.__kk;
    await kk.startRace({ mode: 'tt', track: 'meadow', cls: '120', character: 'tilki',
      laps: 1, seed: 7, skipIntro: true, autopilot: true });
    kk.simulate(3.5);
    const game = kk.game;
    game.race.finishNow();
    game.player.estimated = false;
    game.player.finishTime = 120;
    game.player.bestLap = 120;
    kk.simulate(game.config.STEP);
    const stored = game.storage.get('tt:meadow:120:tilki', null);
    return { phase: game.phase, bestRace: stored?.bestRace, bestLap: stored?.bestLap, ghostSaved: !!stored?.ghost,
      playerTime: game.player.finishTime };
  });
  if (result.phase !== 'results') throw new Error(`Time trial did not reach results: ${result.phase}`);
  return { live: result.bestRace !== 120 || result.bestLap !== 120 || !result.ghostSaved,
    detail: JSON.stringify(result) };
}
