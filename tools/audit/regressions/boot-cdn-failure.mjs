// Regression (audit C1): when the three.js CDN is unreachable the boot card must switch from the
// loading text to a visible failure message.
export const options = { boot: false };

export async function setup({ page }) {
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort('failed'));
}

export default async function ({ page, errors, sleep }) {
  await sleep(1800);
  const state = await page.evaluate(() => {
    const card = document.getElementById('kk-boot');
    let onTop = false;
    if (card) {
      const r = card.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      onTop = !!hit && card.contains(hit);
    }
    return { ready: window.__kk?.ready === true, card: card?.textContent?.trim() ?? null, onTop };
  });
  const failureShown = /yüklenemedi/i.test(state.card ?? '') && state.onTop;
  return { live: !state.ready && !failureShown, detail: JSON.stringify({ ...state, errors: errors.slice(0, 3) }) };
}
