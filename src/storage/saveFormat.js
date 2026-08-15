/**
 * src/storage/saveFormat.js — the versioned save envelope, for any game
 *
 * Every game wants the same tedious machinery: a magic tag so foreign JSON is
 * rejected on import, a schema version, step migrations, a compatibility
 * verdict, and a portable single-line export code. None of that is
 * game-specific — only the *body* is.
 *
 * So this owns the envelope:
 *
 *   { game, v, id, name, createdAt, updatedAt, ...body }
 *
 * and a spec supplies the rest. ARPG3D's body is `{ meta, profile, sim }`; an
 * idle game's would be something else entirely, and neither needs to know
 * about the other.
 *
 * ── Why this is not in sim/ ─────────────────────────────────────────────────
 * `sim/` is ARPG3D's game logic and stays dependency-free. A second game
 * reaching into `sim/` to borrow a codec would be exactly backwards, so the
 * reusable half lives here and each game composes it — see
 * src/games/arpg3d/save.js.
 *
 * Pure and Node-importable: no storage, no browser APIs, no game imports.
 * Persistence is src/storage/saveStore.js; bytes are the backends.
 */

/**
 * @typedef {object} SaveSpec
 * @property {string} gameId          magic tag + storage/export-code prefix
 * @property {number} schemaVersion   bumped on breaking body changes
 * @property {Record<number, (file: object) => object>} migrations
 *           keyed by the version they upgrade FROM; each returns the file at
 *           version+1
 * @property {(state: any, opts: object) => object} buildBody
 *           live state → the game-specific half of the file
 * @property {(file: object) => string[]} [validateBody]
 *           structural complaints about the body; empty means fine
 */

/** Slot ids are opaque and only need to be unique within one envelope. */
export const newSaveId = () =>
  'sv_' + Math.floor(Math.random() * 0xffffffff).toString(36) + Date.now().toString(36)

// btoa/atob + TextEncoder are available in both browsers and Node >= 16.

const toBase64Url = (str) => {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (b64url) => {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Bind the envelope machinery to one game.
 *
 * @param {SaveSpec} spec
 * @returns {object} the game's save codec
 */
export const createSaveFormat = ({
  gameId,
  schemaVersion,
  migrations = {},
  buildBody,
  validateBody = () => [],
}) => {
  if (!gameId) throw new Error('saveFormat: gameId is required')
  if (!Number.isInteger(schemaVersion)) throw new Error('saveFormat: schemaVersion must be an integer')
  if (typeof buildBody !== 'function') throw new Error('saveFormat: buildBody is required')

  /**
   * Wrap live state into a complete versioned save file.
   * @returns {object} SaveFile
   */
  const createSaveFile = (state, opts = {}) => {
    const now = opts.now ?? Date.now()
    return {
      game: gameId,
      v: schemaVersion,
      id: opts.id ?? newSaveId(),
      name: opts.name ?? 'Unnamed Run',
      createdAt: opts.createdAt ?? now,
      updatedAt: now,
      ...buildBody(state, opts),
    }
  }

  /**
   * Refresh an existing file with newer state, preserving its identity
   * (id, name, createdAt).
   * @returns {object} SaveFile
   */
  const updateSaveFile = (file, state, now = Date.now(), opts = {}) => ({
    ...file,
    v: schemaVersion,
    updatedAt: now,
    ...buildBody(state, { ...opts, previous: file }),
  })

  /**
   * Structural validation — is this shaped like one of OUR save files at all?
   * The game tag check is what stops another game's (or a random site's) JSON
   * being imported into this one.
   * @returns {{ ok: boolean, errors: string[] }}
   */
  const validateSaveFile = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { ok: false, errors: ['not an object'] }
    }
    const errors = []
    if (obj.game !== gameId) errors.push(`game tag '${obj.game}' is not '${gameId}'`)
    if (!Number.isInteger(obj.v)) errors.push('missing schema version (v)')
    if (typeof obj.id !== 'string' || !obj.id) errors.push('missing id')
    if (typeof obj.name !== 'string') errors.push('missing name')
    errors.push(...validateBody(obj))
    return { ok: errors.length === 0, errors }
  }

  /**
   * Upgrade to the current schema version, one step at a time. Returns the
   * original untouched if already current or unmigratable.
   * @returns {{ file: object, migrated: boolean }}
   */
  const migrateSaveFile = (file) => {
    let current = file
    let migrated = false
    while (Number.isInteger(current.v) && current.v < schemaVersion) {
      const step = migrations[current.v]
      if (!step) return { file, migrated: false }
      current = step(current)
      migrated = true
    }
    return { file: current, migrated }
  }

  /**
   * Can this save be loaded by the current build? Validates, then migrates.
   * @returns {{ compatible: boolean, reason: string|null, file: object|null, migrated: boolean }}
   */
  const checkCompatibility = (obj) => {
    const { ok, errors } = validateSaveFile(obj)
    if (!ok) return { compatible: false, reason: errors.join('; '), file: null, migrated: false }

    if (obj.v > schemaVersion) {
      return {
        compatible: false,
        reason: `save schema v${obj.v} is newer than this build (v${schemaVersion})`,
        file: null, migrated: false,
      }
    }
    if (obj.v < schemaVersion) {
      const { file, migrated } = migrateSaveFile(obj)
      if (!migrated) {
        return {
          compatible: false,
          reason: `save schema v${obj.v} has no migration path to v${schemaVersion}`,
          file: null, migrated: false,
        }
      }
      return { compatible: true, reason: null, file, migrated: true }
    }
    return { compatible: true, reason: null, file: obj, migrated: false }
  }

  /** Shareable single-line form: '<gameId>.v<n>.<base64url(json)>'. */
  const encodeSaveCode = (saveFile) =>
    `${gameId}.v${saveFile.v}.${toBase64Url(JSON.stringify(saveFile))}`

  /** @returns {object} the decoded save file */
  const decodeSaveCode = (code) => {
    const trimmed = String(code).trim()
    const match = trimmed.match(new RegExp(`^${gameId}\\.v(\\d+)\\.([A-Za-z0-9_-]+)$`))
    if (!match) throw new Error(`not a ${gameId} save code`)
    return JSON.parse(fromBase64Url(match[2]))
  }

  /** Accept either a pasted export code or raw save JSON. */
  const parseImportText = (text) => {
    const trimmed = String(text).trim()
    if (trimmed.startsWith('{')) return JSON.parse(trimmed)
    return decodeSaveCode(trimmed)
  }

  return {
    gameId,
    schemaVersion,
    migrations,
    newSaveId,
    createSaveFile,
    updateSaveFile,
    validateSaveFile,
    migrateSaveFile,
    checkCompatibility,
    encodeSaveCode,
    decodeSaveCode,
    parseImportText,
  }
}
