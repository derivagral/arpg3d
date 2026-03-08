# AGENTS.md — LLM Context Guide

This file tells an AI agent (or human) exactly which docs to load for a given task.
Load only the listed files — don't load the entire codebase.
Each subsystem is designed so its context fits in a single focused session.

## Scope map

| Task area                        | Load these docs                                  | Key source files                          |
|----------------------------------|--------------------------------------------------|-------------------------------------------|
| Adding affixes to the pool       | docs/sim/affixes.md                              | sim/affixes.js                            |
| Tuning damage numbers            | docs/sim/damage.md, docs/sim/affixes.md          | sim/damage.js, sim/affixes.js             |
| Adjusting pity feel              | docs/sim/pity.md                                 | sim/pity.js, sim/gate.js                  |
| Gate generation / option count   | docs/sim/gate.md, docs/sim/affixes.md            | sim/gate.js, sim/affixes.js               |
| Sim loop / phase transitions     | docs/sim/engine.md, docs/sim/overview.md         | sim/engine.js                             |
| Autopilot tuning                 | docs/sim/overview.md                             | sim/autopilot.js                          |
| Babylon.js render / visuals      | docs/render/overview.md, docs/render/babylon.md  | src/main.js, js/game.js                   |
| New zone type                    | docs/sim/engine.md, docs/sim/gate.md             | sim/engine.js, sim/gate.js                |
| Writing tests for sim            | docs/sim/overview.md                             | sim/**/*.js (import in Node, no browser)  |
| Internal API design              | docs/sim/overview.md, docs/render/overview.md    | sim/engine.js, src/main.js                |

## Rules for agents
1. Read only the listed docs + source files for your task scope.
2. `sim/` has zero browser or Babylon.js dependencies — importable in Node.js.
3. Never import Babylon.js types into `sim/`. Keep sim/ dependency-free.
4. All sim functions are pure. Do not introduce side effects.
5. Affix IDs are stable keys — never rename an existing one (breaks saved state).
6. When adding a new subsystem, add its row here and write its own `docs/sim/[name].md`.
