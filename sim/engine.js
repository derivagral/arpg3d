/**
 * sim/engine.js — Primary tick loop and state factory
 *
 * This is the heart of the sim. ALL game logic goes through tick().
 * Babylon.js (or any other renderer) reads the returned state and
 * updates visuals — it never writes back.
 *
 * Phase machine:
 *   'combat' → enemies alive, player auto-attacks, hp changes happen
 *             → when all enemies die: depth++ → 'gate' phase
 *   'gate'   → waiting for player (or autopilot) to pick an affix
 *             → on pick: → 'combat' with next wave
 *   'dead'   → player hp <= 0, tick() is a no-op, run is over
 *
 * tick() is pure: (state, deltaMs, input) → newState
 * Same sequence of inputs from same seed → identical state sequence.
 */

import { createRNG, next, nextInt } from './rng.js'
import { AFFIX_POOL } from './affixes.js'
import { BASE_PLAYER, derivePlayerStats, baseForRun, statsForRun, allAffixes } from './player.js'
import { runMetaFor, createProfile } from './profile.js'
import { createPity } from './pity.js'
import { generateGate, resolveGate, rerollGate } from './gate.js'
import { rollGoldDrop } from './gold.js'
import { rollItemDrop } from './items.js'
import { createInventory, addItem } from './inventory.js'
import { calcDamage, aggregateDamageModifiers } from './damage.js'
import { autoPickGate } from './autopilot.js'
import { resolveMove, clampToArena } from './movement.js'

export { BASE_PLAYER }

/**
 * Max enemies that can occupy melee contact simultaneously (surround limit).
 * Without this, incoming dps scales with wave size — every enemy converges on
 * one point and swings at once. Overflow enemies crowd but cannot attack.
 */
export const ENGAGEMENT_SLOTS = 5

// ── Enemy templates for the ledge zone ──────────────────────────────────────
// damage/attackMs are melee swing values: in-range enemies persist and swing
// on this cooldown (per-enemy), subject to ENGAGEMENT_SLOTS.
//
// Speed is balanced against BASE_PLAYER.speed (0.15) so movement is a real
// tradeoff rather than free immunity: 'fast' outruns the player and must be
// killed, 'swarm' nearly matches and overwhelms by number, while 'basic' and
// 'tank' are kiteable. If every enemy were slower than the player, any
// movement policy would be unkillable in an open arena.
export const ENEMY_TEMPLATES = {
  basic:   { hp: 20, damage: 3, speed: 0.06,  xp: 5,  attackMs: 2000 },
  fast:    { hp: 10, damage: 2, speed: 0.17,  xp: 4,  attackMs: 1200 },
  tank:    { hp: 70, damage: 8, speed: 0.035, xp: 15, attackMs: 3500 },
  swarm:   { hp: 6,  damage: 1, speed: 0.13,  xp: 2,  attackMs: 1200 },
}

// Enemies per depth tier
const waveForDepth = (depth) => {
  const base = 5 + depth * 3
  const types = depth <= 2 ? ['basic'] :
                depth <= 4 ? ['basic', 'fast'] :
                depth <= 6 ? ['basic', 'fast', 'tank'] :
                             ['basic', 'fast', 'tank', 'swarm']
  return { count: base, types }
}

/**
 * @typedef {Object} EnemyData
 * @property {number} id
 * @property {string} type
 * @property {number} hp
 * @property {number} maxHp
 * @property {number} x
 * @property {number} z
 * @property {number} damage
 * @property {number} speed
 * @property {number} xp
 * @property {number} attackMs     - ms between melee swings while in range
 * @property {number} lastHitTick  - tick of this enemy's last melee swing
 */

/**
 * @typedef {Object} PlayerSim
 * @property {number} hp
 * @property {number} maxHp   - cache of derivePlayerStats().maxHp, never accumulated directly
 * @property {number} x
 * @property {number} z
 * @property {number} waypoint - patrol circuit index
 * @property {import('./affixes.js').Affix[]} affixes
 * @property {number} gold
 * @property {number} xp
 * @property {Object<string, number>} kills - per-enemy-type kill counts
 * @property {number} lastAttackTick - tick of last auto-attack
 */

