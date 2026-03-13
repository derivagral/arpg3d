/**
 * sim/affixes.js — Universal affix pool and selection logic
 *
 * AFFIX_POOL is the single source of truth for all build modifiers.
 * Every item drop, gate offer, and reward draws from this pool.
 * Tags are the universal language: pity tracks them, autopilot scores them,
 * gates can filter on them.
 *
 * Affix schema:
 *   id:         unique string key
 *   name:       display name
 *   desc:       one-liner shown in gate UI
 *   tags:       string[] — determines pity tracking, gate filtering, autopilot scoring
 *   category:   'offense' | 'defense' | 'utility'
 *   weight:     base selection weight (before pity boost)
 *   value:      numeric magnitude for autopilot scoring (higher = autopilot prefers it)
 *   delta:      base stat changes (reduced to ~42% of full power; wave scaling restores them)
 *   minIlvl:    minimum item level required (0 = always available)
 *   slotPool:   null = general (all slots), or string[] of slot names for slot-specific affixes
 *   sourcePool: null = general drops, or string[] of source identifiers (boss ids, etc.)
 */

import { weightedPick } from './rng.js'
import { getPityBoost } from './pity.js'

/** Identity values for multiplicative stats — used by wave scaling */
export const MULT_IDENTITY = { speedMult: 1.0, attackSpeedMult: 1.0 }

/** Default wave scaling factor (matches CONFIG.items.scaling.scaleFactor in legacy layer) */
export const DEFAULT_SCALE_FACTOR = 0.197

