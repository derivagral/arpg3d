/**
 * src/storage/saveStore.js — save slot CRUD
 *
 * Owns WHERE saves live; sim/save.js owns the format. All saves sit under a
 * single namespaced key as one JSON envelope — saves are a few KB each, so
 * read-modify-write of the whole blob is simpler than per-slot keys.
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
 * ── Every method is async ───────────────────────────────────────────────────
 * The bytes come from an injected backend (src/storage/backends/), so this
 * store works unchanged over localStorage, IndexedDB, or an HTTP API. Two of
 * those are async-only, so the interface has to be. Concretely this buys:
 *
 *   - IndexedDB, which localStorage's 5MB sync-only ceiling rules out, and
 *   - the server-side save path, which is inherently async, and
 *   - running game code off the main thread at all: `localStorage` is a
 *     Window-only API and simply does not exist inside a Worker.
 *
 * ── Writes are serialized ───────────────────────────────────────────────────
 * Going async introduced a hazard that did not exist when this was
 * synchronous: two overlapping read-modify-write cycles can interleave, and
 * the second write clobbers the first. Since the envelope holds every slot,
 * that loses a whole save, not a field. So every operation queues behind the
 * previous one on a per-store chain. Contention is trivial (one player, a
 * write every wave clear) and correctness here is not optional.
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
import { createLocalStorageBackend } from './backends/localStorage.js'

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
 * @returns {Promise<boolean>} true if an adoption happened
 */
export const adoptLegacySaves = async (backend, subject) => {
  if (!backend || !subject) return false
  try {
    if (await backend.read(ADOPTED_KEY)) return false        // already claimed
    const legacy = await backend.read(STORAGE_KEY)
    if (!legacy) return false
    const target = storageKeyFor(subject)
    if (await backend.read(target)) return false             // subject has saves
    await backend.write(target, legacy)
    await backend.write(ADOPTED_KEY, subject)
    return true
  } catch (_) {
    return false
  }
}

/**
 * @param {{ backend?: object, storage?: Storage, subject?: string|null }} [options]
 *   Pass a `backend` (preferred), or a `storage` to be wrapped in the
 *   localStorage backend. `subject` namespaces the envelope per player;
 *   omitting it targets the un-namespaced legacy key, which only the adoption
 *   path and its tests should do.
 */
