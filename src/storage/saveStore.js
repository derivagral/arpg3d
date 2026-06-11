/**
 * src/storage/saveStore.js — localStorage-backed save slot CRUD
 *
 * Owns WHERE saves live; sim/save.js owns the format. All saves sit under a
 * single namespaced key as one JSON envelope — saves are a few KB each, so
 * atomic read-modify-write of the whole blob is simpler than per-slot keys.
 *
 * The storage backend is injectable (anything with getItem/setItem/removeItem)
 * so the store is testable in Node without a browser.
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

export const STORAGE_KEY = `${GAME_ID}:saves:v1`
const BACKUP_KEY = `${STORAGE_KEY}:corrupt-backup`

/**
 * @param {{ getItem(k:string):string|null, setItem(k:string,v:string):void, removeItem(k:string):void }} [storage]
 */
export const createSaveStore = (storage = globalThis.localStorage) => {
  const read = () => {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return { v: SAVE_SCHEMA_VERSION, saves: {} }
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.saves === 'object') return parsed
    } catch (_) { /* fall through to backup */ }
    // Corrupt envelope: stash it for manual recovery instead of destroying it
    storage.setItem(BACKUP_KEY, raw)
    return { v: SAVE_SCHEMA_VERSION, saves: {} }
  }

  const write = (envelope) => {
    storage.setItem(STORAGE_KEY, JSON.stringify(envelope))
  }

  return {
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
    create(name, simState) {
      const envelope = read()
      const file = createSaveFile(simState, { name })
      envelope.saves[file.id] = file
      write(envelope)
      return file
    },

    /**
     * Overwrite a slot's sim snapshot (autosave path).
     * @returns {object|null} updated SaveFile, or null if the slot is gone
     */
    update(id, simState) {
      const envelope = read()
      const existing = envelope.saves[id]
      if (!existing) return null
      const file = updateSaveFile(existing, simState)
      envelope.saves[id] = file
      write(envelope)
      return file
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
