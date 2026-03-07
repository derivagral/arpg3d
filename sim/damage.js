/**
 * sim/damage.js — PoE-standard damage pipeline
 *
 * Pipeline (in order):
 *   1. Flat damage added to base  → effective base
 *   2. Increased (% additive)     → base * (1 + sum_increased / 100)
 *   3. More (% multiplicative)    → × each more multiplier in sequence
 *   4. Crit                       → × critMult if RNG roll < critChance
 *
 * All values are pure / deterministic. Crit uses the passed RNG state and
 * returns the advanced state alongside the result.
 *
 * "Increased" bonuses all add together before multiplying (PoE rule).
 * "More" bonuses multiply against each other (each is a separate multiplier).
 */

import { next } from './rng.js'

/**
 * @typedef {Object} DamageParams
 * @property {number} base         - skill base damage
 * @property {number} flat         - sum of flat +damage affixes
 * @property {number} increased    - sum of % increased damage (e.g. 50 = 50% increased)
 * @property {number[]} more       - array of % more multipliers (e.g. [20] = 1.2x)
 * @property {number} critChance   - probability 0–1
 * @property {number} critMult     - critical strike multiplier (default 1.5)
 * @property {number} rngState     - current RNG state for crit roll
 */

/**
 * Calculate final damage.
 * @param {DamageParams} params
 * @returns {[number, number, boolean]} [damage, nextRngState, wasCrit]
 */
export const calcDamage = ({
  base,
  flat = 0,
  increased = 0,
  more = [],
  critChance = 0,
  critMult = 1.5,
  rngState
}) => {
  // Step 1: flat
  let dmg = base + flat

  // Step 2: increased (additive pool)
  dmg *= (1 + increased / 100)

  // Step 3: more multipliers (each one multiplicative)
  for (const pct of more) {
    dmg *= (1 + pct / 100)
  }

  // Step 4: crit
  const [roll, nextRng] = next(rngState)
  const wasCrit = roll < critChance
  if (wasCrit) dmg *= critMult

  return [Math.round(dmg), nextRng, wasCrit]
}

/**
 * Derive aggregate damage modifiers from a list of affixes.
 * Returns the flat, increased, more arrays, and critChance ready for calcDamage.
 *
 * @param {Array<{delta: object}>} affixes
 * @returns {{ flat: number, increased: number, more: number[], critChance: number, critMult: number }}
 */
export const aggregateDamageModifiers = (affixes) => {
  let flat = 0
  let increased = 0
  const more = []
  let critChance = 0
  let critMult = 1.5

  for (const affix of affixes) {
    const d = affix.delta
    if (d.flatDamage)    flat      += d.flatDamage
    if (d.increased)     increased += d.increased
    if (d.more)          more.push(d.more)
    if (d.critChance)    critChance = Math.min(1, critChance + d.critChance)
    if (d.critMult)      critMult  += d.critMult - 1  // stack additively
  }

  return { flat, increased, more, critChance, critMult }
}
