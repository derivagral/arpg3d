# arpg3d — Architecture Docs

## Quick start
```bash
npm install
npm run dev     # Vite dev server at localhost:5173
```

## Project layout
```
sim/          Pure ES modules — game logic, zero browser deps
  rng.js      Seeded deterministic RNG (mulberry32)
  affixes.js  AFFIX_POOL, rollAffix, deriveStats
  pity.js     Per-tag drought counters, quadratic boost
  damage.js   Flat → increased → more → crit pipeline
  gate.js     Gate generation and resolution
  engine.js   tick(state, deltaMs, input) → newState
  autopilot.js Naive gate scoring, intentionally beatable

src/          ES module entry point
  main.js     Bootstrap: sim + Babylon.js + dev surface

js/           Legacy Babylon.js render layer (browser globals)
  game.js, player.js, enemies.js, ... (existing files)

docs/         Architecture docs for LLM and human context management
  AGENTS.md   Scope map — which docs to load per task
  sim/        Sim subsystem docs
  render/     Render layer docs
```

## Architecture
```
             ┌─────────────────────────────────────────┐
             │              sim/ (pure)                 │
             │  createState → tick → tick → ... → dead  │
             │  No Babylon.js. No DOM. Node-importable. │
             └──────────────────┬──────────────────────┘
                                │ SimState (read-only)
                                ▼
             ┌─────────────────────────────────────────┐
             │           render layer (js/ + src/)      │
             │  Babylon.js meshes, UI, input handling   │
             │  syncSimToRender() pushes state to UI    │
             └─────────────────────────────────────────┘
```

## Future work (scoped for separate sessions)
- **Separation**: complete port of enemy/projectile/pickup logic to sim/
- **Internal APIs**: each sim module is already a clean function API
- **Tests**: `npm test` → Node.js, no browser required (`sim/**/*.test.js`)
- **MD agent states**: `docs/AGENTS.md` maps tasks to minimal doc subsets
- **New zones**: duplicate waveForDepth pattern, add `zone` to SimState
- **Meta layer**: currency, atlas, crafting — builds on top of sim/affixes.js
