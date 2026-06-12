/**
 * sim/save.js — Save file codec (pure, Node-importable)
 *
 * Converts a live SimState into a versioned, serializable save file and back.
 * No storage here — persistence (localStorage, file download) lives in
 * src/storage/. This module owns the FORMAT:
 *
 *   SaveFile {
 *     game: 'arpg3d'          — magic, rejects foreign JSON on import
 *     v: number               — SAVE_SCHEMA_VERSION at write time
 *     id: string              — slot identifier ('sv_xxxxxxxx')
 *     name: string            — user-facing slot name
 *     createdAt: number       — epoch ms
 *     updatedAt: number       — epoch ms
 *     meta: object            — denormalized summary for list UIs (depth, gold, ...)
 *     sim: object             — serialized SimState snapshot
 *   }
 *
 * Affixes are stored as { id, delta } and rehydrated from AFFIX_POOL so that
 * name/desc/tag changes propagate to old saves, while wave-scaled deltas are
 * preserved exactly as held. Unknown affix ids (removed from the pool) are
 * rehydrated as inert stubs and reported via warnings — a save never fails to
 * load over a balance patch.
 *
 * Versioning: bump SAVE_SCHEMA_VERSION on breaking format changes and add a
 * step migration to MIGRATIONS (v → v+1). checkCompatibility() runs migrations
 * implicitly via migrateSaveFile() before declaring a save incompatible.
 */

import { AFFIX_POOL } from './affixes.js'
import { ENEMY_TEMPLATES } from './engine.js'

export const GAME_ID = 'arpg3d'
export const SAVE_SCHEMA_VERSION = 1

// ── SimState ↔ snapshot ──────────────────────────────────────────────────────

// weight is included because rollAffix() hands out copies with pity-boosted
// weights baked in — restoring the pool weight would break exact round-trips.
const serializeAffix = (affix) => ({
  id: affix.id,
  delta: { ...affix.delta },
  weight: affix.weight,
})

const hydrateAffix = (stored, warnings) => {
  const pooled = AFFIX_POOL.find(a => a.id === stored.id)
  if (pooled) {
    return { ...pooled, delta: { ...stored.delta }, weight: stored.weight ?? pooled.weight }
  }
  warnings.push(`unknown affix '${stored.id}' — kept as inert stub`)
  return {
    id: stored.id,
    name: stored.id,
    desc: '(removed from pool)',
    tags: [],
    category: 'utility',
    weight: stored.weight ?? 0,
    value: 0,
    delta: { ...stored.delta },
    minIlvl: 0, slotPool: null, sourcePool: null,
  }
}

/**
 * Snapshot a live SimState into plain serializable data.
 * The event log is intentionally dropped — it grows unboundedly and a resumed
 * run starts a fresh log with a 'run_resumed' entry.
 *
 * @param {import('./engine.js').SimState} state
 * @returns {object} snapshot
 */
export const serializeSim = (state) => ({
  seed: state.seed,
  rng: state.rng,
  tick: state.tick,
  elapsed: state.elapsed,
  phase: state.phase,
  depth: state.depth,
  nextId: state.nextId,
  player: {
    hp: state.player.hp,
    maxHp: state.player.maxHp,
    gold: state.player.gold,
    xp: state.player.xp,
    kills: { ...state.player.kills },
    lastAttackTick: state.player.lastAttackTick,
    affixes: state.player.affixes.map(serializeAffix),
  },
  enemies: state.enemies.map(e => ({ ...e })),
  gate: state.gate
    ? {
        depth: state.gate.depth,
        rerolls: state.gate.rerolls ?? 0,
        options: state.gate.options.map(o => serializeAffix(o.affix)),
      }
    : null,
  pity: {
    droughts: { ...state.pity.droughts },
    totalGates: state.pity.totalGates,
  },
})

/**
 * Rebuild a runnable SimState from a snapshot.
 *
 * @param {object} snap - output of serializeSim()
 * @returns {{ state: import('./engine.js').SimState, warnings: string[] }}
 */
