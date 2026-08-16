/**
 * sim/save.js — ARPG3D's save BODY (pure, Node-importable)
 *
 * Converts a live SimState to a serializable snapshot and back, and declares
 * ARPG3D's save spec. It does NOT own the envelope: the magic tag, schema
 * versioning, migration runner, compatibility verdict and portable export
 * codes are generic and live in src/storage/saveFormat.js, composed into a
 * usable codec by src/games/arpg3d/save.js.
 *
 * The split is what lets a second game reuse all of that machinery without
 * importing anything out of `sim/`, which is ARPG3D's own logic. Nothing here
 * depends on src/ — this module stays dependency-free.
 *
 *   SaveFile {                — envelope, from src/storage/saveFormat.js
 *     game: 'arpg3d'          — magic, rejects foreign JSON on import
 *     v: number               — SAVE_SCHEMA_VERSION at write time
 *     id: string              — slot identifier ('sv_xxxxxxxx')
 *     name: string            — user-facing slot name
 *     createdAt: number       — epoch ms
 *     updatedAt: number       — epoch ms
 *                             — body, from this module:
 *     meta: object            — denormalized summary for list UIs (depth, gold, ...)
 *     profile: object         — persistent character meta (echoes, upgrades)
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
 * step migration to MIGRATIONS (v → v+1). The envelope runs them before
 * declaring a save incompatible.
 */

import { AFFIX_POOL } from './affixes.js'
import { ENEMY_TEMPLATES } from './engine.js'
import { createProfile, hydrateProfile, runMetaFor } from './profile.js'
import { hydrateContainer, hydrateEquipment, INVENTORY_SIZE, countItems } from './inventory.js'

export const GAME_ID = 'arpg3d'

// v2: a slot became a CHARACTER — the envelope carries a persistent profile
// (echoes, upgrades, unlocks) alongside the current run, and the run snapshot
// carries the runMeta it was started with.
export const SAVE_SCHEMA_VERSION = 2

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
  nextUid: state.nextUid ?? 1,
  runMeta: {
    upgrades: { ...(state.runMeta?.upgrades ?? {}) },
    policies: [...(state.runMeta?.policies ?? [])],
    equipment: hydrateEquipment(state.runMeta?.equipment),
  },
  player: {
    hp: state.player.hp,
    maxHp: state.player.maxHp,
    x: state.player.x,
    z: state.player.z,
    waypoint: state.player.waypoint,
    gold: state.player.gold,
    xp: state.player.xp,
    kills: { ...state.player.kills },
    inventory: [...(state.player.inventory ?? [])],
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
    nextUid: snap.nextUid ?? 1,
    // pre-meta snapshots resume as an unupgraded run with base policies only
    runMeta: {
      upgrades: { ...(snap.runMeta?.upgrades ?? {}) },
      policies: [...(snap.runMeta?.policies ?? runMetaFor(createProfile()).policies)],
      equipment: hydrateEquipment(snap.runMeta?.equipment),
    },
    player: {
      hp: snap.player.hp,
      maxHp: snap.player.maxHp,
      // position is additive — pre-movement snapshots resume at the origin
      x: snap.player.x ?? 0,
      z: snap.player.z ?? 0,
      waypoint: snap.player.waypoint ?? 0,
      gold: snap.player.gold,
      xp: snap.player.xp,
      kills: { ...(snap.player.kills ?? {}) },
      // pre-item snapshots resume with an empty bag
      inventory: hydrateContainer(snap.player.inventory, INVENTORY_SIZE),
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

/**
 * Denormalized summary used by slot-list UIs without hydrating the sim.
 * `profile` is optional so the character's standing (echoes, record depth)
 * can show on the slot list too.
 */
export const buildMeta = (state, profile = null) => ({
  depth: state.depth,
  phase: state.phase,
  hp: Math.round(state.player.hp),
  maxHp: state.player.maxHp,
  gold: state.player.gold,
  xp: state.player.xp,
  affixCount: state.player.affixes.length,
  items: countItems(state.player.inventory ?? []),
  elapsed: Math.round(state.elapsed),
  echoes: profile?.echoes ?? 0,
  bestDepth: profile?.bestDepth ?? 0,
  runs: profile?.runs ?? 0,
})

// ── ARPG3D's save spec ───────────────────────────────────────────────────────
// The envelope (magic tag, versioning, migration, export codes) is generic and
// lives in src/storage/saveFormat.js. This module supplies only the parts that
// are actually about ARPG3D, and stays free of any dependency on src/.
//
// Composed into a usable codec by src/games/arpg3d/save.js.

/**
 * Structural validation of the ARPG3D body. The envelope checks the game tag,
 * version, id and name; this checks that the sim snapshot is loadable.
 * @returns {string[]} complaints; empty means fine
 */
export const validateSimBody = (obj) => {
  const errors = []
  const sim = obj.sim
  if (!sim || typeof sim !== 'object') {
    errors.push('missing sim snapshot')
    return errors
  }
  if (typeof sim.seed !== 'number') errors.push('sim.seed must be a number')
  if (typeof sim.rng !== 'number') errors.push('sim.rng must be a number')
  if (!['combat', 'gate', 'dead'].includes(sim.phase)) errors.push(`bad sim.phase '${sim.phase}'`)
  if (!Number.isInteger(sim.depth) || sim.depth < 1) errors.push('sim.depth must be a positive integer')
  if (!sim.player || typeof sim.player !== 'object') errors.push('missing sim.player')
  else if (!Array.isArray(sim.player.affixes)) errors.push('sim.player.affixes must be an array')
  if (!Array.isArray(sim.enemies)) errors.push('sim.enemies must be an array')
  if (!sim.pity || typeof sim.pity !== 'object') errors.push('missing sim.pity')
  return errors
}

/**
 * Step migrations, keyed by the version they upgrade FROM.
 * Each entry: (saveFile) => saveFile with v incremented by 1.
 */
export const MIGRATIONS = {
  // v1 -> v2: slots became characters. A v1 slot has no profile and its run
  // has no runMeta; both get fresh defaults, so an old save loads as a
  // brand-new character mid-run with nothing unlocked and nothing lost.
  1: (file) => ({
    ...file,
    v: 2,
    profile: createProfile(),
    sim: file.sim
      ? { ...file.sim, runMeta: runMetaFor(createProfile()) }
      : file.sim,
  }),
}

/**
 * The game-specific half of a save file. `opts.profile` carries meta changes
 * worth persisting (echoes awarded, upgrades bought); on an update with none
 * supplied, the file keeps the profile it already had.
 */
const buildBody = (state, opts = {}) => {
  const profile = hydrateProfile(opts.profile ?? opts.previous?.profile ?? createProfile())
  return {
    meta: buildMeta(state, profile),
    profile,
    sim: serializeSim(state),
  }
}

/**
 * Hand this to createSaveFormat() to get ARPG3D's codec.
 * @type {import('../src/storage/saveFormat.js').SaveSpec}
 */
export const ARPG3D_SAVE_SPEC = Object.freeze({
  gameId: GAME_ID,
  schemaVersion: SAVE_SCHEMA_VERSION,
  migrations: MIGRATIONS,
  buildBody,
  validateBody: validateSimBody,
})
