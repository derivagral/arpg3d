/**
 * src/host/storage/localAdapter.js — localStorage-backed host storage
 *
 * The default implementation of the `host.storage` capability: a small async
 * key/value slot store, namespaced by (gameId, subject) so one game can never
 * read another's data and one player can never read another's.
 *
 * Everything here is async despite localStorage being synchronous. That is
 * the entire point. It costs nothing today and it means the adapter can be
 * swapped for:
 *
 *   - a postMessage proxy, when games move into an iframe or Worker,
 *   - an HTTP adapter, when saves move server-side,
 *
 * without a single line of game code changing. A synchronous API here would
 * quietly forbid both.
 *
 * @see src/host/host.js for how this is injected.
 */

import { subjectKey } from '../../identity/identity.js'

export const HOST_STORAGE_NS = 'arpg3d.shell:gamedata:v1'

/**
 * @param {{ storage?: Storage, gameId: string, subject: string }} opts
 */
export const createLocalStorageAdapter = ({
  storage = globalThis.localStorage,
  gameId,
  subject,
}) => {
  if (!gameId) throw new Error('host storage: gameId is required')
  if (!subject) throw new Error('host storage: subject is required')

  const prefix = `${HOST_STORAGE_NS}:${encodeURIComponent(gameId)}:${subjectKey(subject)}:`
  const keyFor = (slot) => `${prefix}${encodeURIComponent(String(slot))}`

  return {
    /** @returns {Promise<any|null>} parsed value, or null if absent/corrupt */
    async get(slot) {
      const raw = storage.getItem(keyFor(slot))
      if (raw == null) return null
      try {
        return JSON.parse(raw)
      } catch (_) {
        // A corrupt slot reads as empty rather than throwing: a game must be
        // able to start from a bad slot, not crash on boot because of one.
        console.warn(`[host:storage] slot '${slot}' is corrupt — reading as empty`)
        return null
      }
    },

    /** @returns {Promise<void>} */
    async put(slot, value) {
      try {
        storage.setItem(keyFor(slot), JSON.stringify(value))
      } catch (err) {
        // Quota exhausted, or private mode. Surfaced as a rejection so the
        // game can tell the player its save did not stick.
        throw new Error(`could not write slot '${slot}': ${err.message}`)
      }
    },

    /** @returns {Promise<string[]>} slot names in this namespace */
    async list() {
      const out = []
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (key?.startsWith(prefix)) out.push(decodeURIComponent(key.slice(prefix.length)))
      }
      return out.sort()
    },

    /** @returns {Promise<boolean>} true if a slot was removed */
    async remove(slot) {
      const key = keyFor(slot)
      if (storage.getItem(key) == null) return false
      storage.removeItem(key)
      return true
    },
  }
}