/**
 * @typedef {Object} SimState
 * @property {number}   seed
 * @property {number}   rng          - current mulberry32 state
 * @property {number}   tick         - frame count
 * @property {number}   elapsed      - ms since run start
 * @property {string}   phase        - 'combat' | 'gate' | 'dead'
 * @property {number}   depth        - gates completed
 * @property {number}   nextId       - next enemy id (threaded through state for determinism)
 * @property {object}   runMeta      - immutable meta snapshot: { upgrades, policies }
 * @property {PlayerSim} player
 * @property {EnemyData[]} enemies
 * @property {import('./gate.js').Gate|null} gate
 * @property {import('./pity.js').PityState} pity
 * @property {object[]} log
 */

/**
 * Create a fresh run state from a seed.
 *
 * `runMeta` is an immutable snapshot of the character's meta progression at
 * the moment the run starts (see sim/profile.js). Passing a live profile is
 * a bug: a run must never observe meta changes made while it ticks, or
 * replays and offline simulation stop being reproducible.
 *
 * @param {number} seed
 * @param {{ upgrades?: object, policies?: string[] }} [runMeta]
 * @returns {SimState}
 */
export const createState = (seed, runMeta = runMetaFor(createProfile())) => {
  const rng = createRNG(seed)
  const pity = createPity()
  const enemies = spawnWave(1, rng, 1)
  // Starting hp must come from the SAME derivation the tick loop uses, or a
  // geared run begins under-healed: baseForRun() applies meta upgrades but
  // not equipment affixes, so gear-granted maxHp would be missed here and
  // only appear on the first tick, leaving hp clamped below the new max.
  const startStats = statsForRun(runMeta, [])

  return {
    seed,
    rng: enemies.rng,
    tick: 0,
    elapsed: 0,
    phase: 'combat',
    depth: 1,
    nextId: enemies.nextId,
    nextUid: 1,
    runMeta,

    player: {
      hp: startStats.maxHp,
      maxHp: startStats.maxHp,
      x: 0,
      z: 0,
      waypoint: 0,
      affixes: [],
      gold: 0,
      xp: 0,
      kills: {},
      inventory: createInventory(),
      lastAttackTick: 0,
    },

    enemies: enemies.list,
    gate: null,
    pity,
    log: [{ tick: 0, type: 'run_start', payload: { seed, depth: 1 } }],
  }
}

// Spawn a wave of enemies in a ring around the origin (waves start with the
// player recentred). Returns { list, rng, nextId }.
const spawnWave = (depth, rngState, startId) => {
  const { count, types } = waveForDepth(depth)
  const list = []
  let rng = rngState
  let nextId = startId

  for (let i = 0; i < count; i++) {
    const typeIdx = Math.floor(i / Math.max(1, Math.floor(count / types.length))) % types.length
    const type = types[typeIdx]
    const tmpl = ENEMY_TEMPLATES[type]

    // Scatter around origin circle, radius 12-18 (inside ARENA_RADIUS)
    let angle, dist
    ;[angle, rng] = next(rng)
    ;[dist, rng] = next(rng)
    angle = angle * Math.PI * 2
    dist = 12 + dist * 6

    list.push({
      id: nextId++,
      type,
      hp: tmpl.hp,
      maxHp: tmpl.hp,
      x: Math.cos(angle) * dist,
      z: Math.sin(angle) * dist,
      damage: tmpl.damage,
      speed: tmpl.speed,
      xp: tmpl.xp,
      attackMs: tmpl.attackMs,
      lastHitTick: 0,
    })
  }

  return { list, rng, nextId }
}

/**
 * Advance sim by one frame.
 * @param {SimState} state
 * @param {number} deltaMs
 * @param {{ gateChoice: number|null, autopilot: boolean, gateReroll: boolean }} input
 * @returns {SimState}
 */
