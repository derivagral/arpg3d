/**
 * src/storage/saveStore.js — localStorage-backed save slot CRUD
 *
 * Owns WHERE saves live; sim/save.js owns the format. All saves sit under a
 * single namespaced key as one JSON envelope — saves are a few KB each, so
 * atomic read-modify-write of the whole blob is simpler than per-slot keys.
 *
 * The storage backend is injectable (anything with getItem/setItem/removeItem)
 * so the store is testable in Node without a browser.
 *
 * ── Saves are keyed on identity subject ─────────────────────────────────────
 * Each player gets their own envelope, under `arpg3d:saves:v1:<subject>`. The
 * subject is a DID for a signed-in player and `anon:<uuid>` for a guest — see
 * src/identity/identity.js for why the DID and never the handle.
 *
 * Consequences worth stating outright:
 *   - Signing in does not "load your saves". It switches namespaces. Moving
 *     saves across a namespace is an explicit, user-consented copy
 *     (src/storage/claim.js), never automatic.
 *   - Two people sharing a browser get separate saves once signed in, and
 *     share the guest namespace when not. That is the honest model: the guest
 *     subject identifies a browser, not a person.
 *
 * Omitting `subject` keeps the store on the un-namespaced legacy key. That is
 * used by tests and by the one-time adoption path below, and nothing else.
 */

import {
  createSaveFile,
  updateSaveFile,
  checkCompatibility,
  encodeSaveCode,
  newSaveId,
  SAVE_SCHEMA_VERSION,
  GAME_ID,
} from '../../sim/save.js'
import { hydrateProfile } from '../../sim/profile.js'
import { subjectKey } from '../identity/identity.js'

export const STORAGE_KEY = `${GAME_ID}:saves:v1`

/** Marks the legacy envelope as already taken over, so it is adopted once. */
export const ADOPTED_KEY = `${STORAGE_KEY}:adopted-by`

/** Where a given subject's saves live. */
export const storageKeyFor = (subject) =>
  subject ? `${STORAGE_KEY}:${subjectKey(subject)}` : STORAGE_KEY

/**
 * Take over pre-identity saves (written before this module knew about
 * subjects) for `subject`, once and only once.
 *
 * The legacy blob is COPIED, not moved: it stays where it is as a free
 * backup, and the marker key stops a second subject from also claiming it.
 * Without the marker, signing in on a fresh browser would hand the previous
 * player's saves to whoever signed in next.
 *
 * @returns {boolean} true if an adoption happened
 */
export const adoptLegacySaves = (storage, subject) => {
  if (!storage || !subject) return false
  try {
    if (storage.getItem(ADOPTED_KEY)) return false          // already claimed
    const legacy = storage.getItem(STORAGE_KEY)
    if (!legacy) return false
    const target = storageKeyFor(subject)
    if (storage.getItem(target)) return false               // subject has saves
    storage.setItem(target, legacy)
    storage.setItem(ADOPTED_KEY, subject)
    return true
  } catch (_) {
    return false
  }
}

/**
 * @param {object} [options] a storage-like object (legacy positional form), or
 *   `{ storage, subject }`. `subject` namespaces the envelope per player.
 */
export const createSaveStore = (options = {}) => {
  // Accept the pre-identity positional form, createSaveStore(storage), so
  // existing callers and tests keep working unchanged.
  const isStorageLike = typeof options?.getItem === 'function'
  const {
    storage = globalThis.localStorage,
    subject = null,
  } = isStorageLike ? { storage: options } : options

  const key = storageKeyFor(subject)

  const read = () => {
    const raw = storage.getItem(key)
    if (!raw) return { v: SAVE_SCHEMA_VERSION, saves: {} }
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.saves === 'object') return parsed
    } catch (_) { /* fall through to backup */ }
    // Corrupt envelope: stash it for manual recovery instead of destroying it
    storage.setItem(`${key}:corrupt-backup`, raw)
    return { v: SAVE_SCHEMA_VERSION, saves: {} }
  }

  const write = (envelope) => {
    storage.setItem(key, JSON.stringify(envelope))
  }

  return {
    /** The identity subject this store is namespaced to (null = legacy key). */
    subject,

    /** The storage key backing this store. Exposed for tests and debugging. */
    key,

    /**
     * Slot summaries for menu UIs, newest first. Each entry carries a
     * compatibility verdict so the UI can gray out unloadable saves.
     * @returns {Array<{ id, name, v, createdAt, updatedAt, meta, compatible, reason }>}
     */
    list() {
      const { saves } = read()
      return Object.values(saves)
        .map(file => {
          const { compatible, reason } = checkCompatibility(file)
          return {
            id: file.id,
            name: file.name,
            v: file.v,
            createdAt: file.createdAt,
            updatedAt: file.updatedAt,
            meta: file.meta ?? null,
            compatible,
            reason,
          }
        })
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    },

    /** @returns {object|null} full raw SaveFile */
    get(id) {
      return read().saves[id] ?? null
    },

    /**
     * Create a new slot from a live SimState.
     * @returns {object} the stored SaveFile
     */
    create(name, simState, profile = null) {
      const envelope = read()
      const file = createSaveFile(simState, { name, profile })
      envelope.saves[file.id] = file
      write(envelope)
      return file
    },

    /**
     * Overwrite a slot's sim snapshot (autosave path). Pass `profile` to
     * persist meta changes alongside the run; omitted, the slot keeps the
     * profile it already had.
     * @returns {object|null} updated SaveFile, or null if the slot is gone
     */
    update(id, simState, profile = null) {
      const envelope = read()
      const existing = envelope.saves[id]
      if (!existing) return null
      const file = updateSaveFile(existing, simState, Date.now(), profile)
      envelope.saves[id] = file
      write(envelope)
      return file
    },

    /**
     * A slot's persistent character profile, migrated if needed.
     * @returns {object|null} profile, or null if the slot is gone
     */
    getProfile(id) {
      const file = this.get(id)
      if (!file) return null
      const { compatible, file: migrated } = checkCompatibility(file)
      return hydrateProfile((compatible ? migrated : file).profile)
    },

    /** @returns {object|null} */
    rename(id, name) {
      const envelope = read()
      const existing = envelope.saves[id]
      if (!existing) return null
      const file = { ...existing, name, updatedAt: Date.now() }
      envelope.saves[id] = file
      write(envelope)
      return file
    },

    /** @returns {boolean} true if a slot was removed */
    remove(id) {
      const envelope = read()
      if (!(id in envelope.saves)) return false
      delete envelope.saves[id]
      write(envelope)
      return true
    },

    /**
     * Import an externally-sourced save file object (parsed JSON or decoded
     * code). Validates/migrates first; throws Error with a reason if the file
     * is unusable. Imports always get a fresh slot id so they can't clobber
     * an existing slot.
     * @returns {object} the stored SaveFile
     */
    importSaveFile(rawObj) {
      const { compatible, reason, file } = checkCompatibility(rawObj)
      if (!compatible) throw new Error(`cannot import save: ${reason}`)
      const envelope = read()
      const imported = { ...file, id: newSaveId(), updatedAt: Date.now() }
      envelope.saves[imported.id] = imported
      write(envelope)
      return imported
    },

    /** @returns {string|null} pretty-printed JSON for download */
    exportJson(id) {
      const file = this.get(id)
      return file ? JSON.stringify(file, null, 2) : null
    },

    /** @returns {string|null} portable single-line code for clipboard sharing */
    exportCode(id) {
      const file = this.get(id)
      return file ? encodeSaveCode(file) : null
    },
  }
}
