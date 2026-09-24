// Regression (audit S1, real input): a real mouse double-click on the GP standings "Sonraki bölüm"
// button, with real compile timing, must advance gp.index by one chapter only.
export default async ({ page, sleep }) => {
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
  await sleep(600);
  const before = await page.evaluate(() => window.__kk.game.gp.index);
  const box = await page.locator('.kk-std .kk-actions button').first().boundingBox();
  const t0 = Date.now();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  // Watch the phase until the next race reaches its countdown or race, sampling the race countdown.
  const samples = [];
  for (let i = 0; i < 80; i++) {
    const s = await page.evaluate(() => {
      const g = window.__kk.game;
      return { phase: g.phase, index: g.gp.index, cd: g.race ? +(g.race.countdown ?? -1).toFixed(2) : null, state: g.race?.state };
    });
    samples.push({ ms: Date.now() - t0, ...s });
    if (s.phase === 'countdown' || s.phase === 'race') break;
    await sleep(100);
  }
  const firstCountdown = samples.find((s) => s.phase === 'countdown' || s.phase === 'race');
  const after = await page.evaluate(() => window.__kk.game.gp.index);
  return {
    live: after - before > 1,
    detail: `real dblclick: gp.index ${before} -> ${after}; setup-to-countdown ${firstCountdown?.ms ?? '?'} ms; `
      + `countdown value when phase became countdown: ${firstCountdown?.cd}; race state then: ${firstCountdown?.state}`,
  };
};
