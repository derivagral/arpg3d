/**
 * sim/affixes.js — Universal affix pool and selection logic
 *
 * AFFIX_POOL is the single source of truth for all build modifiers.
 * Every item drop, gate offer, and reward draws from this pool.
 * Tags are the universal language: pity tracks them, autopilot scores them,
 * gates can filter on them.
 *
 * Affix schema:
 *   id:       unique string key
 *   name:     display name
 *   desc:     one-liner shown in gate UI
 *   tags:     string[] — determines pity tracking, gate filtering, autopilot scoring
 *   category: 'offense' | 'defense' | 'utility'
 *   weight:   base selection weight (before pity boost)
 *   value:    numeric magnitude for autopilot scoring (higher = autopilot prefers it)
 *   delta:    stat changes applied to player when this affix is held
 *             keys match deriveStats() consumption in this module
 */

import { weightedPick } from './rng.js'
import { getPityBoost } from './pity.js'

/** @type {Array<Affix>} */
export const AFFIX_POOL = [
  // ── OFFENSE ──────────────────────────────────────────────────────────────
  {
    id: 'flat_dmg_1',
    name: 'Serrated Edge',
    desc: '+5 flat damage',
    tags: ['damage', 'flat', 'melee'],
    category: 'offense',
    weight: 10,
    value: 5,
    delta: { flatDamage: 5 }
  },
  {
    id: 'flat_dmg_2',
    name: 'Whetted Blade',
    desc: '+12 flat damage',
    tags: ['damage', 'flat', 'melee'],
    category: 'offense',
    weight: 6,
    value: 12,
    delta: { flatDamage: 12 }
  },
  {
    id: 'inc_dmg_1',
    name: 'Bloodlust',
    desc: '20% increased damage',
    tags: ['damage', 'increased', 'melee'],
    category: 'offense',
    weight: 8,
    value: 8,
    delta: { increased: 20 }
  },
  {
    id: 'inc_dmg_2',
    name: 'Fury',
    desc: '40% increased damage',
    tags: ['damage', 'increased', 'melee'],
    category: 'offense',
    weight: 5,
    value: 14,
    delta: { increased: 40 }
  },
  {
    id: 'more_dmg_1',
    name: 'Execute',
    desc: '15% more damage',
    tags: ['damage', 'more', 'melee'],
    category: 'offense',
    weight: 5,
    value: 12,
    delta: { more: 15 }
  },
  {
    id: 'attack_speed_1',
    name: 'Swift Strikes',
    desc: '15% faster attack speed',
    tags: ['attackSpeed', 'utility', 'melee'],
    category: 'offense',
    weight: 8,
    value: 7,
    delta: { attackSpeedMult: 0.85 }  // multiplied against base ms (lower = faster)
  },
  {
    id: 'attack_speed_2',
    name: 'Frenzy',
    desc: '25% faster attack speed',
    tags: ['attackSpeed', 'utility', 'melee'],
    category: 'offense',
    weight: 4,
    value: 11,
    delta: { attackSpeedMult: 0.75 }
  },
  {
    id: 'crit_chance_1',
    name: 'Eagle Eye',
    desc: '+8% critical strike chance',
    tags: ['crit', 'damage', 'precision'],
    category: 'offense',
    weight: 7,
    value: 9,
    delta: { critChance: 0.08 }
  },
  {
    id: 'crit_chance_2',
    name: 'Deadeye',
    desc: '+18% critical strike chance',
    tags: ['crit', 'damage', 'precision'],
    category: 'offense',
    weight: 4,
    value: 16,
    delta: { critChance: 0.18 }
  },
  {
    id: 'crit_mult_1',
    name: 'Mortal Blow',
    desc: '+50% critical strike multiplier',
    tags: ['crit', 'damage', 'precision'],
    category: 'offense',
    weight: 5,
    value: 10,
    delta: { critMult: 0.5 }  // added to base 1.5x
  },

  // ── DEFENSE ──────────────────────────────────────────────────────────────
  {
    id: 'max_hp_1',
    name: 'Fortification',
    desc: '+30 max health',
    tags: ['maxHp', 'defense', 'life'],
    category: 'defense',
    weight: 10,
    value: 6,
    delta: { maxHp: 30 }
  },
  {
    id: 'max_hp_2',
    name: 'Iron Will',
    desc: '+70 max health',
    tags: ['maxHp', 'defense', 'life'],
    category: 'defense',
    weight: 5,
    value: 11,
    delta: { maxHp: 70 }
  },
  {
    id: 'regen_1',
    name: 'Second Wind',
    desc: '+2 HP regen per second',
    tags: ['regen', 'defense', 'life'],
    category: 'defense',
    weight: 7,
    value: 7,
    delta: { regen: 2 }
  },
  {
    id: 'regen_2',
    name: 'Unbreakable',
    desc: '+6 HP regen per second',
    tags: ['regen', 'defense', 'life'],
    category: 'defense',
    weight: 4,
    value: 13,
    delta: { regen: 6 }
  },
  {
    id: 'life_steal_1',
    name: 'Vampiric',
    desc: '+3 life on kill',
    tags: ['lifeSteal', 'defense', 'life'],
    category: 'defense',
    weight: 6,
    value: 7,
    delta: { lifeSteal: 3 }
  },

  // ── UTILITY ──────────────────────────────────────────────────────────────
  {
    id: 'speed_1',
    name: 'Fleet Foot',
    desc: '+15% movement speed',
    tags: ['speed', 'mobility', 'utility'],
    category: 'utility',
    weight: 8,
    value: 6,
    delta: { speedMult: 1.15 }
  },
  {
    id: 'speed_2',
    name: 'Windrunner',
    desc: '+30% movement speed',
    tags: ['speed', 'mobility', 'utility'],
    category: 'utility',
    weight: 4,
    value: 10,
    delta: { speedMult: 1.30 }
  },
  {
    id: 'range_1',
    name: 'Far Reach',
    desc: '+3 attack range',
    tags: ['range', 'utility', 'melee'],
    category: 'utility',
    weight: 7,
    value: 6,
    delta: { attackRange: 3 }
  },
  {
    id: 'magnet_1',
    name: 'Magnetism',
    desc: '+4 pickup magnet radius',
    tags: ['magnet', 'utility', 'quality'],
    category: 'utility',
    weight: 6,
    value: 4,
    delta: { magnetRadius: 4 }
  },
  {
    id: 'xp_1',
    name: 'Studious',
    desc: '+20% XP gain',
    tags: ['xp', 'utility', 'quality'],
    category: 'utility',
    weight: 6,
    value: 5,
    delta: { xpMult: 0.20 }
  }
]

/** All unique tags that appear in the pool — used by pity for drought tracking */
export const ALL_TAGS = [...new Set(AFFIX_POOL.flatMap(a => a.tags))]

/**
 * Roll one affix from the pool, applying pity boost weights.
 * Optionally filter to only affixes containing at least one of filterTags.
 * Affixes the player already has at max stacks can also be filtered out.
 *
 * @param {number} rngState
 * @param {PityState} pity
 * @param {string[]|null} filterTags  - null = unrestricted
 * @param {string[]} excludeIds       - affix IDs to skip (already maxed, etc.)
 * @returns {[Affix, number]} [affix, nextRngState]
 */
export const rollAffix = (rngState, pity, filterTags = null, excludeIds = []) => {
  let pool = AFFIX_POOL.filter(a => !excludeIds.includes(a.id))
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

  return weightedPick(rngState, weighted)
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
