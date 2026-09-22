// Synchronous event bus. `on` returns `off`. A tap (not counted as a listener) feeds the test log.
// emit never copies the listener list: an `off` during an emit nulls the slot, and the list is
// compacted once the outermost emit returns. Handlers added during an emit run from the next emit.

export function createEvents() {
  const map = new Map();
  const taps = [];
  let depth = 0;
  const dirty = new Set();

  function on(name, fn) {
    let list = map.get(name);
    if (!list) { list = []; map.set(name, list); }
    list.push(fn);
    let done = false;
    return function off() {
      if (done) return;
      done = true;
      const l = map.get(name);
      if (!l) return;
      const i = l.indexOf(fn);
      if (i < 0) return;
      if (depth > 0) { l[i] = null; dirty.add(l); }
      else l.splice(i, 1);
    };
  }

  function compact() {
    for (const l of dirty) {
      let w = 0;
      for (let r = 0; r < l.length; r++) if (l[r] !== null) l[w++] = l[r];
      l.length = w;
    }
    dirty.clear();
  }

  function emit(name, payload = {}) {
    for (let i = 0; i < taps.length; i++) taps[i](name, payload);
    const list = map.get(name);
    if (!list || list.length === 0) return;
    const n = list.length;
    depth++;
    try {
      for (let i = 0; i < n; i++) {
        const fn = list[i];
        if (fn === null) continue;
        try { fn(payload); } catch (err) { console.error(`[events] handler for "${name}" threw`, err); }
      }
    } finally {
      depth--;
      if (depth === 0 && dirty.size) compact();
    }
  }

  function live(l) {
    let n = 0;
    for (let i = 0; i < l.length; i++) if (l[i] !== null) n++;
    return n;
  }

  function count(name) {
    if (name) { const l = map.get(name); return l ? live(l) : 0; }
    let n = 0;
    for (const l of map.values()) n += live(l);
    return n;
  }

  function counts() {
    const out = {};
    for (const [k, l] of map) { const c = live(l); if (c) out[k] = c; }
    return out;
  }

  function tap(fn) {
    taps.push(fn);
    return () => { const i = taps.indexOf(fn); if (i >= 0) taps.splice(i, 1); };
  }

  return { on, emit, count, counts, tap };
}
