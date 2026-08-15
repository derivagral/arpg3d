/**
 * src/storage/backends/indexedDb.js — the durable local backend
 *
 * Same three methods as the localStorage backend, over IndexedDB. Worth having
 * for two concrete reasons:
 *
 *   - Capacity. localStorage is capped around 5MB per origin, and this game
 *     rewrites its whole envelope on every wave clear. A stash full of items
 *     across several character slots gets there. IndexedDB's budget is orders
 *     of magnitude larger.
 *   - It does not block the main thread. localStorage writes are synchronous
 *     and land in the middle of a frame.
 *
 * ── It cannot flush on unload, and that is the trade ────────────────────────
 * There is no `writeSync` here, and `canWriteSync` is false. IndexedDB has no
 * synchronous API at all, so a write started in `pagehide` may simply never
 * complete. Callers feature-detect and fall back to best-effort — which is why
 * that capability was made optional rather than assumed.
 *
 * The practical consequence: on this backend, the last few seconds before a
 * tab close can be lost. Mitigate with checkpoints (the game already saves on
 * wave clear and death), not by pretending the write landed. If that matters
 * more than capacity, stay on localStorage — the choice is one line in the
 * shell.
 *
 * ── Migration ───────────────────────────────────────────────────────────────
 * `migrateBackend` copies keys across so switching does not strand existing
 * saves. It copies rather than moves, leaving the old data as a backup, on the
 * same reasoning as the guest-save claim flow.
 */

export const DB_NAME = 'arpg3d.shell'
export const STORE_NAME = 'kv'
export const DB_VERSION = 1

/** Promisify an IDBRequest. */
const promisify = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
})

/**
 * True when IndexedDB is usable here. It is absent in some Workers' contexts,
 * disabled in certain privacy modes, and throws on access in sandboxed frames
 * — so this is a probe, not a property read.
 * @returns {boolean}
 */
export const indexedDbAvailable = () => {
  try {
    return typeof globalThis.indexedDB === 'object' && globalThis.indexedDB !== null
  } catch (_) {
    return false
  }
}

/**
 * @param {{ dbName?: string, storeName?: string, idb?: IDBFactory }} [opts]
 */
export const createIndexedDbBackend = ({
  dbName = DB_NAME,
  storeName = STORE_NAME,
  idb = globalThis.indexedDB,
} = {}) => {
  if (!idb) throw new Error('IndexedDB is not available in this context')

  // Opened once and reused. Held as a promise so concurrent first calls share
  // one open rather than racing several.
  let dbPromise = null

  const open = () => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = idb.open(dbName, DB_VERSION)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName)
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('could not open IndexedDB'))
        request.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'))
      }).catch((err) => {
        dbPromise = null      // let a later call retry rather than latch failure
        throw err
      })
    }
    return dbPromise
  }

  const withStore = async (mode, fn) => {
    const db = await open()
    const tx = db.transaction(storeName, mode)
    const result = fn(tx.objectStore(storeName))
    // Await the transaction, not just the request: on a write, the request can
    // succeed and the transaction still abort (quota, for instance), and the
    // caller needs to hear about that.
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    })
    return result
  }

  return {
    // No synchronous path exists in IndexedDB. See the header.
    canWriteSync: false,

    /** @returns {Promise<string|null>} */
    async read(key) {
      try {
        const db = await open()
        const tx = db.transaction(storeName, 'readonly')
        const value = await promisify(tx.objectStore(storeName).get(key))
        return value ?? null
      } catch (err) {
        console.warn(`[storage:idb] read '${key}' failed:`, err)
        return null
      }
    },

    /** @returns {Promise<void>} */
    async write(key, value) {
      let request
      await withStore('readwrite', (store) => { request = store.put(String(value), key) })
      // Surface a request-level failure that did not abort the transaction.
      if (request?.error) throw request.error
    },

    /** @returns {Promise<void>} */
    async remove(key) {
      await withStore('readwrite', (store) => store.delete(key))
    },

    /** @returns {Promise<string[]>} every key held. Used by migration. */
    async keys() {
      try {
        const db = await open()
        const tx = db.transaction(storeName, 'readonly')
        return await promisify(tx.objectStore(storeName).getAllKeys())
      } catch (_) {
        return []
      }
    },

    /** Release the handle. Mostly for tests. */
    async close() {
      if (!dbPromise) return
      try { (await dbPromise).close() } catch (_) { /* already closed */ }
      dbPromise = null
    },
  }
}

/**
 * Copy every key matching `prefix` from one backend to another, skipping any
 * the target already holds.
 *
 * Copies rather than moves: the source is left intact as a backup, so a failed
 * or half-finished switch never costs a save. Same reasoning as the guest-save
 * claim flow.
 *
 * @param {{ from: object, to: object, keys: string[] }} args
 *   `keys` is explicit because the localStorage backend cannot enumerate
 *   itself through the three-method interface — the caller knows which keys
 *   matter.
 * @returns {Promise<{ copied: string[], skipped: string[] }>}
 */
export const migrateBackend = async ({ from, to, keys }) => {
  const copied = []
  const skipped = []
  for (const key of keys) {
    const existing = await to.read(key)
    if (existing != null) { skipped.push(key); continue }
    const value = await from.read(key)
    if (value == null) { skipped.push(key); continue }
    await to.write(key, value)
    copied.push(key)
  }
  return { copied, skipped }
}
