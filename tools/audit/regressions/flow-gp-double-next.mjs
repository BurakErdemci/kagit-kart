// Regression (audit S1): one double-click on the GP standings "Sonraki bölüm" button must advance
// gp.index by at most one chapter. Both clicks are dispatched in one task, before any frame runs.
export default async ({ page }) => {
  await page.evaluate(async () => {
    const kk = window.__kk;
    kk.setAutoPause(false);
    await kk.startGP({ seed: 17 });
    kk.simulate(3.5);
    kk.finishNow();
  });
  await page.waitForSelector('.kk-board .kk-actions button');
  await page.locator('.kk-board .kk-actions button').first().click();
  await page.waitForSelector('.kk-std .kk-actions button');
  const outcome = await page.evaluate(() => {
    const game = window.__kk.game;
    if (game.phase !== 'results' || game.gp.index !== 0) {
      throw new Error(`expected first GP standings, got ${game.phase}/${game.gp.index}`);
    }
    const button = document.querySelector('.kk-std .kk-actions button');
    if (!button) throw new Error('next chapter button missing');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    const afterFirst = game.gp.index;
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    return { afterFirst, afterSecond: game.gp.index, track: game.selection.trackId };
  });
  return {
    live: outcome.afterSecond > 1,
    detail: `one double-click: GP index ${outcome.afterFirst} -> ${outcome.afterSecond}, selected track ${outcome.track}`,
  };
};
