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
import { deriveStats, AFFIX_POOL } from './affixes.js'
import { createPity } from './pity.js'
import { generateGate, resolveGate } from './gate.js'
import { calcDamage, aggregateDamageModifiers } from './damage.js'
import { autoPickGate } from './autopilot.js'

// ── Base player stats (before affixes) ──────────────────────────────────────
const BASE_PLAYER = {
  damage: 10,
  attackSpeed: 1000,   // ms between attacks
  attackRange: 8,
  speed: 0.15,
  critChance: 0,
  critMult: 1.5,
  maxHp: 100,
  regen: 0,
  lifeSteal: 0,
  magnetRadius: 5,
  xpMult: 1,
}

// ── Enemy templates for the ledge zone ──────────────────────────────────────
const ENEMY_TEMPLATES = {
  basic:   { hp: 30,  damage: 5,  speed: 0.04, xp: 5  },
  fast:    { hp: 15,  damage: 3,  speed: 0.08, xp: 4  },
  tank:    { hp: 100, damage: 10, speed: 0.02, xp: 15 },
  swarm:   { hp: 8,   damage: 2,  speed: 0.06, xp: 2  },
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

// ── ID counter (reset per run, stored in state) ──────────────────────────────
let _nextId = 1
const newId = () => _nextId++

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
 */

/**
 * @typedef {Object} PlayerSim
 * @property {number} hp
 * @property {number} maxHp
 * @property {import('./affixes.js').Affix[]} affixes
 * @property {number} gold
 * @property {number} xp
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
 * @property {PlayerSim} player
 * @property {EnemyData[]} enemies
 * @property {import('./gate.js').Gate|null} gate
 * @property {import('./pity.js').PityState} pity
 * @property {object[]} log
 */

/**
 * Create a fresh run state from a seed.
 * @param {number} seed
 * @returns {SimState}
 */
export const createState = (seed) => {
  _nextId = 1
  const rng = createRNG(seed)
  const pity = createPity()
  const enemies = spawnWave(1, rng)

  return {
    seed,
    rng,
    tick: 0,
    elapsed: 0,
    phase: 'combat',
    depth: 1,

    player: {
      hp: BASE_PLAYER.maxHp,
      maxHp: BASE_PLAYER.maxHp,
      affixes: [],
      gold: 0,
      xp: 0,
      lastAttackTick: 0,
    },

    enemies: enemies.list,
    gate: null,
    pity,
    log: [{ tick: 0, type: 'run_start', payload: { seed, depth: 1 } }],
    _rngAfterSpawn: enemies.rng,
  }
}

// Spawn a wave of enemies around origin, returns { list, rng }
const spawnWave = (depth, rngState) => {
  const { count, types } = waveForDepth(depth)
  const list = []
  let rng = rngState

  for (let i = 0; i < count; i++) {
    // Pick type
    let typeRng
    ;[typeRng, rng] = [rng, rng]  // reassign below
    const typeIdx = Math.floor(i / Math.max(1, Math.floor(count / types.length))) % types.length
    const type = types[typeIdx]
    const tmpl = ENEMY_TEMPLATES[type]

    // Scatter around origin circle, radius 12-18
    let angle, dist
    ;[angle, rng] = next(rng)
    ;[dist, rng] = next(rng)
    angle = angle * Math.PI * 2
    dist = 12 + dist * 6

    list.push({
      id: newId(),
      type,
      hp: tmpl.hp,
      maxHp: tmpl.hp,
      x: Math.cos(angle) * dist,
      z: Math.sin(angle) * dist,
      damage: tmpl.damage,
      speed: tmpl.speed,
      xp: tmpl.xp,
    })
  }

  return { list, rng }
}

/**
 * Advance sim by one frame.
 * @param {SimState} state
 * @param {number} deltaMs
 * @param {{ gateChoice: number|null, autopilot: boolean }} input
 * @returns {SimState}
 */
export const tick = (state, deltaMs, input = {}) => {
  if (state.phase === 'dead') return state

  const { gateChoice = null, autopilot = true } = input

  let s = {
    ...state,
    tick: state.tick + 1,
    elapsed: state.elapsed + deltaMs,
  }

  // ── GATE PHASE ─────────────────────────────────────────────────────────────
  if (s.phase === 'gate') {
    const choice = gateChoice !== null ? gateChoice
                 : autopilot           ? autoPickGate(s.gate, s)
                 : null

    if (choice !== null) {
      s = resolveGate(s, choice)
      // Spawn next wave
      const wave = spawnWave(s.depth, s.rng)
      s = {
        ...s,
        enemies: wave.list,
        rng: wave.rng,
        log: [...s.log, { tick: s.tick, type: 'wave_start', payload: { depth: s.depth } }]
      }
    }
    return s
  }

  // ── COMBAT PHASE ───────────────────────────────────────────────────────────
  let rng = s.rng
  let player = { ...s.player }
  let enemies = s.enemies.map(e => ({ ...e }))
  const log = [...s.log]

  // Derive effective stats from affixes
  const stats = deriveStats(BASE_PLAYER, player.affixes)

  // HP regen
  if (stats.regen > 0) {
    player.hp = Math.min(player.maxHp, player.hp + stats.regen * (deltaMs / 1000))
  }

  // Move enemies toward player origin (0, 0)
  enemies = enemies.map(e => {
    const dx = -e.x
    const dz = -e.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist < 0.5) return e  // already at player
    const move = e.speed * deltaMs
    return {
      ...e,
      x: e.x + (dx / dist) * move,
      z: e.z + (dz / dist) * move,
    }
  })

  // Enemy melee hits (within range 1.0)
  enemies = enemies.filter(e => {
    const dist = Math.sqrt(e.x * e.x + e.z * e.z)
    if (dist < 1.0) {
      player.hp -= e.damage
      log.push({ tick: s.tick, type: 'enemy_hit', payload: { id: e.id, damage: e.damage } })
      return false  // consumed on hit
    }
    return true
  })

  // Auto-attack: fire at nearest enemy within range
  const attackIntervalTicks = Math.max(5, Math.round(stats.attackSpeed / 16.67))
  const ticksSinceAttack = s.tick - player.lastAttackTick
  if (ticksSinceAttack >= attackIntervalTicks && enemies.length > 0) {
    // Find nearest
    let nearest = null
    let nearestDist = Infinity
    for (const e of enemies) {
      const d = Math.sqrt(e.x * e.x + e.z * e.z)
      if (d <= stats.attackRange && d < nearestDist) {
        nearest = e
        nearestDist = d
      }
    }

    if (nearest) {
      const dmgParams = {
        base: stats.damage,
        ...aggregateDamageModifiers(player.affixes),
        rngState: rng
      }
      const [damage, nextRng, wasCrit] = calcDamage(dmgParams)
      rng = nextRng

      nearest = { ...nearest, hp: nearest.hp - damage }
      log.push({ tick: s.tick, type: 'player_attack', payload: { targetId: nearest.id, damage, wasCrit } })

      if (nearest.hp <= 0) {
        // Kill
        player.xp += nearest.xp
        if (stats.lifeSteal > 0) {
          player.hp = Math.min(stats.maxHp, player.hp + stats.lifeSteal)
        }
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
    return { ...s, player, enemies, rng, log, phase: 'dead' }
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
      pity: newPity,
      log,
      phase: 'gate',
      depth: newDepth,
      gate,
    }
  }

  return { ...s, player, enemies, rng, log }
}

/**
 * @param {SimState} state
 * @returns {boolean}
 */
export const isRunOver = (state) => state.phase === 'dead'
