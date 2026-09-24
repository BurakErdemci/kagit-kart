// Regression (audit C7): a throw after the renderer exists must not leave the loading card hidden
// under the canvas with the game never ready. Two page loads:
//   A. no ResizeObserver (the audit's case): the game boots, or shows a failure card on top;
//   B. a forced throw late in boot (window hook install): a "başlatılamadı" card shows on top.
export const options = { boot: false };

export async function setup({ page }) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('kk-probe-variant') === 'throw') {
      const add = window.addEventListener;
      window.addEventListener = function (type, ...rest) {
        if (type === 'gamepaddisconnected') throw new Error('probe: late boot throw');
        return add.call(this, type, ...rest);
      };
    } else {
      Object.defineProperty(window, 'ResizeObserver', { value: undefined, configurable: true });
    }
  });
}

function readCard(page) {
  return page.evaluate(() => {
    const card = document.getElementById('kk-boot');
    let onTop = false;
    if (card) {
      const r = card.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      onTop = !!hit && card.contains(hit);
    }
    return {
      ready: window.__kk?.ready === true,
      card: card?.textContent?.trim() ?? null,
      onTop,
      canvas: !!document.querySelector('#kk-root canvas'),
    };
  });
}

export default async function ({ page, errors, sleep }) {
  await sleep(1600);
  const a = await readCard(page);
  const aFailureShown = /başlatılamadı|yüklenemedi/i.test(a.card ?? '') && a.onTop;
  const liveA = !a.ready && !aFailureShown;

  await page.evaluate(() => sessionStorage.setItem('kk-probe-variant', 'throw'));
  await page.reload();
  await sleep(1600);
  const b = await readCard(page);
  await page.evaluate(() => sessionStorage.removeItem('kk-probe-variant'));
  if (b.ready) throw new Error('variant B: the injected late throw did not stop boot');
  const liveB = !(/başlatılamadı/i.test(b.card ?? '') && b.onTop);

  return {
    live: liveA || liveB,
    detail: JSON.stringify({ noResizeObserver: a, lateThrow: b, errors: errors.slice(0, 3) }),
  };
}
