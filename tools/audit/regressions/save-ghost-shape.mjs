// Regression (audit C3): a stored time-trial ghost without checkpoints must not crash the first split;
// a well-formed stored ghost must still replay and split.
export async function setup({ page }) {
  await page.addInitScript(() => {
    localStorage.setItem('kk1:tt:meadow:120:tilki', JSON.stringify({
      bestRace: 120,
      ghost: { hz: 20, frames: [0, 0, 0, 0, 1, 0, 1, 0] },
    }));
    localStorage.setItem('kk1:tt:meadow:120:kedi', JSON.stringify({
      bestLap: 118, bestRace: 118,
      ghost: { hz: 20, frames: [0, 0, 0, 0, 1, 0, 1, 0], checkpoints: [10, 20, 30], total: 118, lapTimes: [118] },
    }));
  });
}

export default async function ({ page }) {
  const result = await page.evaluate(async () => {
    const kk = window.__kk;
    const run = async (character) => {
      await kk.startRace({ mode: 'tt', track: 'meadow', cls: '120', character,
        laps: 1, seed: 7, skipIntro: true, autopilot: true });
      const ghost = kk.game.ghost;
      if (!ghost) return { ghostAccepted: false, threw: false };
      try { return { ghostAccepted: true, split: ghost.splitAt(0, 12), threw: false }; }
      catch (error) { return { ghostAccepted: true, threw: true, error: String(error) }; }
    };
    return { malformed: await run('tilki'), valid: await run('kedi') };
  });
  const validBroken = !result.valid.ghostAccepted || result.valid.threw || result.valid.split !== 2;
  return { live: result.malformed.threw || validBroken, detail: JSON.stringify(result) };
}