export const tick = (state, deltaMs, input = {}) => {
  if (state.phase === 'dead') return state

  const { gateChoice = null, autopilot = true, gateReroll = false } = input

  let s = {
    ...state,
    tick: state.tick + 1,
    elapsed: state.elapsed + deltaMs,
  }

  // ── GATE PHASE ─────────────────────────────────────────────────────────────
  if (s.phase === 'gate') {
    // Reroll consumes the frame — the (possibly new) options are picked from
    // on a later tick. Insufficient gold makes rerollGate a no-op.
    if (gateReroll) return rerollGate(s)

    const choice = gateChoice !== null ? gateChoice
                 : autopilot           ? autoPickGate(s.gate, s)
                 : null

    if (choice !== null) {
      s = resolveGate(s, choice)
      // Spawn next wave. The player is recentred so the spawn ring is always
      // drawn around them — waves start as a clean engagement.
      const wave = spawnWave(s.depth, s.rng, s.nextId)
      s = {
        ...s,
        player: { ...s.player, x: 0, z: 0 },
        enemies: wave.list,
        rng: wave.rng,
        nextId: wave.nextId,
        log: [...s.log, { tick: s.tick, type: 'wave_start', payload: { depth: s.depth } }]
      }
    }
    return s
  }

  // ── COMBAT PHASE ───────────────────────────────────────────────────────────
  let rng = s.rng
  let nextUid = s.nextUid ?? 1
  let player = { ...s.player }
  let enemies = s.enemies.map(e => ({ ...e }))
  const log = [...s.log]

  // Derive effective stats from the run's base (BASE_PLAYER + meta upgrades)
  // plus affixes. maxHp is a cache of the derived value — never accumulated
  // onto player state (see sim/player.js).
  const stats = statsForRun(s.runMeta, player.affixes)
  player.maxHp = stats.maxHp
  player.hp = Math.min(player.hp, player.maxHp)

  // HP regen
  if (stats.regen > 0) {
    player.hp = Math.min(player.maxHp, player.hp + stats.regen * (deltaMs / 1000))
  }

  // Player movement: manual input if present, else the active idle policy.
  // The policy is clamped to what this run unlocked — the sim never trusts
  // input.movePolicy to be legitimate.
  const allowed = s.runMeta?.policies
  const moveInput = (input.movePolicy && allowed && !allowed.includes(input.movePolicy))
    ? { ...input, movePolicy: undefined }
    : input
  const [dirX, dirZ, waypoint] = resolveMove(player, enemies, moveInput)
  if (dirX !== 0 || dirZ !== 0) {
    const step = stats.speed * (deltaMs / 16.67)  // units/frame at 60fps
    const [px, pz] = clampToArena(player.x + dirX * step, player.z + dirZ * step)
    player.x = px
    player.z = pz
  }
  player.waypoint = waypoint

  // Move enemies toward the player's current position
  enemies = enemies.map(e => {
    const dx = player.x - e.x
    const dz = player.z - e.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist < 0.5) return e  // already on the player
    const move = e.speed * (deltaMs / 16.67)  // speed is units/frame at 60fps
    return {
      ...e,
      x: e.x + (dx / dist) * move,
      z: e.z + (dz / dist) * move,
    }
  })

  // Credit an enemy death (any cause the player survives): kill count, xp,
  // lifesteal, gold roll. Mutates the local player copy, returns next rng.
  const creditKill = (enemy, rngState) => {
    player.xp += enemy.xp
    player.kills = { ...player.kills, [enemy.type]: (player.kills[enemy.type] ?? 0) + 1 }
    if (stats.lifeSteal > 0) {
      player.hp = Math.min(player.maxHp, player.hp + stats.lifeSteal)
    }
    let nextRng = rngState
    const [gold, goldRng] = rollGoldDrop(enemy.type, nextRng)
    nextRng = goldRng
    if (gold > 0) {
      player.gold += gold
      log.push({ tick: s.tick, type: 'gold_drop', payload: { id: enemy.id, amount: gold } })
    }

    // Item drop. ilvl tracks depth so deeper runs roll stronger affixes.
    const [item, itemRng] = rollItemDrop(enemy.type, nextRng, { ilvl: s.depth, uid: nextUid })
    nextRng = itemRng
    if (item) {
      nextUid++
      const res = addItem(player.inventory, item)
      if (res.added) {
        player.inventory = res.container
        log.push({ tick: s.tick, type: 'item_drop', payload: { uid: item.uid, kind: item.kind, rarity: item.rarity } })
      } else {
        // Full bag: the drop is lost, but say so rather than failing silently.
        log.push({ tick: s.tick, type: 'item_lost', payload: { rarity: item.rarity, reason: 'inventory full' } })
      }
    }
    return nextRng
  }

  // Enemy melee: enemies persist and swing on their own cooldown. Only the
  // ENGAGEMENT_SLOTS closest can attack — a surround limit, without which
  // incoming dps would scale with wave size. Overflow enemies crowd but
  // cannot swing. Only player attacks kill; death-on-contact is gone (it let
  // ehp builds auto-clear waves; may return as a thorns-style player stat).
  const distToPlayer = (e) => Math.hypot(e.x - player.x, e.z - player.z)
  const engaged = new Set(
    enemies
      .filter(e => distToPlayer(e) < 1.0)
      .sort((a, b) => distToPlayer(a) - distToPlayer(b))
      .slice(0, ENGAGEMENT_SLOTS)
      .map(e => e.id)
  )
  enemies = enemies.map(e => {
    if (!engaged.has(e.id)) return e
    const swingTicks = Math.max(5, Math.round(e.attackMs / 16.67))
    if (s.tick - e.lastHitTick < swingTicks) return e
    player.hp -= e.damage
    log.push({ tick: s.tick, type: 'enemy_hit', payload: { id: e.id, damage: e.damage } })
    return { ...e, lastHitTick: s.tick }
  })

  // Auto-attack: fire at nearest enemy within range
  const attackIntervalTicks = Math.max(5, Math.round(stats.attackSpeed / 16.67))
  const ticksSinceAttack = s.tick - player.lastAttackTick
  if (ticksSinceAttack >= attackIntervalTicks && enemies.length > 0) {
    // Find nearest
    let nearest = null
    let nearestDist = Infinity
    for (const e of enemies) {
      const d = distToPlayer(e)
      if (d <= stats.attackRange && d < nearestDist) {
        nearest = e
        nearestDist = d
      }
    }

    if (nearest) {
      const dmgParams = {
        base: stats.damage,
        ...aggregateDamageModifiers(allAffixes(s.runMeta, player.affixes)),
        rngState: rng
      }
      const [damage, nextRng, wasCrit] = calcDamage(dmgParams)
      rng = nextRng

      nearest = { ...nearest, hp: nearest.hp - damage }
      log.push({ tick: s.tick, type: 'player_attack', payload: { targetId: nearest.id, damage, wasCrit } })

      if (nearest.hp <= 0) {
        rng = creditKill(nearest, rng)
        log.push({ tick: s.tick, type: 'enemy_killed', payload: { id: nearest.id, type: nearest.type } })
        enemies = enemies.filter(e => e.id !== nearest.id)
      } else {
        enemies = enemies.map(e => e.id === nearest.id ? nearest : e)
      }

      player.lastAttackTick = s.tick
    }
  }

  // Death check
  if (player.hp <= 0) {
    player.hp = 0
    log.push({ tick: s.tick, type: 'player_dead', payload: { depth: s.depth, elapsed: s.elapsed } })
    return { ...s, player, enemies, rng, nextUid, log, phase: 'dead' }
  }

  // Wave cleared → open gate
  if (enemies.length === 0) {
    const newDepth = s.depth + 1
    const [gate, nextRng, newPity] = generateGate(newDepth, rng, s.pity, player.affixes.map(a => a.id))
    log.push({ tick: s.tick, type: 'gate_open', payload: { depth: newDepth } })
    return {
      ...s,
      player,
      enemies: [],
      rng: nextRng,
      nextUid,
      pity: newPity,
      log,
      phase: 'gate',
      depth: newDepth,
      gate,
    }
  }

  return { ...s, player, enemies, rng, nextUid, log }
}

/**
 * @param {SimState} state
 * @returns {boolean}
 */
export const isRunOver = (state) => state.phase === 'dead'
