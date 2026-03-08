# Sim — Engine (tick loop)

## Entry points
```js
import { createState, tick, isRunOver } from './sim/engine.js'

const state  = createState(seed)        // fresh run
const next   = tick(state, 16.67, input) // one frame (~60fps = 16.67ms)
const done   = isRunOver(state)         // true when phase === 'dead'
```

## What tick() does per frame

### Gate phase
1. If `input.gateChoice !== null` → `resolveGate(state, choice)` → spawn next wave → `phase = 'combat'`
2. Else if `input.autopilot` → call `autoPickGate(gate, state)` → same as above
3. Else → do nothing (wait for player input)

### Combat phase
1. HP regen (if `stats.regen > 0`)
2. Move all enemies toward origin (player position = 0,0 in sim space)
3. Enemy melee hits (enemies within dist < 1.0 deal damage and are removed)
4. Auto-attack: if `ticksSinceAttack >= attackIntervalTicks` and enemies in range:
   - Find nearest enemy within `stats.attackRange`
   - `calcDamage(...)` with current RNG
   - If enemy hp ≤ 0: kill, grant XP, apply lifesteal
5. Player death check: if `hp ≤ 0` → `phase = 'dead'`
6. Wave clear check: if `enemies.length === 0` → `generateGate()` → `phase = 'gate'`

### Dead phase
No-op — run is over.

## Enemy positions
Enemies exist in a flat 2D space (x, z). Player is always at origin (0, 0).
The sim does not track player position — enemies move toward (0, 0).
Render layer adds Babylon.js mesh positions on top of this.

## Wave scaling (ledge zone)
```js
const waveForDepth = (depth) => ({
  count: 5 + depth * 3,        // 8 at depth 1, 11 at depth 2, ...
  types: depth <= 2 ? ['basic'] :
         depth <= 4 ? ['basic', 'fast'] :
         depth <= 6 ? ['basic', 'fast', 'tank'] :
                      ['basic', 'fast', 'tank', 'swarm']
})
```

## Attack timing
`attackIntervalTicks = max(5, round(stats.attackSpeed / 16.67))`
At 1000ms attack speed and 60fps: fires every 60 ticks (1s).
At 500ms: every 30 ticks. Minimum 5 ticks (~12 attacks/s).

## Adding a new zone
1. Create a `waveForDepth_[zoneName]()` function in engine.js.
2. Add a `zone` field to SimState and switch on it in tick().
3. Document enemy templates for the zone.
4. The sim doesn't care about visuals — Babylon.js picks up new enemy types from enemy data.
