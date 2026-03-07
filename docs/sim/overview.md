# Sim Layer — Overview

## What it is
`sim/` is a deterministic, browser-independent game engine. It has zero dependencies
on Babylon.js, DOM, or any browser API. Given the same seed and the same sequence of
player inputs, it produces bit-identical state every time.

## SimState shape
```js
{
  seed:    number,        // original seed (never changes)
  rng:     number,        // current mulberry32 state (advances every random call)
  tick:    number,        // frame count since run start
  elapsed: number,        // ms since run start

  phase: 'combat' | 'gate' | 'dead',
  depth: number,          // gates completed (1 = first wave)

  player: {
    hp:             number,
    maxHp:          number,
    affixes:        Affix[],   // collected affixes (appended, never mutated)
    gold:           number,
    xp:             number,
    lastAttackTick: number,
  },

  enemies: EnemyData[],   // pure data — no Babylon meshes
  gate:    Gate | null,   // non-null only during 'gate' phase
  pity:    PityState,
  log:     SimEvent[],    // append-only deterministic event log
}
```

## Phase diagram
```
createState(seed)
      │
      ▼
  [combat] ──── enemies killed ───▶ [gate] ──── choice made ───▶ [combat] (depth+1)
      │                                                                  │
      └──────────── player hp ≤ 0 ──────────────────────────────▶ [dead]
```

## Primary API (`sim/engine.js`)
```js
createState(seed)              → SimState
tick(state, deltaMs, input)    → SimState   // call every frame
isRunOver(state)               → boolean
```

`input` shape:
```js
{
  gateChoice: number | null,   // 0/1/2 = manual pick; null = let autopilot decide
  autopilot:  boolean,         // when true, autopilot resolves gates automatically
}
```

## Headless usage (Node.js)
```js
import { createState, tick, isRunOver } from './sim/engine.js'
let state = createState(42)
while (!isRunOver(state)) {
  state = tick(state, 16.67, { gateChoice: null, autopilot: true })
}
console.log('depth reached:', state.depth)
```

## Key constraints
- Never mutate state in-place — always spread and return a new object.
- RNG state is threaded explicitly through every call that needs randomness.
- The `log` array is append-only and enables full replay from `seed`.
- Affix IDs are permanent stable keys — changing them breaks saved logs.
