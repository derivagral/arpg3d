# arpg3d

A simulation-first idle ARPG built on Babylon.js. The game logic runs as pure,
deterministic functions in `sim/` — same seed, same choices, same outcome every time.
Babylon.js is the render layer: it reads sim state and draws meshes.

## Quick start

```bash
npm install
npm run dev       # Vite dev server at localhost:5173
```

## Architecture

```
sim/              Pure game logic — zero browser deps, Node-importable
  rng.js          Seeded RNG (mulberry32), functional state threading
  affixes.js      AFFIX_POOL (20 affixes), rollAffix, deriveStats
  pity.js         Per-tag drought counters, quadratic boost
  damage.js       Flat -> increased -> more -> crit pipeline (PoE-standard)
  gate.js         Gate generation (2-3 options), resolution
  engine.js       tick(state, deltaMs, input) -> newState
  autopilot.js    Naive scoring — intentionally beatable by manual play

src/              ES module entry point
  main.js         Bootstrap: sim state + Babylon.js + dev surface

js/               Legacy Babylon.js render layer (browser globals)
  config.js       Game balance constants
  game.js         Babylon.js game loop (coexists with sim tick)
  player.js       Player mesh, movement, input
  enemies.js      Enemy creation and behavior
  ...             (14 files total)

docs/             Subsystem docs for scoped context management
  AGENTS.md       Scope map — which docs to load per task type
  sim/            One doc per sim module (state shapes, formulas, constraints)
  render/         Render layer contract, Babylon.js notes
```

Data flows one way: `sim/ -> render`. The render layer never writes back into sim state.

## How it works

The sim runs a phase machine every frame:

```
createState(seed)
      |
      v
  [combat] --- wave cleared ---> [gate] --- affix picked ---> [combat] (depth+1)
      |                                                             |
      +------------- player hp <= 0 ----------------------------> [dead]
```

**Combat**: enemies move toward player, auto-attack fires at nearest in range,
damage goes through the full pipeline (flat + increased + more + crit).

**Gate**: player (or autopilot) picks one of 2-3 affix offers. Pity weights
boost under-represented tags — if you haven't seen crit in 5 gates, it gets 2x weight.

**Dead**: run is over. Same seed replays identically.

## Controls

- **WASD / Arrow Keys** — move player
- **ESC / P** — pause
- **I** — inventory
- Auto-attacks nearest enemy within range

## Dev console (localhost only)

```js
// Sim state (primary source of truth)
window.__sim()                // live SimState snapshot
window.__pickGate(0)          // manually resolve current gate (0, 1, or 2)
window.__setAutopilot(false)  // disable autopilot for manual play
window.__newRun(42)           // restart with specific seed

// Legacy render layer
window.__game                 // Babylon.js Game instance
window.debugCommands          // old debug helpers (godMode, spawnEnemy, etc.)
```

## Headless simulation (Node.js)

The sim runs without a browser:

```js
import { createState, tick, isRunOver } from './sim/engine.js'

let state = createState(42)
while (!isRunOver(state)) {
  state = tick(state, 16.67, { gateChoice: null, autopilot: true })
}
console.log('depth:', state.depth, 'affixes:', state.player.affixes.map(a => a.id))
```

## Key systems

### Affix pool
20 affixes across offense/defense/utility categories. Each has tags, weight,
and a stat delta. Tags drive pity tracking and autopilot scoring.
See `docs/sim/affixes.md` for the full schema and tag taxonomy.

### Damage pipeline
PoE-standard: `(base + flat) * (1 + sum_increased/100) * product(1 + more_i/100) * crit?`
Increased bonuses add together (diminishing). More bonuses multiply (always valuable).

### Pity
Per-tag drought counter. Boost = `1 + (drought/5)^2`.
At 5 missed gates: 2x weight. At 10: 5x. Resets when tag is picked.

### Autopilot
`score = value * tagSynergy * categoryDepthBonus`. Early game biases offense,
late game biases defense. Designed to be naive — manual play should outperform it.

## Future work

- **Separation**: port enemy/projectile/pickup logic from legacy layer to sim
- **Tests**: `npm test` runs `node --test sim/**/*.test.js` — pure functions, no browser
- **MD agent states**: `docs/AGENTS.md` scopes context per task (load only what's relevant)
- **New zones**: duplicate `waveForDepth`, add zone field to SimState
- **Meta layer**: currency, atlas, crafting built on sim/affixes.js

## License

MIT
