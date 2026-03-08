/**
 * sim/pity.js — Per-tag drought tracking with quadratic pity boost
 *
 * Each tag accumulates a "drought" counter every gate it doesn't appear in.
 * The boost is quadratic: gentle early (~5 missed gates = 2x), aggressive later.
 * Picking an option resets droughts for that option's tags.
 *
 * This makes the build feel responsive — if you haven't seen a damage affix in
 * 5 gates, the next gate is statistically likely to offer one.
 */

/**
 * @typedef {Object} PityState
 * @property {Object.<string, number>} droughts - tag → missed gate count
 * @property {number} totalGates - total gates generated (for analytics)
 */

/**
 * Create a fresh pity state with all droughts at 0.
 * @returns {PityState}
 */
export const createPity = () => ({ droughts: {}, totalGates: 0 })

/**
 * After generating a gate, increment drought for every tag NOT represented
 * in any of the offered options. Decrement (floor 0) for represented tags.
 *
 * @param {PityState} pity
 * @param {string[]} offeredTags - flat array of all tags across all gate options
 * @param {string[]} allTags - master list of all known tags (from AFFIX_POOL)
 * @returns {PityState}
 */
export const tickDroughts = (pity, offeredTags, allTags) => {
  const offered = new Set(offeredTags)
  const newDroughts = { ...pity.droughts }
  for (const tag of allTags) {
    if (offered.has(tag)) {
      newDroughts[tag] = 0
    } else {
      newDroughts[tag] = (newDroughts[tag] ?? 0) + 1
    }
  }
  return { droughts: newDroughts, totalGates: pity.totalGates + 1 }
}

/**
 * After the player picks a gate option, reset droughts for that option's tags.
 *
 * @param {PityState} pity
 * @param {string[]} pickedTags
 * @returns {PityState}
 */
export const resetDroughts = (pity, pickedTags) => {
  const newDroughts = { ...pity.droughts }
  for (const tag of pickedTags) {
    newDroughts[tag] = 0
  }
  return { ...pity, droughts: newDroughts }
}

/**
 * Quadratic pity boost for a tag.
 * boost = 1 + (drought / 5)^2
 * Examples: drought=0 → 1x, drought=5 → 2x, drought=10 → 5x, drought=15 → 10x
 *
 * @param {PityState} pity
 * @param {string} tag
 * @returns {number} weight multiplier >= 1
 */
export const getPityBoost = (pity, tag) => {
  const drought = pity.droughts[tag] ?? 0
  return 1 + (drought / 5) ** 2
}
