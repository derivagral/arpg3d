/**
 * sim/gold.js — Gold as a first-class sim entity
 *
 * Gold is the run's spendable currency. This module owns everything about
 * it: how it enters the run (kill drops) and what it costs to spend
 * (currently: gate rerolls). Other systems interact with gold only through
 * these functions, so future sources (objectives, markers, modules) and
 * sinks (crafting, gambling) plug in here without touching the tick loop.
 *
 * All functions are pure and thread rng state explicitly, same as the rest
 * of sim/.
 */

import { next, nextInt } from './rng.js'

/**
 * Per-enemy-type drop table. Mirrors the legacy render-layer values
 * (js/config.js) so the sim economy matches what players already see.
 *
 * chance: probability a kill drops gold at all
 * min/max: inclusive amount range when it does
 */
export const GOLD_DROPS = {
  basic: { chance: 0.30, min: 1, max: 3 },
  fast:  { chance: 0.25, min: 2, max: 4 },
  tank:  { chance: 0.50, min: 5, max: 10 },
  swarm: { chance: 0.15, min: 1, max: 2 },
}

/**
 * Roll a gold drop for a killed enemy.
 * Unknown types never drop (and consume no rng), so new enemy types are
 * goldless until explicitly added to the table.
 *
 * @param {string} type - enemy type key into GOLD_DROPS
 * @param {number} rngState
 * @param {number} [mult] - quantity multiplier hook (gold find, markers, modules)
 * @returns {[number, number]} [amount (0 = no drop), nextRngState]
 */
export const rollGoldDrop = (type, rngState, mult = 1) => {
  const entry = GOLD_DROPS[type]
  if (!entry) return [0, rngState]

  const [roll, s1] = next(rngState)
  if (roll >= entry.chance) return [0, s1]

  const [amount, s2] = nextInt(s1, entry.min, entry.max)
  return [Math.max(1, Math.round(amount * mult)), s2]
}

/**
 * Cost to reroll the current gate's options.
 * Scales with depth (income scales too) and doubles per reroll within the
 * same gate, so the first reroll is a real decision and chains get
 * prohibitive fast.
 *
 * @param {number} depth
 * @param {number} [rerollsUsed] - rerolls already spent on this gate
 * @returns {number} gold cost
 */
export const rerollCost = (depth, rerollsUsed = 0) =>
  (5 + 3 * depth) * 2 ** rerollsUsed
