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
import { derivePlayerStats } from './player.js'
import { tickDroughts, resetDroughts } from './pity.js'
import { rerollCost } from './gold.js'

/**
 * @typedef {Object} GateOption
 * @property {import('./affixes.js').Affix} affix
 * @property {string[]} tags   — shortcut: affix.tags
 */

/**
 * @typedef {Object} Gate
 * @property {GateOption[]} options
 * @property {number} depth   — depth at which this gate was generated
 * @property {number} rerolls — gold rerolls spent on this gate
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

  return [{ options, depth, rerolls: 0 }, rng, newPity]
}

/**
 * Reroll the current gate's options for gold.
 * - No-op if there is no gate or the player can't afford rerollCost()
 * - New options exclude held affixes AND the current offers, so a reroll
 *   always changes the slate
 * - Pity is deliberately untouched: droughts were already ticked when this
 *   gate opened. A reroll is a re-draw of the same gate, not a new gate —
 *   otherwise rerolling would pump pity boosts for free.
 *
 * @param {import('./engine.js').SimState} state
 * @returns {import('./engine.js').SimState}
 */
export const rerollGate = (state) => {
  const { gate, player, pity } = state
  if (!gate) return state

  const cost = rerollCost(gate.depth, gate.rerolls ?? 0)
  if (player.gold < cost) return state

  const usedIds = [
    ...player.affixes.map(a => a.id),
    ...gate.options.map(o => o.affix.id),
  ]
  const options = []
  let rng = state.rng

  for (let i = 0; i < gate.options.length; i++) {
    const [affix, nextRng] = rollAffix(rng, pity, null, usedIds)
    rng = nextRng
    usedIds.push(affix.id)
    options.push({ affix, tags: affix.tags })
  }

  const rerolls = (gate.rerolls ?? 0) + 1
  return {
    ...state,
    rng,
    gate: { ...gate, options, rerolls },
    player: { ...player, gold: player.gold - cost },
    log: [...state.log, {
      tick: state.tick,
      type: 'gate_rerolled',
      payload: { depth: gate.depth, cost, rerolls }
    }]
  }
}

/**
 * Fraction of maxHp restored when a gate resolves (wave-clear recovery).
 * Persistent melee enemies deal sustained chip damage — without recovery
 * between waves, total hp would hard-cap run depth regardless of build.
 * Partial (not full) so in-run damage still carries forward pressure.
 */
export const GATE_HEAL_FRACTION = 0.3

/**
 * Apply the player's gate choice to state.
 * - Appends chosen affix to player.affixes
 * - maxHp deltas grow the live pool (maxHp AND current hp)
 * - Heals GATE_HEAL_FRACTION of maxHp (wave-clear recovery)
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

  // maxHp comes from the shared derivation, never from accumulation — the
  // new pool is whatever the full affix set implies (see sim/player.js).
  const maxHp = derivePlayerStats(newAffixes).maxHp
  const maxHpGain = maxHp - player.maxHp
  const hp = Math.min(maxHp, player.hp + maxHpGain + maxHp * GATE_HEAL_FRACTION)

  return {
    ...state,
    phase: 'combat',
    gate: null,
    player: { ...player, affixes: newAffixes, maxHp, hp },
    pity: newPity,
    log: [...state.log, {
      tick: state.tick,
      type: 'gate_resolved',
      payload: { choiceIdx, affixId: chosen.affix.id, depth: gate.depth }
    }]
  }
}
