/**
 * sim/autopilot.js — Naive gate scoring and auto-pick
 *
 * The autopilot is intentionally simple and beatable by manual play.
 * Scoring formula:
 *   score = affix.value * tagSynergyBonus * categoryDepthBonus
 *
 * tagSynergyBonus: rewards affixes that reinforce existing tags in the build.
 *   - For each tag the offered affix shares with the current build, +20% bonus.
 *   - Encourages momentum (e.g. if you have 3 "damage" affixes, pick more damage).
 *
 * categoryDepthBonus: depth-dependent category preference.
 *   - Early (depth 1-3): offense preferred (2x), defense/utility neutral (1x)
 *   - Mid (depth 4-7): balanced — offense 1.5x, defense 1.3x, utility 1x
 *   - Late (depth 8+): survival matters — offense 1.2x, defense 1.8x, utility 1.2x
 *
 * A human player who deliberately builds toward a synergy can always
 * outperform this by making thematically consistent picks earlier.
 */

/**
 * @param {import('./affixes.js').Affix} affix - the offered affix
 * @param {import('./affixes.js').Affix[]} currentAffixes - player's current affixes
 * @param {number} depth
 * @returns {number} score (higher = autopilot prefers it)
 */
export const scoreOption = (affix, currentAffixes, depth) => {
  // Tag synergy: what fraction of my current tags match this affix?
  const myTags = new Set(currentAffixes.flatMap(a => a.tags))
  const sharedTags = affix.tags.filter(t => myTags.has(t)).length
  const tagSynergyBonus = 1 + sharedTags * 0.2

  // Category bonus by depth tier
  const categoryBonus = getCategoryBonus(affix.category, depth)

  return affix.value * tagSynergyBonus * categoryBonus
}

const getCategoryBonus = (category, depth) => {
  if (depth <= 3) {
    // Early: just kill things
    return category === 'offense' ? 2.0 : 1.0
  } else if (depth <= 7) {
    // Mid: balanced
    if (category === 'offense') return 1.5
    if (category === 'defense') return 1.3
    return 1.0
  } else {
    // Late: survival matters
    if (category === 'defense') return 1.8
    if (category === 'offense') return 1.2
    return 1.2
  }
}

/**
 * Auto-pick the highest-scoring gate option.
 *
 * @param {import('./gate.js').Gate} gate
 * @param {import('./engine.js').SimState} state
 * @returns {number} choiceIdx (0-based)
 */
export const autoPickGate = (gate, state) => {
  const { player, depth } = state
  let bestIdx = 0
  let bestScore = -Infinity

  gate.options.forEach((option, idx) => {
    const score = scoreOption(option.affix, player.affixes, depth)
    if (score > bestScore) {
      bestScore = score
      bestIdx = idx
    }
  })

  return bestIdx
}
