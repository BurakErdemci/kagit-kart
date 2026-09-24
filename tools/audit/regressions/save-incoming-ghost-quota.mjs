// Regression (verify V1): a new time-trial record whose own ghost does not fit the quota was not
// persisted at all; its times must land without the ghost.
export default async function ({ page }) {
  const result = await page.evaluate(async () => {
    const { createStorage } = await import('/src/core/storage.js');
    if (typeof createStorage !== 'function') throw new Error('createStorage entry point missing');
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    if (!descriptor?.configurable) throw new Error('localStorage cannot be temporarily replaced');
    const key = 'tt:meadow:120:tilki';
    const fullKey = 'kk1:' + key;
    const old = { bestLap: 50, bestRace: 150 };
    const slim = { bestLap: 40, bestRace: 120 };
    const incoming = { ...slim, ghost: { hz: 20, frames: Array(1600).fill(1), checkpoints: [10, 20, 30] } };
    const records = new Map([[fullKey, JSON.stringify(old)], ['foreign-page', 'keep-me']]);
    const capacity = 2048;
    const store = {
      get length() { return records.size; },
      key(i) { return [...records.keys()][i] ?? null; },
      getItem(k) { return records.get(String(k)) ?? null; },
      removeItem(k) { records.delete(String(k)); },
      setItem(k, v) {
        k = String(k); v = String(v);
        const next = new Map(records); next.set(k, v);
        const size = [...next].reduce((n, [a, b]) => n + a.length + b.length, 0);
        if (size > capacity) throw new DOMException('finite probe quota', 'QuotaExceededError');
        records.set(k, v);
      },
    };
    store.setItem(fullKey, JSON.stringify(slim));
    store.setItem(fullKey, JSON.stringify(old));
    let rejected = false;
    try { store.setItem(fullKey, JSON.stringify(incoming)); }
    catch (e) { if (e.name !== 'QuotaExceededError') throw e; rejected = true; }
    if (!rejected) throw new Error('probe quota does not distinguish slim from full record');
    Object.defineProperty(window, 'localStorage', { configurable: true, value: store });
    try {
      const storage = createStorage();
      const saved = storage.set(key, incoming);
      const cached = storage.get(key, null);
      const durable = createStorage().get(key, null);
      if (store.getItem('foreign-page') !== 'keep-me') throw new Error('unrelated data changed');
      return { saved, cachedRace: cached?.bestRace, durable, capacity };
    } finally {
      Object.defineProperty(window, 'localStorage', descriptor);
    }
  });
  return { live: result.durable?.bestRace !== 120 || result.durable?.bestLap !== 40,
    detail: JSON.stringify(result) };
}