/** @type {Array<Affix>} */
export const AFFIX_POOL = [
  // ── OFFENSE ──────────────────────────────────────────────────────────────
  {
    id: 'flat_dmg_1',
    name: 'Serrated Edge',
    desc: '+2 flat damage',
    tags: ['damage', 'flat', 'melee'],
    category: 'offense',
    weight: 10,
    value: 5,
    delta: { flatDamage: 2 },
    minIlvl: 0, slotPool: null, sourcePool: null
  },
  {
    id: 'flat_dmg_2',
    name: 'Whetted Blade',
    desc: '+5 flat damage',
    tags: ['damage', 'flat', 'melee'],
    category: 'offense',
    weight: 6,
    value: 12,
    delta: { flatDamage: 5 },
    minIlvl: 5, slotPool: null, sourcePool: null
  },
  {
    id: 'inc_dmg_1',
    name: 'Bloodlust',
    desc: '8% increased damage',
    tags: ['damage', 'increased', 'melee'],
    category: 'offense',
    weight: 8,
    value: 8,
    delta: { increased: 8 },
    minIlvl: 0, slotPool: null, sourcePool: null
  },
  {
    id: 'inc_dmg_2',
    name: 'Fury',
    desc: '17% increased damage',
    tags: ['damage', 'increased', 'melee'],
    category: 'offense',
    weight: 5,
    value: 14,
    delta: { increased: 17 },
    minIlvl: 5, slotPool: null, sourcePool: null
  },
  {
    id: 'more_dmg_1',
    name: 'Execute',
    desc: '6% more damage',
    tags: ['damage', 'more', 'melee'],
    category: 'offense',
    weight: 5,
    value: 12,
    delta: { more: 6 },
    minIlvl: 0, slotPool: null, sourcePool: null
  },
  {
    id: 'attack_speed_1',
    name: 'Swift Strikes',
    desc: '6% faster attack speed',
    tags: ['attackSpeed', 'utility', 'melee'],
    category: 'offense',
    weight: 8,
    value: 7,
    delta: { attackSpeedMult: 0.937 },  // multiplied against base ms (lower = faster)
    minIlvl: 0, slotPool: null, sourcePool: null
  },
  {
    id: 'attack_speed_2',
    name: 'Frenzy',
    desc: '10% faster attack speed',
    tags: ['attackSpeed', 'utility', 'melee'],
    category: 'offense',
    weight: 4,
    value: 11,
    delta: { attackSpeedMult: 0.895 },
    minIlvl: 5, slotPool: null, sourcePool: null
  },
  {
    id: 'crit_chance_1',
    name: 'Eagle Eye',
    desc: '+3% critical strike chance',
    tags: ['crit', 'damage', 'precision'],
    category: 'offense',
    weight: 7,
    value: 9,
    delta: { critChance: 0.03 },
    minIlvl: 0, slotPool: null, sourcePool: null
  },
  {
    id: 'crit_chance_2',
    name: 'Deadeye',
    desc: '+8% critical strike chance',
    tags: ['crit', 'damage', 'precision'],
    category: 'offense',
    weight: 4,
    value: 16,
    delta: { critChance: 0.08 },
    minIlvl: 5, slotPool: null, sourcePool: null
  },
  {
    id: 'crit_mult_1',
    name: 'Mortal Blow',
    desc: '+20% critical strike multiplier',
    tags: ['crit', 'damage', 'precision'],
    category: 'offense',
    weight: 5,
    value: 10,
    delta: { critMult: 0.2 },  // added to base 1.5x
    minIlvl: 0, slotPool: null, sourcePool: null
  },

  // ── DEFENSE ──────────────────────────────────────────────────────────────
  {
    id: 'max_hp_1',
    name: 'Fortification',
    desc: '+12 max health',
    tags: ['maxHp', 'defense', 'life'],
    category: 'defense',
    weight: 10,
    value: 6,
    delta: { maxHp: 12 },
    minIlvl: 0, slotPool: null, sourcePool: null
  },
  {
    id: 'max_hp_2',
    name: 'Iron Will',
    desc: '+29 max health',
    tags: ['maxHp', 'defense', 'life'],
    category: 'defense',
    weight: 5,
    value: 11,
    delta: { maxHp: 29 },
    minIlvl: 5, slotPool: null, sourcePool: null
  },
  {
    id: 'regen_1',
    name: 'Second Wind',
    desc: '+1 HP regen per second',
    tags: ['regen', 'defense', 'life'],
    category: 'defense',
    weight: 7,
    value: 7,
    delta: { regen: 1 },
    minIlvl: 0, slotPool: null, sourcePool: null
  },
  {
    id: 'regen_2',
    name: 'Unbreakable',
    desc: '+2.5 HP regen per second',
    tags: ['regen', 'defense', 'life'],
    category: 'defense',
    weight: 4,
    value: 13,
    delta: { regen: 2.5 },
    minIlvl: 5, slotPool: null, sourcePool: null
  },
  {
    id: 'life_steal_1',
    name: 'Vampiric',
    desc: '+1 life on kill',
    tags: ['lifeSteal', 'defense', 'life'],
    category: 'defense',
    weight: 6,
    value: 7,
    delta: { lifeSteal: 1 },
    minIlvl: 0, slotPool: null, sourcePool: null
  },

  // ── UTILITY ──────────────────────────────────────────────────────────────
  {
    id: 'speed_1',
    name: 'Fleet Foot',
    desc: '+6% movement speed',
    tags: ['speed', 'mobility', 'utility'],
    category: 'utility',
    weight: 8,
    value: 6,
    delta: { speedMult: 1.063 },
    minIlvl: 0, slotPool: null, sourcePool: null
  },
  {
    id: 'speed_2',
    name: 'Windrunner',
    desc: '+13% movement speed',
    tags: ['speed', 'mobility', 'utility'],
    category: 'utility',
    weight: 4,
    value: 10,
    delta: { speedMult: 1.126 },
    minIlvl: 5, slotPool: null, sourcePool: null
  },
  {
    id: 'range_1',
    name: 'Far Reach',
    desc: '+1 attack range',
    tags: ['range', 'utility', 'melee'],
    category: 'utility',
    weight: 7,
    value: 6,
    delta: { attackRange: 1 },
    minIlvl: 0, slotPool: null, sourcePool: null
  },
  {
    id: 'magnet_1',
    name: 'Magnetism',
    desc: '+2 pickup magnet radius',
    tags: ['magnet', 'utility', 'quality'],
    category: 'utility',
    weight: 6,
    value: 4,
    delta: { magnetRadius: 2 },
    minIlvl: 0, slotPool: null, sourcePool: null
  },
  {
    id: 'xp_1',
    name: 'Studious',
    desc: '+8% XP gain',
    tags: ['xp', 'utility', 'quality'],
    category: 'utility',
    weight: 6,
    value: 5,
    delta: { xpMult: 0.08 },
    minIlvl: 0, slotPool: null, sourcePool: null
  }

  // ── SLOT-SPECIFIC (future) ──────────────────────────────────────────────
  // Add entries with slotPool: ['feet'] etc.

  // ── SOURCE-SPECIFIC (future) ────────────────────────────────────────────
  // Add entries with sourcePool: ['boss_skeleton_king'] etc.
]

/** All unique tags that appear in the pool — used by pity for drought tracking */
export const ALL_TAGS = [...new Set(AFFIX_POOL.flatMap(a => a.tags))]

/**
 * Scale an affix's delta values based on wave number.
 * Additive stats scale linearly; multiplicative stats scale the magnitude from identity.
 *
 * @param {object} baseDelta
 * @param {number} wave
 * @param {number} scaleFactor
 * @returns {object} scaled delta
 */
