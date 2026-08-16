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
import { applyUpgrades } from './profile.js'
import { equippedAffixes } from './inventory.js'

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

/**
 * The base stat block for a run, i.e. BASE_PLAYER plus the meta upgrades the
 * run was STARTED with. Reads runMeta (an immutable snapshot), never live
 * profile state — see the determinism rule in sim/profile.js.
 *
 * @param {{ upgrades?: Object<string, number> }} [runMeta]
 * @returns {object} base stats for this run
 */
export const baseForRun = (runMeta) =>
  applyUpgrades(BASE_PLAYER, runMeta?.upgrades)

/**
 * Every affix affecting the player: equipped gear plus affixes picked at gates
 * this run. Gear first so item mods read before run mods in any UI.
 *
 * This is the ONE place the two sources are combined — see the stat-ownership
 * rule in docs/sim/engine.md.
 *
 * @param {object} equipment - LIVE equipment (SimState.player.equipment)
 * @param {import('./affixes.js').Affix[]} runAffixes
 */
export const allAffixes = (equipment, runAffixes = []) =>
  [...equippedAffixes(equipment), ...runAffixes]

/**
 * Effective stats for a run: base + meta upgrades, with gear and run affixes.
 *
 * Gear is FIXED for the whole run — it comes from the runMeta snapshot taken
 * at run start. The `equipment` parameter exists so callers can be explicit,
 * but nothing should pass anything other than the run's own loadout.
 * See docs/sim/items.md for why the loadout is static per run.
 */
export const statsForRun = (runMeta, runAffixes = [], equipment = runMeta?.equipment) =>
  derivePlayerStats(allAffixes(equipment, runAffixes), baseForRun(runMeta))
