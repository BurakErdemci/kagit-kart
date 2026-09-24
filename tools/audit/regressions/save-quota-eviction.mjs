// Regression (audit C4, rewritten): with localStorage filled by time-trial ghosts, a settings change
// must still persist across a reload, and the records whose ghosts made room keep their times.
// Storage is filled for real (big synthetic kk1:tt:* ghosts, then ever smaller ones and small pads)
// until even a small write throws; the probe's origin (random port) is cleared at the end.
const FILL_LAP = 40.5;
const FILL_RACE = 130.25;

export default async function ({ page }) {
  const filled = await page.evaluate(({ lap, race }) => {
    const ls = window.localStorage;
    const frames = [];
    for (let i = 0; i < 40000; i++) frames.push(((i * 7919) % 100000) / 100);
    let ghosts = 0;
    let len = frames.length;
    while (len >= 4) {
      const rec = JSON.stringify({ bestLap: lap, bestRace: race,
        ghost: { hz: 20, frames: frames.slice(0, len), checkpoints: [10, 20, 30], total: race, lapTimes: [lap, 44, 45.75] } });
      try { ls.setItem(`kk1:tt:fill${ghosts}:120:tilki`, rec); ghosts++; }
      catch (e) { if (e.name !== 'QuotaExceededError') throw e; len = Math.floor(len / 8) * 4; }
    }
    let pads = 0;
    for (let size = 64; size >= 1; size = Math.floor(size / 2)) {
      for (;;) {
        try { ls.setItem(`kk1:tt:pad${pads}`, JSON.stringify('x'.repeat(size))); pads++; }
        catch (e) { if (e.name !== 'QuotaExceededError') throw e; break; }
      }
    }
    let full = false;
    try { ls.setItem('kk1:probe-canary', 'x'.repeat(40)); ls.removeItem('kk1:probe-canary'); }
    catch { full = true; }
    return { ghosts, pads, full };
  }, { lap: FILL_LAP, race: FILL_RACE });
  if (!filled.full || filled.ghosts < 2) {
    await page.evaluate(() => localStorage.clear());
    throw new Error(`could not fill storage: ${JSON.stringify(filled)}`);
  }

  const before = await page.evaluate(() => {
    const game = window.__kk.game;
    game.api.setSetting('showFps', true);
    return { current: game.settings.showFps };
  });
  await page.reload();
  await page.waitForFunction(() => window.__kk?.ready === true, null, { timeout: 30000 });
  const after = await page.evaluate(({ lap, race }) => {
    const ls = window.localStorage;
    let stripped = 0;
    let timesLost = 0;
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (!key.startsWith('kk1:tt:fill')) continue;
      const rec = JSON.parse(ls.getItem(key));
      if (!rec.ghost) stripped++;
      if (rec.bestLap !== lap || rec.bestRace !== race) timesLost++;
    }
    const out = { showFps: window.__kk.game.settings.showFps, stripped, timesLost };
    ls.clear();
    return out;
  }, { lap: FILL_LAP, race: FILL_RACE });
  return {
    live: after.showFps !== true || after.timesLost > 0,
    detail: JSON.stringify({ filled, before, after }),
  };
}