export const scaleAffixDelta = (baseDelta, wave, scaleFactor = DEFAULT_SCALE_FACTOR) => {
  const multiplier = 1 + (wave - 1) * scaleFactor
  const scaled = {}
  for (const [key, value] of Object.entries(baseDelta)) {
    if (key in MULT_IDENTITY) {
      const identity = MULT_IDENTITY[key]
      scaled[key] = identity + (value - identity) * multiplier
    } else {
      scaled[key] = Math.round(value * multiplier * 100) / 100
    }
  }
  return scaled
}

/**
 * Resolve the available affix pool for a given slot, item level, and source.
 *
 * @param {string|null} slotType - equipment slot, or null for unrestricted
 * @param {number} ilvl - item level
 * @param {string|null} sourceId - drop source identifier, or null for general
 * @returns {Affix[]}
 */
export const resolvePool = (slotType = null, ilvl = 0, sourceId = null) => {
  return AFFIX_POOL.filter(a => {
    if ((a.minIlvl || 0) > ilvl) return false
    if (a.slotPool !== null && (!slotType || !a.slotPool.includes(slotType))) return false
    if (a.sourcePool !== null && (!sourceId || !a.sourcePool.includes(sourceId))) return false
    return true
  })
}

/**
 * Roll one affix from the pool, applying pity boost weights.
 * Optionally filter to only affixes containing at least one of filterTags.
 * Affixes the player already has at max stacks can also be filtered out.
 *
 * @param {number} rngState
 * @param {PityState} pity
 * @param {string[]|null} filterTags  - null = unrestricted
 * @param {string[]} excludeIds       - affix IDs to skip (already maxed, etc.)
 * @param {object} [opts]             - optional: { wave, slotType, sourceId }
 * @returns {[Affix, number]} [affix, nextRngState]
 */
export const rollAffix = (rngState, pity, filterTags = null, excludeIds = [], opts = {}) => {
  const { wave = 1, slotType = null, sourceId = null } = opts

  // Start with pool filtered by ilvl/slot/source
  let pool = resolvePool(slotType, wave, sourceId)

  // Apply ID exclusions
  pool = pool.filter(a => !excludeIds.includes(a.id))

  // Apply tag filter
  if (filterTags && filterTags.length > 0) {
    pool = pool.filter(a => a.tags.some(t => filterTags.includes(t)))
  }
  if (pool.length === 0) pool = AFFIX_POOL  // fallback: never return null

  // Apply pity boost to each candidate's weight
  const weighted = pool.map(affix => ({
    ...affix,
    weight: affix.tags.reduce(
      (best, tag) => Math.max(best, affix.weight * getPityBoost(pity, tag)),
      affix.weight
    )
  }))

  const [affix, nextRng] = weightedPick(rngState, weighted)

  // If wave > 1, scale the delta on the picked affix
  if (wave > 1) {
    const scaledAffix = { ...affix, delta: scaleAffixDelta(affix.delta, wave) }
    return [scaledAffix, nextRng]
  }

  return [affix, nextRng]
}

/**
 * Derive effective player stats from base stats and collected affixes.
 * Additive stats sum; multiplicative stats compound.
 *
 * @param {object} base - base stats object
 * @param {Affix[]} affixes
 * @returns {object} derived stats
 */
export const deriveStats = (base, affixes) => {
  const stats = { ...base }
  stats.flatDamage = 0
  stats.increased = 0
  stats.more = []
  stats.critChance = base.critChance ?? 0
  stats.critMult = base.critMult ?? 1.5

  for (const affix of affixes) {
    const d = affix.delta
    if (d.flatDamage)     stats.flatDamage   += d.flatDamage
    if (d.increased)      stats.increased    += d.increased
    if (d.more)           stats.more.push(d.more)
    if (d.critChance)     stats.critChance    = Math.min(1, stats.critChance + d.critChance)
    if (d.critMult)       stats.critMult     += d.critMult
    if (d.maxHp)          stats.maxHp        += d.maxHp
    if (d.regen)          stats.regen        += d.regen
    if (d.lifeSteal)      stats.lifeSteal    += d.lifeSteal
    if (d.attackRange)    stats.attackRange  += d.attackRange
    if (d.magnetRadius)   stats.magnetRadius += d.magnetRadius
    if (d.xpMult)         stats.xpMult        = (stats.xpMult ?? 1) + d.xpMult
    if (d.speedMult)      stats.speed         = (stats.speed ?? base.speed) * d.speedMult
    if (d.attackSpeedMult) {
      stats.attackSpeed = (stats.attackSpeed ?? base.attackSpeed) * d.attackSpeedMult
    }
  }

  return stats
}
