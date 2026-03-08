/**
 * sim/rng.js — Seeded deterministic RNG (mulberry32)
 *
 * All functions are pure: input state → [value, nextState].
 * Callers thread rngState forward explicitly.
 * Same seed + same sequence of calls = identical results forever.
 */

/**
 * Create a new RNG state from a seed integer.
 * @param {number} seed - any integer (will be unsigned-coerced)
 * @returns {number} initial rng state
 */
export const createRNG = (seed) => seed >>> 0

/**
 * Advance RNG, return [float in [0,1), nextState].
 * @param {number} state
 * @returns {[number, number]}
 */
export const next = (state) => {
  let s = (state + 0x6D2B79F5) >>> 0
  s = Math.imul(s ^ (s >>> 15), s | 1)
  s ^= s + Math.imul(s ^ (s >>> 7), s | 61)
  const float = ((s ^ (s >>> 14)) >>> 0) / 4294967296
  const nextState = (state + 0x6D2B79F5) >>> 0
  return [float, nextState]
}

/**
 * Return [integer in [min, max] inclusive, nextState].
 * @param {number} state
 * @param {number} min
 * @param {number} max
 * @returns {[number, number]}
 */
export const nextInt = (state, min, max) => {
  const [f, s] = next(state)
  return [Math.floor(f * (max - min + 1)) + min, s]
}

/**
 * Weighted random selection from an array of { weight, ... } objects.
 * Returns [item, nextState].
 * @param {number} state
 * @param {Array<{weight: number}>} pool
 * @returns {[object, number]}
 */
export const weightedPick = (state, pool) => {
  const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0)
  const [f, nextState] = next(state)
  let roll = f * totalWeight
  for (const item of pool) {
    roll -= item.weight
    if (roll <= 0) return [item, nextState]
  }
  return [pool[pool.length - 1], nextState]
}
