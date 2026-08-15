/**
 * src/storage/backends/localStorage.js — bytes for the save store
 *
 * The save store owns the FORMAT (versioning, migration, export codes). This
 * owns the BYTES, behind an async interface so the two can be separated:
 *
 *   read(key)   → Promise<string|null>
 *   write(key, value) → Promise<void>
 *   remove(key) → Promise<void>
 *
 * An IndexedDB or HTTP backend implements the same three methods and drops in
 * with no change to the store above it. That is the whole point of the split —
 * localStorage is synchronous, capped around 5MB, and blocks the main thread on
 * every write, and this game rewrites its whole envelope on each wave clear.
 *
 * ── writeSync, and why it is not a design failure ───────────────────────────
 * There is one thing an async backend genuinely cannot do: finish a write
 * during `pagehide`. The browser may tear the page down before a promise
 * resolves, so an async-only save path loses the last checkpoint every time a
 * player closes the tab — a real regression in a save system, not a
 * theoretical one.
 *
 * So `writeSync` is an OPTIONAL capability. Backends that can honour it (this
 * one) expose it and the unload path uses it. Backends that cannot (network,
 * IndexedDB) simply omit it, and callers fall back to a best-effort async
 * write plus more frequent checkpoints. Callers must feature-detect, never
 * assume.
 */

/**
 * @param {{ storage?: Storage }} [opts]
 */
export const createLocalStorageBackend = ({ storage = globalThis.localStorage } = {}) => ({
  /** Present so callers can feature-detect the unload path. */
  canWriteSync: true,

  async read(key) {
    try {
      return storage?.getItem(key) ?? null
    } catch (_) {
      // Disabled or partitioned storage. Reads as empty rather than throwing:
      // a player with cookies off should still get a playable (if amnesiac)
      // session instead of a boot failure.
      return null
    }
  },

  async write(key, value) {
    this.writeSync(key, value)
  },

  async remove(key) {
    try {
      storage?.removeItem(key)
    } catch (_) { /* already unreachable */ }
  },

  /**
   * Synchronous read, for the unload path only. Paired with writeSync because
   * a read-modify-write needs both halves synchronous to be of any use there.
   */
  readSync(key) {
    try {
      return storage?.getItem(key) ?? null
    } catch (_) {
      return null
    }
  },

  /**
   * Synchronous write, for `pagehide` only. Throws on quota so the caller can
   * tell the player their save did not stick.
   */
  writeSync(key, value) {
    try {
      storage?.setItem(key, String(value))
    } catch (err) {
      throw new Error(`could not write '${key}': ${err.message}`)
    }
  },
})

/**
 * An in-memory backend. Used by tests, and as the fallback when a browser
 * denies storage entirely — the session works, it just does not survive.
 */
export const createMemoryBackend = (seed = {}) => {
  const map = new Map(Object.entries(seed))
  return {
    canWriteSync: true,
    async read(key) { return map.has(key) ? map.get(key) : null },
    async write(key, value) { map.set(key, String(value)) },
    async remove(key) { map.delete(key) },
    readSync(key) { return map.has(key) ? map.get(key) : null },
    writeSync(key, value) { map.set(key, String(value)) },
    _map: map,
  }
}
