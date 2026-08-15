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
1. If `input.gateReroll` → `rerollGate(state)` (gold sink, see docs/sim/gold.md) — consumes the frame
2. Else if `input.gateChoice !== null` → `resolveGate(state, choice)` → spawn next wave → `phase = 'combat'`
3. Else if `input.autopilot` → call `autoPickGate(gate, state)` → same as above
4. Else → do nothing (wait for player input)

### Combat phase
1. Derive stats; refresh `player.maxHp` from them (see "Stat ownership")
2. HP regen (if `stats.regen > 0`)
3. Player movement: `resolveMove()` — manual `input.move` if present, else the
   active `input.movePolicy` (docs/sim/movement.md), clamped to the arena
4. Move all enemies toward the player's current position
5. Enemy melee: enemies within dist < 1.0 persist and swing on their own
   cooldown (`template.attackMs`, per-enemy `lastHitTick`), limited to the
   `ENGAGEMENT_SLOTS` closest
6. Auto-attack: if `ticksSinceAttack >= attackIntervalTicks` and enemies in range:
   - Find nearest enemy within `stats.attackRange` of the player
   - `calcDamage(...)` with current RNG
   - If enemy hp ≤ 0: kill
7. Player death check: if `hp ≤ 0` → `phase = 'dead'`
8. Wave clear check: if `enemies.length === 0` → `generateGate()` → `phase = 'gate'`

Only player attacks kill. Each kill goes through `creditKill()`: xp,
`player.kills[type]` increment, lifesteal, and a gold drop roll
(`sim/gold.js`). Death-on-contact was removed — it let ehp builds
auto-clear waves and starved the kill-driven economy. It may return later
as a thorns-style player stat (attackers die to reflected damage).

### Stat ownership
`derivePlayerStats()` in `sim/player.js` is the ONLY place effective stats
are computed. `player.maxHp` is a *cache* of `stats.maxHp`, refreshed every
combat tick and on gate resolution — never accumulated onto player state.
A second accumulation path silently desyncs the two the moment stats can be
granted outside a gate (items, echoes, module hooks).

### Melee balance model
With persistent attackers and a surround limit, damage taken is bounded by
`ENGAGEMENT_SLOTS` rather than wave size, and survival is a dps race
against how long enemies stay in contact — which is what makes movement the
dominant lever. Partial recovery at each gate (`GATE_HEAL_FRACTION`, see
docs/sim/gate.md) keeps total hp from hard-capping run depth.

Tuning targets (autopilot gate picks, headless): death at depth ~4 standing
still, ~17–23 patrolling, ~22+ kiting. See docs/sim/movement.md for the
speed-vs-player balance premise that keeps movement a tradeoff.

### Dead phase
No-op — run is over.

## Enemy ids
Enemy ids come from `state.nextId`, threaded through `spawnWave()` and
stored in the save snapshot — never a module-level counter, which would
diverge across resumed or parallel runs and break determinism.

## Positions
Everything exists in a flat 2D space (x, z). The player has a real position
(`player.x`, `player.z`) bounded by the arena disc, and enemies path toward
it. See docs/sim/movement.md for policies, arena bounds, and the manual
control override. The render layer draws these positions; it never owns them.

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
