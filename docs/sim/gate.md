# Sim — Gates

## What is a gate?
A gate is a build-choice moment between combat waves. When all enemies in a wave die,
a gate opens and the player picks one affix from N options. Gates are the primary
progression mechanic — no other way to gain affixes currently.

## Gate shape
```js
Gate = {
  options: GateOption[],   // 2 options at depth < 3, 3 options at depth >= 3
  depth: number,           // depth at which this gate was generated
  rerolls: number,         // gold rerolls spent on this gate (cost doubles each)
}

GateOption = {
  affix: Affix,
  tags: string[],          // shortcut: affix.tags
}
```

## Generation flow
```
generateGate(depth, rngState, pity, existingIds)
  1. Determine option count: depth >= 3 ? 3 : 2
  2. For each option slot:
     a. rollAffix(rng, pity, null, usedIds)  — no tag filter, excludes already-used IDs
     b. Push result, add ID to usedIds (no duplicates within same gate)
  3. tickDroughts(pity, offeredTags, ALL_TAGS)
  4. Return [Gate, nextRng, newPity]
```

## Resolution flow
```
resolveGate(state, choiceIdx)
  1. Validate choiceIdx
  2. Append chosen affix to player.affixes
  3. Recompute player.maxHp via derivePlayerStats(newAffixes) — the single
     derivation, never accumulation (see docs/sim/engine.md "Stat ownership");
     player.hp grows by the same gain so added maxHp is usable immediately
  4. Heal GATE_HEAL_FRACTION (30%) of maxHp — wave-clear recovery
  5. resetDroughts(pity, chosenTags)
  6. Transition phase → 'combat'
  7. Append to log: { tick, type: 'gate_resolved', payload: { choiceIdx, affixId, depth } }
```
The heal exists because melee enemies persist and chip: without recovery
between waves, total hp would hard-cap run depth regardless of build.
Partial (not full) so damage taken still carries pressure forward.

## Reroll flow (gold sink)
```
rerollGate(state)
  1. No-op if no gate, or player.gold < rerollCost(gate.depth, gate.rerolls)
  2. Re-roll all options, excluding held affixes AND the current offers
     (a paid reroll always changes the slate)
  3. Deduct cost, increment gate.rerolls
  4. Append to log: { type: 'gate_rerolled', payload: { depth, cost, rerolls } }
```
Pity is deliberately untouched: droughts ticked when the gate opened, and a
reroll is a re-draw of the same gate — ticking again would let players pump
pity boosts by rerolling. Engine input: `{ gateReroll: true }` during the
gate phase consumes the frame (options are picked from on a later tick).
Cost curve and tuning intent live in docs/sim/gold.md. The autopilot never
rerolls — gold judgement is a manual-play edge by design.

## Future gate types
To add a new gate type (e.g., "Forge" where you upgrade an existing affix):
1. Add a `gateType` field to the Gate shape.
2. Add a `generateForge()` in gate.js using the same rng/pity threading pattern.
3. Add a branch in `engine.js` tick (gate phase) to call the right resolver.
4. Document the new type here.

## Option count scaling
Currently: 2 options until depth 3, then 3 options permanently.
Simple to change: edit the `optionCount` line in `generateGate()`.
Future consideration: 4 options at depth 10+, gated rarities, themed gates per zone.
