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
Currently syncs:
- `simState.player.hp` → `game.player.stats.health`
- `simState.player.maxHp` → `game.player.stats.maxHealth`

**Not yet synced** (legacy layer handles these independently):
- Enemy positions / mesh lifecycle
- Projectiles
- Pickups
- Wave/spawn logic

The goal is to progressively expand syncSimToRender as each legacy system is ported
to the sim, then remove the legacy counterpart.

## Debug surface
```js
window.__sim()            // live SimState snapshot (dev only)
window.__pickGate(idx)    // manually resolve current gate
window.__setAutopilot(false)  // disable autopilot to test manual play
window.__newRun(seed?)    // restart sim with optional seed
window.__game             // Babylon.js Game instance
window.debugCommands      // legacy debug helpers (spawn enemies, god mode, etc.)
```

## Separation contract
- `sim/` files must not import from `js/` or `src/`.
- `src/main.js` may import from `sim/`.
- `js/` files must not import from `sim/` (they're browser globals loaded by script tags).
- Data flows **one way**: sim → render. Never render → sim.
