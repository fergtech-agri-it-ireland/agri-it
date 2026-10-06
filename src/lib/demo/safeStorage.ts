/**
 * Some hosts (private windows, blocked site data, thumbnail capture) throw on
 * any access to web storage. The app reads storage at start-up, so in that case
 * swap in an in-memory Storage before anything else runs.
 */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); }
  };
}
for (const name of ['localStorage', 'sessionStorage'] as const) {
  try {
    const s = window[name];
    const probe = '__agri_it_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
  } catch {
    try { Object.defineProperty(window, name, { value: memoryStorage(), configurable: true }); } catch { /* nothing more to do */ }
  }
}
export {};
