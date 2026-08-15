/**
 * sim/profile.js — Persistent per-character meta state (echoes, upgrades, unlocks)
 *
 * A save slot is a CHARACTER, not a run: the slot owns a profile that
 * survives death, and runs are attempts inside it. Deleting a slot deletes
 * its meta with it, and a new slot is a genuine fresh start. Keying profiles
 * this way is also what makes leagues/seasons cheap later — a temporary
 * league is just another profile, not a new storage tier.
 *
 * DETERMINISM RULE: a run never reads profile state while ticking. The
 * profile is snapshotted into the run at creation (SimState.runMeta), so
 *
 *     run = f(seed, runMeta, inputs)
 *
 * stays true. Buying an upgrade mid-run cannot retroactively change a replay,
 * and offline simulation remains reproducible.
 *
 * This module is pure and has no dependency on engine/player — apply*()
 * functions take the base they modify as an argument.
 */

import { createStash, createEquipment, hydrateContainer, hydrateEquipment, addItems, STASH_SIZE } from './inventory.js'

export const PROFILE_VERSION = 1

/** Movement policies available without any unlock. */
export const BASE_POLICIES = ['hold', 'center']

// ── Echo currency ────────────────────────────────────────────────────────────
// Payout has two parts so both play modes stay alive:
//   base — every run pays for the depth it reached, so idle farming is never
//          worthless. The sum is TRIANGULAR (you're paid for each level you
//          passed through), so payout grows with the square of depth and a
//          deep run is worth far more than several shallow ones. A flat
//          per-depth rate made farming a comfortable depth pay the same
//          trickle forever and the board never funded itself.
//   pb   — a one-time bonus per depth level beyond your record, so pushing
//          still beats repeating a safe depth.
export const ECHO_PER_DEPTH = 1
export const ECHO_PB_BONUS = 25

/**
 * @param {number} depth - depth reached this run
 * @param {number} bestDepth - profile's record depth BEFORE this run
 * @returns {{ base: number, pb: number, total: number }}
 */
export const echoesForRun = (depth, bestDepth = 0) => {
  const d = Math.max(0, depth)
  const base = ECHO_PER_DEPTH * (d * (d + 1)) / 2
  const pb = Math.max(0, d - bestDepth) * ECHO_PB_BONUS
  return { base, pb, total: base + pb }
}

// ── Upgrade board ────────────────────────────────────────────────────────────
// Deliberately modest and deliberately NOT damage-dense: items (roadmap step 3)
// are meant to be the power fantasy, and a board that grants big flat damage
// spends the same design budget twice.
//
// NOTE: no upgrade may touch move speed. The movement balance rests on the
// 'fast' archetype (0.17) outrunning the player (0.15); any meta move-speed
// bonus re-creates the bug where every policy becomes unkillable.
// sim/profile.test.js enforces this.
export const UPGRADES = [
  {
    id: 'vitality',
    name: 'Vitality',
    desc: '+8 max health per level',
    maxLevel: 8,
    cost: (level) => 25 + 25 * level,
    apply: (base, level) => ({ maxHp: base.maxHp + 8 * level }),
  },
  {
    id: 'might',
    name: 'Might',
    desc: '+2 base damage per level',
    maxLevel: 8,
    cost: (level) => 30 + 30 * level,
    apply: (base, level) => ({ damage: base.damage + 2 * level }),
  },
  {
    id: 'recovery',
    name: 'Recovery',
    desc: '+0.4 health regen per second per level',
    maxLevel: 5,
    cost: (level) => 40 + 35 * level,
    apply: (base, level) => ({ regen: (base.regen ?? 0) + 0.4 * level }),
  },
  {
    id: 'reach',
    name: 'Reach',
    desc: '+0.5 attack range per level',
    maxLevel: 4,
    cost: (level) => 50 + 40 * level,
    apply: (base, level) => ({ attackRange: base.attackRange + 0.5 * level }),
  },
]

const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map(u => [u.id, u]))

/**
 * Cost to take an upgrade from its current level to the next.
 * @returns {number|null} null if unknown or already maxed
 */
export const upgradeCost = (id, currentLevel = 0) => {
  const up = UPGRADE_BY_ID[id]
  if (!up || currentLevel >= up.maxLevel) return null
  return up.cost(currentLevel)
}

/**
 * Apply purchased upgrade levels to a base stat block.
 * Pure: returns a new object, never mutates `base`.
 *
 * @param {object} base - BASE_PLAYER-shaped stats
 * @param {Object<string, number>} [levels] - { upgradeId: level }
 * @returns {object} modified base stats
 */
export const applyUpgrades = (base, levels = {}) => {
  let out = { ...base }
  for (const up of UPGRADES) {
    const level = levels[up.id] ?? 0
    if (level > 0) out = { ...out, ...up.apply(out, Math.min(level, up.maxLevel)) }
  }
  return out
}

// ── Achievements ─────────────────────────────────────────────────────────────
// The persistent-COMPLETABLE track: finite, checklist-shaped, and the source
// of movement-policy unlocks. Policies are earned, not bought — they read as
// mastery rather than a purchase, and echoes stay the numeric currency.
//
// Threshold tuning is load-bearing and was set empirically:
//   patrol @ 4  — the 'center' default plateaus at depth 4, so the FIRST
//                 death grants patrol. An earlier draft gated it at depth 6,
//                 which no idle run could ever reach: progression deadlocked
//                 at a flat trickle forever. The first unlock must be
//                 reachable by the policy the player already has.
//   kite   @ 20 — patrol reaches ~17-23, so this is a genuine push requiring
//                 a good run plus some board investment (or manual play,
//                 which beats every idle policy).
export const ACHIEVEMENTS = [
  {
    id: 'depth_4',
    name: 'Descent',
    desc: 'Reach depth 4',
    grants: 'policy:patrol',
    test: (p) => p.bestDepth >= 4,
  },
  {
    id: 'depth_20',
    name: 'Evasion',
    desc: 'Reach depth 20',
    grants: 'policy:kite',
    test: (p) => p.bestDepth >= 20,
  },
  {
    id: 'slayer_1000',
    name: 'Slayer',
    desc: 'Kill 1000 enemies lifetime',
    grants: null,
    test: (p) => totalKills(p.lifetime.kills) >= 1000,
  },
  {
    id: 'hoarder_2000',
    name: 'Hoarder',
    desc: 'Earn 2000 gold lifetime',
    grants: null,
    test: (p) => p.lifetime.gold >= 2000,
  },
]

