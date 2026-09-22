export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed = (Math.random() * 2 ** 32) >>> 0) {
  const next = mulberry32(seed);
  const rng = {
    seed: seed >>> 0,
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)), // inclusive
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
    weighted(table) { // { key: weight }
      let total = 0;
      for (const k in table) total += table[k];
      let r = next() * total;
      for (const k in table) { r -= table[k]; if (r < 0) return k; }
      return Object.keys(table)[0];
    },
    fork: (name) => createRng((hashString(String(name)) ^ Math.imul(seed >>> 0, 2654435761)) >>> 0),
  };
  return rng;
}
