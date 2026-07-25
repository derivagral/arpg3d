/**
 * sim/player.js — Base player stats and the single stat-derivation entry point
 *
 * This lives apart from engine.js so that any module which needs to know a
 * player's effective stats (engine tick, gate resolution, future item and
 * meta-progression code) can import it without a circular dependency.
 *
 * IMPORTANT: derivePlayerStats() is the ONLY place effective stats are
 * computed. player.maxHp in SimState is a cache of stats.maxHp, refreshed
 * wherever affixes change. Never accumulate a stat into player state
 * directly — a second accumulation path silently desyncs the two the moment
 * stats can be granted outside a gate (items, echoes, module hooks).
 */

import { deriveStats } from './affixes.js'

/** Base player stats before affixes. */
export const BASE_PLAYER = {
  damage: 20,
  attackSpeed: 800,    // ms between attacks
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

/**
 * Effective stats for a set of affixes.
 * `base` is a parameter so meta-progression (persistent upgrade board) can
 * supply a modified baseline without touching this module.
 *
 * @param {import('./affixes.js').Affix[]} affixes
 * @param {object} [base]
 * @returns {object} derived stats
 */
export const derivePlayerStats = (affixes, base = BASE_PLAYER) =>
  deriveStats(base, affixes)