const totalKills = (kills = {}) => Object.values(kills).reduce((a, b) => a + b, 0)

// ── Profile state ────────────────────────────────────────────────────────────

/** @returns {object} a fresh profile */
export const createProfile = () => ({
  v: PROFILE_VERSION,
  echoes: 0,
  spent: 0,
  bestDepth: 0,
  runs: 0,
  lifetime: { kills: {}, gold: 0, depth: 0, elapsed: 0 },
  upgrades: {},
  unlocks: [],
  achievements: [],
  stash: createStash(),
  equipment: createEquipment(),
})

/** Movement policies this profile may use. */
export const unlockedPolicies = (profile) => [
  ...BASE_POLICIES,
  ...(profile?.unlocks ?? [])
    .filter(u => u.startsWith('policy:'))
    .map(u => u.slice('policy:'.length)),
]

/**
 * The immutable snapshot handed to a run at creation.
 * Everything a run needs from meta, and nothing that can change mid-run.
 */
export const runMetaFor = (profile) => ({
  upgrades: { ...(profile?.upgrades ?? {}) },
  policies: unlockedPolicies(profile),
  // The loadout the run is locked into. Equipment lives on the profile and
  // enters a run only here, so gear cannot change mid-run.
  equipment: hydrateEquipment(profile?.equipment),
})

/** Condense a finished run into what the profile cares about. */
export const summarizeRun = (state) => ({
  depth: state.depth,
  kills: { ...state.player.kills },
  gold: state.player.gold,
  elapsed: state.elapsed,
  // Items found this run. They survive death — losing them would make the
  // idle half punishing, and the stash is the whole point of the loop.
  items: (state.player.inventory ?? []).filter(Boolean),
})

/**
 * Fold a finished run into the profile: grant echoes, update lifetime stats
 * and record depth, then evaluate achievements against the updated profile.
 *
 * @param {object} profile
 * @param {{depth:number, kills:object, gold:number, elapsed:number}} summary
 * @returns {{ profile: object, echoes: {base,pb,total}, unlocked: object[] }}
 */
export const awardRun = (profile, summary) => {
  const echoes = echoesForRun(summary.depth, profile.bestDepth)

  const kills = { ...profile.lifetime.kills }
  for (const [type, n] of Object.entries(summary.kills ?? {})) {
    kills[type] = (kills[type] ?? 0) + n
  }

  // Run haul flows into the stash. Overflow is reported, never silently
  // dropped, so a full stash is a visible problem rather than lost loot.
  const haul = addItems(profile.stash ?? createStash(), summary.items ?? [])

  let next = {
    ...profile,
    stash: haul.container,
    echoes: profile.echoes + echoes.total,
    bestDepth: Math.max(profile.bestDepth, summary.depth),
    runs: profile.runs + 1,
    lifetime: {
      kills,
      gold: profile.lifetime.gold + (summary.gold ?? 0),
      depth: profile.lifetime.depth + summary.depth,
      elapsed: profile.lifetime.elapsed + (summary.elapsed ?? 0),
    },
  }

  const unlocked = []
  for (const ach of ACHIEVEMENTS) {
    if (next.achievements.includes(ach.id)) continue
    if (!ach.test(next)) continue
    unlocked.push(ach)
    next = {
      ...next,
      achievements: [...next.achievements, ach.id],
      unlocks: ach.grants && !next.unlocks.includes(ach.grants)
        ? [...next.unlocks, ach.grants]
        : next.unlocks,
    }
  }

  return { profile: next, echoes, unlocked, stashed: haul.added, overflow: haul.overflow }
}

/**
 * Buy one level of an upgrade. No-op (returns the same profile) if the
 * upgrade is unknown, already maxed, or unaffordable.
 *
 * @returns {{ profile: object, bought: boolean, cost: number|null }}
 */
export const purchaseUpgrade = (profile, id) => {
  const level = profile.upgrades[id] ?? 0
  const cost = upgradeCost(id, level)
  if (cost === null || profile.echoes < cost) {
    return { profile, bought: false, cost }
  }
  return {
    profile: {
      ...profile,
      echoes: profile.echoes - cost,
      spent: profile.spent + cost,
      upgrades: { ...profile.upgrades, [id]: level + 1 },
    },
    bought: true,
    cost,
  }
}

/** Normalize an arbitrary stored object into a valid profile (forward-safe). */
export const hydrateProfile = (raw) => {
  const fresh = createProfile()
  if (!raw || typeof raw !== 'object') return fresh
  return {
    ...fresh,
    ...raw,
    lifetime: { ...fresh.lifetime, ...(raw.lifetime ?? {}) },
    upgrades: { ...(raw.upgrades ?? {}) },
    unlocks: [...(raw.unlocks ?? [])],
    achievements: [...(raw.achievements ?? [])],
    stash: hydrateContainer(raw.stash, STASH_SIZE),
    equipment: hydrateEquipment(raw.equipment),
  }
}