export const createSaveStore = ({ backend, storage, subject = null } = {}) => {
  const store = backend ?? createLocalStorageBackend(
    storage ? { storage } : undefined
  )

  const key = storageKeyFor(subject)

  // Serialization chain. Every operation runs after the previous one settles,
  // so a read-modify-write can never interleave with another.
  let tail = Promise.resolve()
  const serial = (fn) => {
    const run = tail.then(() => fn())
    // Swallow here only — the caller still sees the rejection via `run`.
    tail = run.then(() => {}, () => {})
    return run
  }

  const read = async () => {
    const raw = await store.read(key)
    if (!raw) return { v: SAVE_SCHEMA_VERSION, saves: {} }
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.saves === 'object') return parsed
    } catch (_) { /* fall through to backup */ }
    // Corrupt envelope: stash it for manual recovery instead of destroying it
    await store.write(`${key}:corrupt-backup`, raw)
    return { v: SAVE_SCHEMA_VERSION, saves: {} }
  }

  const write = (envelope) => store.write(key, JSON.stringify(envelope))

  /** Slot summary + compatibility verdict, for list UIs. */
  const summarize = (file) => {
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
  }

  return {
    /** The identity subject this store is namespaced to (null = legacy key). */
    subject,

    /** The storage key backing this store. Exposed for tests and debugging. */
    key,

    /** True when this store can flush synchronously on unload. */
    canWriteSync: Boolean(store.canWriteSync),

    /**
     * Slot summaries for menu UIs, newest first. Each entry carries a
     * compatibility verdict so the UI can gray out unloadable saves.
     * @returns {Promise<Array<{ id, name, v, createdAt, updatedAt, meta, compatible, reason }>>}
     */
    list() {
      return serial(async () => {
        const { saves } = await read()
        return Object.values(saves)
          .map(summarize)
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      })
    },

    /** @returns {Promise<object|null>} full raw SaveFile */
    get(id) {
      return serial(async () => (await read()).saves[id] ?? null)
    },

    /**
     * Create a new slot from a live SimState.
     * @returns {Promise<object>} the stored SaveFile
     */
    create(name, simState, profile = null) {
      return serial(async () => {
        const envelope = await read()
        const file = createSaveFile(simState, { name, profile })
        envelope.saves[file.id] = file
        await write(envelope)
        return file
      })
    },

    /**
     * Overwrite a slot's sim snapshot (autosave path). Pass `profile` to
     * persist meta changes alongside the run; omitted, the slot keeps the
     * profile it already had.
     * @returns {Promise<object|null>} updated SaveFile, or null if the slot is gone
     */
    update(id, simState, profile = null) {
      return serial(async () => {
        const envelope = await read()
        const existing = envelope.saves[id]
        if (!existing) return null
        const file = updateSaveFile(existing, simState, Date.now(), profile)
        envelope.saves[id] = file
        await write(envelope)
        return file
      })
    },

    /**
     * The same write, synchronously, for `pagehide` and nothing else.
     *
     * A promise may never resolve once the browser starts tearing the page
     * down, so the async path silently loses the last checkpoint on tab close.
     * Only backends advertising `canWriteSync` support this; check
     * `store.canWriteSync` first.
     *
     * Bypasses the serialization chain by necessity — there is no time to
     * wait for it — so it is last-write-wins against anything in flight. That
     * is the correct trade at unload: the caller's state is the newest there
     * is.
     *
     * @returns {object|null} updated SaveFile, or null if it could not be written
     */
    updateSync(id, simState, profile = null) {
      if (!store.canWriteSync) return null
      try {
        const raw = store.readSync(key)
        const parsed = raw ? JSON.parse(raw) : null
        const envelope = parsed?.saves ? parsed : { v: SAVE_SCHEMA_VERSION, saves: {} }
        const existing = envelope.saves[id]
        if (!existing) return null
        const file = updateSaveFile(existing, simState, Date.now(), profile)
        envelope.saves[id] = file
        store.writeSync(key, JSON.stringify(envelope))
        return file
      } catch (err) {
        console.warn('[save] synchronous flush failed:', err)
        return null
      }
    },

    /**
     * A slot's persistent character profile, migrated if needed.
     * @returns {Promise<object|null>} profile, or null if the slot is gone
     */
    async getProfile(id) {
      const file = await this.get(id)
      if (!file) return null
      const { compatible, file: migrated } = checkCompatibility(file)
      return hydrateProfile((compatible ? migrated : file).profile)
    },

    /** @returns {Promise<object|null>} */
    rename(id, name) {
      return serial(async () => {
        const envelope = await read()
        const existing = envelope.saves[id]
        if (!existing) return null
        const file = { ...existing, name, updatedAt: Date.now() }
        envelope.saves[id] = file
        await write(envelope)
        return file
      })
    },

    /** @returns {Promise<boolean>} true if a slot was removed */
    remove(id) {
      return serial(async () => {
        const envelope = await read()
        if (!(id in envelope.saves)) return false
        delete envelope.saves[id]
        await write(envelope)
        return true
      })
    },

    /**
     * Import an externally-sourced save file object (parsed JSON or decoded
     * code). Validates/migrates first; rejects with a reason if the file is
     * unusable. Imports always get a fresh slot id so they can't clobber an
     * existing slot.
     * @returns {Promise<object>} the stored SaveFile
     */
    importSaveFile(rawObj) {
      return serial(async () => {
        const { compatible, reason, file } = checkCompatibility(rawObj)
        if (!compatible) throw new Error(`cannot import save: ${reason}`)
        const envelope = await read()
        const imported = { ...file, id: newSaveId(), updatedAt: Date.now() }
        envelope.saves[imported.id] = imported
        await write(envelope)
        return imported
      })
    },

    /** @returns {Promise<string|null>} pretty-printed JSON for download */
    async exportJson(id) {
      const file = await this.get(id)
      return file ? JSON.stringify(file, null, 2) : null
    },

    /** @returns {Promise<string|null>} portable single-line code for clipboard */
    async exportCode(id) {
      const file = await this.get(id)
      return file ? encodeSaveCode(file) : null
    },
  }
}
