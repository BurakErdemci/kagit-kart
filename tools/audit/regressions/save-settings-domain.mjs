// Regression (audit C5): stored settings outside their domain fall back to the default, so the
// settings screen shows what the game does. The audit's case is quality 'ultra' shown as
// "Otomatik" while auto-drop stays off; the other fields cover the same reader.
export async function setup({ page }) {
  await page.addInitScript(() => {
    localStorage.setItem('kk1:settings', JSON.stringify({
      quality: 'ultra', muted: 'false', musicVolume: 7, sfxVolume: 'loud', reducedMotion: true, bogus: 1,
    }));
  });
}

export default async function ({ page, sleep }) {
  await page.evaluate(() => window.__kk.game.api.setMenuScreen('settings'));
  await sleep(250);
  const result = await page.evaluate(() => {
    const game = window.__kk.game;
    const row = [...document.querySelectorAll('.kk-srow')]
      .find((el) => el.textContent?.includes('Görüntü'));
    const s = game.settings;
    return { stored: s.quality, active: game.quality, autoFlag: game.qualityAuto,
      selected: row?.querySelector('.kk-opt.is-on')?.textContent?.trim() ?? null,
      muted: s.muted, musicVolume: s.musicVolume, sfxVolume: s.sfxVolume, reducedMotion: s.reducedMotion,
      bogus: 'bogus' in s };
  });
  if (!result.selected) throw new Error('Quality setting row not found');
  const shownMismatch = result.stored === 'ultra' && result.selected.includes('Otomatik');
  const outOfDomain = result.stored !== 'auto' || result.muted !== false || result.musicVolume !== 1
    || result.sfxVolume !== 0.9 || result.reducedMotion !== 'auto' || result.bogus;
  return { live: shownMismatch || outOfDomain, detail: JSON.stringify(result) };
}
