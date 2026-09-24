// JSON storage with the `kk1:` prefix. Every access is guarded: localStorage can throw on lookup
// (sandboxed frames, blocked site data), so an in-memory map backs every value.

const PREFIX = 'kk1:';
const TT_PREFIX = PREFIX + 'tt:';

function isQuotaError(e) {
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
}

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

  // Full storage is in practice accumulated time-trial ghosts (tens of KB each, one per track/class/
  // character). They are the most expendable data: strip their ghost payloads, largest first, keeping
  // bestLap/bestRace, until the space freed covers what the write adds, then retry it.
  function writeAfterStrippingGhosts(store, k, json) {
    const entries = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key === k || !key || !key.startsWith(TT_PREFIX)) continue;
      const raw = store.getItem(key);
      if (raw && raw.includes('"ghost"')) entries.push({ key, raw });
    }
    entries.sort((a, b) => b.raw.length - a.raw.length);
    const old = store.getItem(k);
    // Quota counts key + value characters.
    let need = old == null ? k.length + json.length : json.length - old.length;
    for (const { key, raw } of entries) {
      let rec;
      try { rec = JSON.parse(raw); } catch { continue; }
      if (!rec || typeof rec !== 'object' || !('ghost' in rec)) continue;
      delete rec.ghost;
      const slim = JSON.stringify(rec);
      try { store.setItem(key, slim); } catch { continue; }
      if (memory.has(key)) memory.set(key, rec);
      need -= raw.length - slim.length;
      if (need <= 0) {
        try { store.setItem(k, json); return true; } catch { /* quota counted differently: strip more */ }
      }
    }
    try { store.setItem(k, json); return true; } catch { /* the write's own ghost is too big */ }
    // A new time-trial record whose own ghost does not fit still keeps its times.
    if (!k.startsWith(TT_PREFIX)) return false;
    try {
      const rec = JSON.parse(json);
      if (!rec || typeof rec !== 'object' || !('ghost' in rec)) return false;
      delete rec.ghost;
      store.setItem(k, JSON.stringify(rec));
      return true;
    } catch {
      return false;
    }
  }

  function set(key, value) {
    const k = PREFIX + key;
    memory.set(k, value);
    try {
      const store = ls();
      if (!store) return true;
      const json = JSON.stringify(value);
      try {
        store.setItem(k, json);
        return true;
      } catch (e) {
        if (!isQuotaError(e)) return false;
      }
      return writeAfterStrippingGhosts(store, k, json);
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
