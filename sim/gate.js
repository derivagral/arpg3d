/**
 * sim/gate.js — Gate generation and resolution
 *
 * A "gate" is a moment between combat encounters where the player picks one
 * of N affix offers. This is the primary build progression mechanism.
 *
 * The number of options scales with depth. Tags are seeded from the gate
 * "archetype" (pure random at low depth, biased toward player's build later).
 * Pity weights are applied during rollAffix — the gate doesn't need to
 * know about pity internals.
 *
 * After resolution, the chosen affix is appended to player.affixes and
 * pity is updated (droughts reset for picked tags, ticked for offered-but-not-picked).
 */

import { rollAffix, ALL_TAGS } from './affixes.js'
import { tickDroughts, resetDroughts } from './pity.js'
import { nextInt } from './rng.js'

/**
 * @typedef {Object} GateOption
 * @property {import('./affixes.js').Affix} affix
 * @property {string[]} tags   — shortcut: affix.tags
 */

/**
 * @typedef {Object} Gate
 * @property {GateOption[]} options
 * @property {number} depth   — depth at which this gate was generated
 */

/**
 * Generate a gate: roll 2–3 affix options (3 unlocked at depth >= 3).
 * Returns updated rng state and pity (droughts ticked for the gate).
 *
 * @param {number} depth
 * @param {number} rngState
 * @param {import('./pity.js').PityState} pity
 * @param {string[]} existingIds - player's already-held affix IDs (to reduce dupes)
 * @returns {[Gate, number, import('./pity.js').PityState]}
 */
export const generateGate = (depth, rngState, pity, existingIds = []) => {
  const optionCount = depth >= 3 ? 3 : 2
  const options = []
  const usedIds = [...existingIds]
  let rng = rngState

  for (let i = 0; i < optionCount; i++) {
    const [affix, nextRng] = rollAffix(rng, pity, null, usedIds)
    rng = nextRng
    usedIds.push(affix.id)  // no duplicates within same gate
    options.push({ affix, tags: affix.tags })
  }

  // Tick droughts: offered tags reset to 0, all others increment
  const offeredTags = options.flatMap(o => o.tags)
  const newPity = tickDroughts(pity, offeredTags, ALL_TAGS)

  return [{ options, depth }, rng, newPity]
}

/**
 * Apply the player's gate choice to state.
 * - Appends chosen affix to player.affixes
 * - Resets pity droughts for chosen tags
 * - Transitions phase back to 'combat'
 *
 * @param {import('./engine.js').SimState} state
 * @param {number} choiceIdx - index into gate.options (0-based)
 * @returns {import('./engine.js').SimState}
 */
export const resolveGate = (state, choiceIdx) => {
  const { gate, player, pity } = state
  if (!gate || choiceIdx < 0 || choiceIdx >= gate.options.length) return state

  const chosen = gate.options[choiceIdx]
  const newAffixes = [...player.affixes, chosen.affix]
  const newPity = resetDroughts(pity, chosen.tags)

  return {
    ...state,
    phase: 'combat',
    gate: null,
    player: { ...player, affixes: newAffixes },
    pity: newPity,
    log: [...state.log, {
      tick: state.tick,
      type: 'gate_resolved',
      payload: { choiceIdx, affixId: chosen.affix.id, depth: gate.depth }
    }]
  }
}
