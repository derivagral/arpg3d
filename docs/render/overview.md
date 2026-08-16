# Render Layer — Overview

## What it is
Everything in `js/` and `src/main.js` that touches Babylon.js, the DOM, or browser APIs.
The render layer is a *consumer* of sim state — it reads `SimState` and updates visuals.
It must never write back into the sim.

## Current architecture (coexistence mode)
```
src/main.js
  ├── createState(seed)         → simState (primary source of truth)
  ├── new Game(engine, canvas)  → game (legacy render layer, still ticking)
  └── scene.registerBeforeRender:
        simState = tick(simState, deltaMs, input)   ← sim advances first
        syncSimToRender(simState, game)             ← push key values into legacy layer
        game's own beforeRender callback            ← legacy loop runs second
```

## syncSimToRender (src/main.js)
Currently syncs **nothing** — it is an empty stub. The sim runs in parallel
and is surfaced via `window.__sim()`; the legacy layer still owns its own
player, enemies, and combat independently.

**Not yet synced** (legacy layer handles these independently):
- Player hp / stats
- Player and enemy positions / mesh lifecycle
- Projectiles
- Pickups
- Wave/spawn logic

The goal is to progressively expand syncSimToRender as each legacy system is ported
to the sim, then remove the legacy counterpart. Until then, gameplay rules
implemented in one layer must be mirrored in the other by hand — see
"Mirrored rules" below.

## Mirrored rules
Behaviour that exists in both layers today, and must be changed in both:

| Rule | Sim | Legacy |
|------|-----|--------|
| Enemies persist in contact, swing on cooldown | `sim/engine.js` melee block | `js/game.js` `updateEnemies()` |
| Surround limit | `ENGAGEMENT_SLOTS` | `CONFIG.combat.engagementSlots` |
| Enemy/player balance stats | `ENEMY_TEMPLATES`, `BASE_PLAYER` | `CONFIG.enemies.types`, `CONFIG.player` |
| Container sizes | `INVENTORY_SIZE`, `STASH_SIZE` | `CONFIG.inventory` |
| Arena size | `ARENA_RADIUS` (23) | `areaManager` `groundSize` (69 / 46) |

**Items are no longer mirrored** — the sim is the sole source. It rolls every
drop and banks it; the render layer only *displays* drops drained from the
sim's `item_drop` log events into `game.simDropQueue`. See docs/sim/items.md.

`sim/` is canonical: when they disagree, sim wins and the legacy config follows.

## Wave pacing
The legacy wave system advances when its timer expires **or** as soon as the
field is clear (`CONFIG.spawn.clearedWaveAdvance`), so a cleared arena doesn't
leave the player waiting out the clock. Early advance requires that the wave
actually spawned something and that a short grace period has passed, so the
gap before the first spawn — and a lull between spawns — aren't mistaken for
a clear. The sim's own loop already advances immediately on wave clear.

## Notices (nudges)
`src/ui/notices.js` is a channel-based HUD rail in the bottom-right. A
*channel* is one persistent thing worth acting on; it owns a badge and can
flash when its value changes.

Two levels of loudness, kept separate on purpose:
- **badge** — persistent state ("3 new"). Truthful, never animated.
- **flash** — a one-shot pulse when the value *rises*. Attention, not state.

A badge that animates forever becomes wallpaper; a flash that persists becomes
clutter. `set()` only flashes when the count actually increases, so
re-rendering the same state never nags.

Only the `inventory` channel exists today, counting run-bag items with a uid
above `profile.seenItemUid`. Opening the gear screen *is* the acknowledgement
— there is no separate dismiss — and the watermark persists, so the badge
survives a reload. Buff timers and combat alerts are deliberately absent:
they are transient, they compete with the action, and they want positioning
near the player rather than a corner rail. The module is shaped to take them
as channels when that content exists.

## Input flow
Manual movement is an **input to the sim**, not a render-layer behaviour:
`src/main.js` collects held WASD/arrow keys into `input.move` (`{x, z}`),
which overrides the active `input.movePolicy` for that tick. This keeps
manual and idle play on one code path and one balance model, and keeps runs
deterministic (record the input stream → replay). See docs/sim/movement.md.

## Debug surface
```js
window.__sim()            // live SimState snapshot (dev only)
window.__pickGate(idx)    // manually resolve current gate
window.__rerollGate()     // spend gold to reroll gate options
window.__setAutopilot(false)  // disable autopilot to test manual play
window.__setMovePolicy(n)  // 'hold' | 'center' | 'patrol' | 'kite'
window.__movePolicies()   // list available policies
window.__newRun(seed?)    // restart sim with optional seed
window.__save()           // force-save the active slot
window.__store            // save store (list/get/remove/...)
window.__game             // Babylon.js Game instance
window.debugCommands      // legacy debug helpers (spawn enemies, god mode, etc.)
```

## Separation contract
- `sim/` files must not import from `js/` or `src/`.
- `src/main.js` may import from `sim/`.
- `js/` files must not import from `sim/` (they're browser globals loaded by script tags).
- Data flows **one way**: sim → render. Never render → sim.
