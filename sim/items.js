/**
 * sim/items.js — Item generation (pure, seeded)
 *
 * Items are the second progression track: the gate gives you affixes over
 * TIME within a run, items give you affixes across SLOTS and persist between
 * runs. Both feed the same stat derivation.
 *
 * Item affixes are stored compactly as `{ id, delta }` — that is everything
 * deriveStats() and aggregateDamageModifiers() read, so an item needs no
 * hydration to be mechanically correct. Names/descriptions for UI are looked
 * up on demand via affixMeta(); an affix removed from the pool degrades to a
 * still-functional item with an unknown label rather than breaking a save.
 *
 * Generation is seeded and threads rng state like everything else in sim/,
 * so a run's drops replay identically.
 */

import { AFFIX_POOL, rollAffix } from './affixes.js'
import { createPity } from './pity.js'
import { next, weightedPick } from './rng.js'

/** Equipment slots. ring1/ring2 are distinct slots holding the same item kind. */
export const SLOTS = [
  'head', 'chest', 'hands', 'legs', 'feet',
  'weapon', 'offhand', 'ring1', 'ring2', 'amulet',
]

/** Slots an item of a given kind may occupy (rings fit either ring slot). */
export const slotAccepts = (slot, item) =>
  !!item && (item.slot === slot || (item.slot === 'ring' && (slot === 'ring1' || slot === 'ring2')))

/** The kind recorded on a generated item — rings are generic until equipped. */
const ITEM_KINDS = [
  { kind: 'head',   weight: 10 },
  { kind: 'chest',  weight: 10 },
  { kind: 'hands',  weight: 10 },
  { kind: 'legs',   weight: 10 },
  { kind: 'feet',   weight: 10 },
  { kind: 'weapon', weight: 12 },
  { kind: 'offhand', weight: 8 },
  { kind: 'ring',   weight: 12 },
  { kind: 'amulet', weight: 8 },
]

/** Rarity drives how many affixes an item rolls. */
export const RARITIES = [
  { id: 'common',    weight: 60, affixes: 1, color: '#b8b8b8' },
  { id: 'uncommon',  weight: 25, affixes: 2, color: '#4caf50' },
  { id: 'rare',      weight: 10, affixes: 3, color: '#3f8cff' },
  { id: 'epic',      weight: 4,  affixes: 4, color: '#a24cff' },
  { id: 'legendary', weight: 1,  affixes: 5, color: '#ffb300' },
]

const RARITY_BY_ID = Object.fromEntries(RARITIES.map(r => [r.id, r]))
export const rarityInfo = (id) => RARITY_BY_ID[id] ?? RARITY_BY_ID.common

/** Item drop chance per enemy type — mirrors CONFIG.items.dropChances. */
export const ITEM_DROPS = {
  basic: 0.05,
  fast:  0.08,
  tank:  0.12,
  swarm: 0.03,
}

// Items don't participate in gate pity — a neutral pity state gives every
// affix its natural weight (boost = 1).
const NO_PITY = createPity()

/**
 * Roll one item.
 *
 * @param {number} rngState
 * @param {{ ilvl?: number, uid?: number, kind?: string, sourceId?: string|null }} [opts]
 * @returns {[object, number]} [item, nextRngState]
 */
export const rollItem = (rngState, opts = {}) => {
  const { ilvl = 1, uid = 0, kind = null, sourceId = null } = opts
  let rng = rngState

  let itemKind = kind
  if (!itemKind) {
    const [picked, r] = weightedPick(rng, ITEM_KINDS)
    rng = r
    itemKind = picked.kind
  }

  const [rarity, r2] = weightedPick(rng, RARITIES)
  rng = r2

  // Rings/amulets can't roll slot-restricted armour affixes and vice versa —
  // slotPool filtering happens inside rollAffix via resolvePool.
  const slotType = itemKind === 'ring' ? 'ring1' : itemKind
  const affixes = []
  const usedIds = []
  for (let i = 0; i < rarity.affixes; i++) {
    const [affix, r3] = rollAffix(rng, NO_PITY, null, usedIds, { wave: ilvl, slotType, sourceId })
    rng = r3
    usedIds.push(affix.id)
    affixes.push({ id: affix.id, delta: { ...affix.delta } })
  }

  return [{ uid, kind: itemKind, slot: itemKind, rarity: rarity.id, ilvl, affixes }, rng]
}

/**
 * Roll a possible item drop for a killed enemy.
 * Unknown types never drop and consume no rng.
 *
 * @returns {[object|null, number]} [item or null, nextRngState]
 */
export const rollItemDrop = (type, rngState, opts = {}) => {
  const chance = ITEM_DROPS[type]
  if (chance === undefined) return [null, rngState]

  const [roll, s1] = next(rngState)
  if (roll >= chance * (opts.mult ?? 1)) return [null, s1]

  return rollItem(s1, opts)
}

/** Pool metadata (name/desc/tags) for an item affix, for UI only. */
export const affixMeta = (id) =>
  AFFIX_POOL.find(a => a.id === id) ?? { id, name: id, desc: '(unknown affix)', tags: [] }

/** Human-readable item label. Cosmetic only — never a save key. */
export const itemName = (item) => {
  if (!item) return ''
  const lead = item.affixes[0]
  const label = lead ? affixMeta(lead.id).name : 'Plain'
  return `${label} ${item.kind}`
}

/**
 * Rough power score — used for autopilot/auto-equip comparisons and for
 * showing the player which of two items is likely better. Sums the magnitude
 * of every delta, weighted so multiplicative mods aren't undervalued.
 */
export const itemScore = (item) => {
  if (!item) return 0
  let score = 0
  for (const { delta } of item.affixes) {
    for (const [key, value] of Object.entries(delta)) {
      if (key === 'speedMult' || key === 'attackSpeedMult') {
        score += Math.abs(1 - value) * 100
      } else if (key === 'critChance') {
        score += value * 100
      } else {
        score += Math.abs(value)
      }
    }
  }
  return Math.round(score * 10) / 10
}
