// JSON storage with the `kk1:` prefix. Every access is guarded: localStorage can throw on lookup
// (sandboxed frames, blocked site data), so an in-memory map backs every value.

const PREFIX = 'kk1:';

export function createStorage() {
  const memory = new Map();

  function ls() {
    try { return window.localStorage || null; } catch { return null; }
  }

  function get(key, fallback) {
    const k = PREFIX + key;
    if (memory.has(k)) return memory.get(k);
    try {
      const store = ls();
      const raw = store ? store.getItem(k) : null;
      if (raw == null) return fallback;
      const v = JSON.parse(raw);
      memory.set(k, v);
      return v;
    } catch {
      return fallback;
    }
  }

  function set(key, value) {
    const k = PREFIX + key;
    memory.set(k, value);
    try {
      const store = ls();
      if (store) store.setItem(k, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function remove(key) {
    const k = PREFIX + key;
    memory.delete(k);
    try { ls()?.removeItem(k); } catch { /* ignored: memory copy already gone */ }
  }

  return { get, set, remove };
}
