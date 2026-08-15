/**
 * src/testing/mockStorage.js — a Storage stand-in for Node tests
 *
 * Implements the parts of the Web Storage API this codebase actually uses,
 * including `length` and `key(i)`, which the host storage adapter needs in
 * order to enumerate a namespace.
 *
 * Not shipped: nothing under src/ imports this outside of *.test.js.
 */

/**
 * @param {Record<string, string>} [seed] initial contents
 * @returns {Storage & { _map: Map<string, string> }}
 */
export const mockStorage = (seed = {}) => {
  const map = new Map(Object.entries(seed))
  return {
    get length() { return map.size },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    clear: () => { map.clear() },
    _map: map,
  }
}

/** A storage that rejects every write, for exercising quota/private-mode paths. */
export const failingStorage = () => ({
  get length() { return 0 },
  key: () => null,
  getItem: () => null,
  setItem: () => { throw new Error('QuotaExceededError') },
  removeItem: () => { throw new Error('QuotaExceededError') },
  clear: () => {},
})