export const hydrateSim = (snap) => {
  const warnings = []
  const affixes = snap.player.affixes.map(a => hydrateAffix(a, warnings))

  // kills and gate.rerolls are additive fields — older snapshots default them
  const gate = snap.gate
    ? {
        depth: snap.gate.depth,
        rerolls: snap.gate.rerolls ?? 0,
        options: snap.gate.options.map(stored => {
          const affix = hydrateAffix(stored, warnings)
          return { affix, tags: affix.tags }
        }),
      }
    : null

  const state = {
    seed: snap.seed,
    rng: snap.rng,
    tick: snap.tick,
    elapsed: snap.elapsed,
    phase: snap.phase,
    depth: snap.depth,
    // older snapshots predate the threaded id counter — resume past live ids
    nextId: snap.nextId ?? Math.max(0, ...snap.enemies.map(e => e.id)) + 1,
    player: {
      hp: snap.player.hp,
      maxHp: snap.player.maxHp,
      gold: snap.player.gold,
      xp: snap.player.xp,
      kills: { ...(snap.player.kills ?? {}) },
      lastAttackTick: snap.player.lastAttackTick,
      affixes,
    },
    // melee swing fields are additive — older snapshots default from template
    enemies: snap.enemies.map(e => ({
      attackMs: ENEMY_TEMPLATES[e.type]?.attackMs ?? 1500,
      lastHitTick: 0,
      ...e,
    })),
    gate,
    pity: {
      droughts: { ...snap.pity.droughts },
      totalGates: snap.pity.totalGates,
    },
    log: [{ tick: snap.tick, type: 'run_resumed', payload: { seed: snap.seed, depth: snap.depth } }],
  }

  return { state, warnings }
}

// ── Save file envelope ───────────────────────────────────────────────────────

/** Denormalized summary used by slot-list UIs without hydrating the sim. */
export const buildMeta = (state) => ({
  depth: state.depth,
  phase: state.phase,
  hp: Math.round(state.player.hp),
  maxHp: state.player.maxHp,
  gold: state.player.gold,
  xp: state.player.xp,
  affixCount: state.player.affixes.length,
  elapsed: Math.round(state.elapsed),
})

export const newSaveId = () =>
  'sv_' + Math.floor(Math.random() * 0xffffffff).toString(36) + Date.now().toString(36)

/**
 * Wrap a SimState into a complete versioned save file.
 *
 * @param {import('./engine.js').SimState} state
 * @param {{ id?: string, name?: string, createdAt?: number, now?: number }} [opts]
 * @returns {object} SaveFile
 */
export const createSaveFile = (state, opts = {}) => {
  const now = opts.now ?? Date.now()
  return {
    game: GAME_ID,
    v: SAVE_SCHEMA_VERSION,
    id: opts.id ?? newSaveId(),
    name: opts.name ?? 'Unnamed Run',
    createdAt: opts.createdAt ?? now,
    updatedAt: now,
    meta: buildMeta(state),
    sim: serializeSim(state),
  }
}

/** Refresh an existing save file with a newer SimState (preserves identity). */
export const updateSaveFile = (file, state, now = Date.now()) => ({
  ...file,
  v: SAVE_SCHEMA_VERSION,
  updatedAt: now,
  meta: buildMeta(state),
  sim: serializeSim(state),
})

// ── Validation & compatibility ───────────────────────────────────────────────

/**
 * Structural validation — is this object shaped like a save file at all?
 * @param {*} obj
 * @returns {{ ok: boolean, errors: string[] }}
 */
