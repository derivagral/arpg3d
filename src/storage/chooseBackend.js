/**
 * src/storage/chooseBackend.js — which backend the shell runs on
 *
 * The choice is a genuine trade, not an upgrade, which is why it is a single
 * explicit switch rather than "use the best available":
 *
 *   localStorage  — can flush synchronously on `pagehide`, so the last
 *                   checkpoint survives a tab close. Capped around 5MB, and
 *                   every write blocks the main thread.
 *
 *   indexeddb     — far larger budget, never blocks the main thread, and
 *                   works in a Worker. CANNOT flush on unload: IndexedDB has
 *                   no synchronous API, so a write started in `pagehide` may
 *                   never land, and the last few seconds before a tab close
 *                   can be lost.
 *
 * ARPG3D checkpoints on wave clear and on death, so the exposure on IndexedDB
 * is bounded — but it is real, and it is why localStorage remains the default
 * until save sizes actually demand otherwise.
 *
 * Switching is safe in both directions: saves are COPIED to the new backend,
 * never moved, so the old ones remain as a backup and switching back loses
 * nothing.
 */

import { createLocalStorageBackend } from './backends/localStorage.js'
import { createIndexedDbBackend, indexedDbAvailable, migrateBackend } from './backends/indexedDb.js'
import { STORAGE_KEY, ADOPTED_KEY, storageKeyFor } from './saveStore.js'
import { CLAIM_KEY } from './claim.js'

/** Set at build/boot. 'local' | 'indexeddb'. */
export const DEFAULT_BACKEND = 'local'

/** Everything the shell keeps for one player, for migration between backends. */
export const shellKeysFor = (subject) => [
  STORAGE_KEY,
  ADOPTED_KEY,
  CLAIM_KEY,
  storageKeyFor(subject),
]

/**
 * @param {{ kind?: string, storage?: Storage, subject?: string|null }} [opts]
 * @returns {Promise<{ backend: object, kind: string, migrated: string[] }>}
 */
export const chooseBackend = async ({
  kind = DEFAULT_BACKEND,
  storage = globalThis.localStorage,
  subject = null,
} = {}) => {
  const local = createLocalStorageBackend({ storage })

  if (kind !== 'indexeddb') return { backend: local, kind: 'local', migrated: [] }

  if (!indexedDbAvailable()) {
    // Private mode, a sandboxed frame, or a context without IDB. Falling back
    // is correct — the player keeps playing — but say so, because their saves
    // are now subject to the 5MB cap they were trying to escape.
    console.warn('[storage] IndexedDB unavailable — falling back to localStorage')
    return { backend: local, kind: 'local', migrated: [] }
  }

  try {
    const idb = createIndexedDbBackend()
    // Copy anything already on localStorage so switching does not strand it.
    const { copied } = await migrateBackend({
      from: local,
      to: idb,
      keys: shellKeysFor(subject),
    })
    if (copied.length) console.info(`[storage] copied ${copied.length} key(s) to IndexedDB`)
    return { backend: idb, kind: 'indexeddb', migrated: copied }
  } catch (err) {
    console.warn('[storage] IndexedDB setup failed — falling back to localStorage:', err)
    return { backend: local, kind: 'local', migrated: [] }
  }
}
