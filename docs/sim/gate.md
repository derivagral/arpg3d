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
  3. resetDroughts(pity, chosenTags)
  4. Transition phase → 'combat'
  5. Append to log: { tick, type: 'gate_resolved', payload: { choiceIdx, affixId, depth } }
```

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