export const validateSaveFile = (obj) => {
  const errors = []
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['not an object'] }
  }
  if (obj.game !== GAME_ID) errors.push(`game tag '${obj.game}' is not '${GAME_ID}'`)
  if (!Number.isInteger(obj.v)) errors.push('missing schema version (v)')
  if (typeof obj.id !== 'string' || !obj.id) errors.push('missing id')
  if (typeof obj.name !== 'string') errors.push('missing name')
  const sim = obj.sim
  if (!sim || typeof sim !== 'object') {
    errors.push('missing sim snapshot')
  } else {
    if (typeof sim.seed !== 'number') errors.push('sim.seed must be a number')
    if (typeof sim.rng !== 'number') errors.push('sim.rng must be a number')
    if (!['combat', 'gate', 'dead'].includes(sim.phase)) errors.push(`bad sim.phase '${sim.phase}'`)
    if (!Number.isInteger(sim.depth) || sim.depth < 1) errors.push('sim.depth must be a positive integer')
    if (!sim.player || typeof sim.player !== 'object') errors.push('missing sim.player')
    else if (!Array.isArray(sim.player.affixes)) errors.push('sim.player.affixes must be an array')
    if (!Array.isArray(sim.enemies)) errors.push('sim.enemies must be an array')
    if (!sim.pity || typeof sim.pity !== 'object') errors.push('missing sim.pity')
  }
  return { ok: errors.length === 0, errors }
}

/**
 * Step migrations, keyed by the version they upgrade FROM.
 * Each entry: (saveFile) => saveFile with v incremented by 1.
 * Empty until the schema first changes.
 */
export const MIGRATIONS = {}

/**
 * Upgrade a save file to the current schema version, one step at a time.
 * Returns the original object untouched if already current or unmigratable.
 *
 * @param {object} file
 * @returns {{ file: object, migrated: boolean }}
 */
export const migrateSaveFile = (file) => {
  let current = file
  let migrated = false
  while (Number.isInteger(current.v) && current.v < SAVE_SCHEMA_VERSION) {
    const step = MIGRATIONS[current.v]
    if (!step) return { file, migrated: false }
    current = step(current)
    migrated = true
  }
  return { file: current, migrated }
}

/**
 * Can this save be loaded by the current build?
 * Runs structural validation and (future) migrations.
 *
 * @param {*} obj
 * @returns {{ compatible: boolean, reason: string|null, file: object|null, migrated: boolean }}
 */
export const checkCompatibility = (obj) => {
  const { ok, errors } = validateSaveFile(obj)
  if (!ok) return { compatible: false, reason: errors.join('; '), file: null, migrated: false }

  if (obj.v > SAVE_SCHEMA_VERSION) {
    return {
      compatible: false,
      reason: `save schema v${obj.v} is newer than this build (v${SAVE_SCHEMA_VERSION})`,
      file: null, migrated: false,
    }
  }
  if (obj.v < SAVE_SCHEMA_VERSION) {
    const { file, migrated } = migrateSaveFile(obj)
    if (!migrated) {
      return {
        compatible: false,
        reason: `save schema v${obj.v} has no migration path to v${SAVE_SCHEMA_VERSION}`,
        file: null, migrated: false,
      }
    }
    return { compatible: true, reason: null, file, migrated: true }
  }
  return { compatible: true, reason: null, file: obj, migrated: false }
}

// ── Portable export code ─────────────────────────────────────────────────────
// Shareable single-line form: 'arpg3d.v1.<base64url(json)>'.
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
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * @param {object} saveFile
 * @returns {string} portable code, e.g. 'arpg3d.v1.eyJ...'
 */
export const encodeSaveCode = (saveFile) =>
  `${GAME_ID}.v${saveFile.v}.${toBase64Url(JSON.stringify(saveFile))}`

/**
 * Decode a portable code back to a (raw, unvalidated) save file object.
 * Throws on malformed input; callers run checkCompatibility() on the result.
 *
 * @param {string} code
 * @returns {object}
 */
export const decodeSaveCode = (code) => {
  const trimmed = code.trim()
  const match = trimmed.match(new RegExp(`^${GAME_ID}\\.v(\\d+)\\.([A-Za-z0-9_-]+)$`))
  if (!match) throw new Error(`not a ${GAME_ID} save code`)
  return JSON.parse(fromBase64Url(match[2]))
}

/**
 * Accept either raw save-file JSON or a portable code (import UX helper).
 * @param {string} text
 * @returns {object} raw save file object (unvalidated)
 */
export const parseImportText = (text) => {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed)
  return decodeSaveCode(trimmed)
}
