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
  player.js       BASE_PLAYER + derivePlayerStats (single stat derivation)
  pity.js         Per-tag drought counters, quadratic boost
  damage.js       Flat -> increased -> more -> crit pipeline (PoE-standard)
  gold.js         Kill drop table, gate reroll costs
  profile.js      Per-character meta: echoes, upgrade board, achievement unlocks
  items.js        Seeded item generation: kinds, rarities, drop tables
  inventory.js    Bounded containers (haul/vault), loadout, auto-equip
  movement.js     Arena bounds, idle movement policies, manual override
  gate.js         Gate generation (2-3 options), resolution, gold reroll
  engine.js       tick(state, deltaMs, input) -> newState
  autopilot.js    Naive scoring — intentionally beatable by manual play
  save.js         Save file codec: versioned snapshots, export codes

src/              ES module entry point
  main.js         The shell: resolve identity -> pre-game menu -> mount a game
  identity/       Who is playing. Providers (guest, atproto), manager, OAuth
  host/           The shell<->game boundary: capabilities, storage, settings
  games/          Game modules — each exports { manifest, mount }
  storage/        Save slot CRUD, namespaced by identity subject
  ui/             Shell chrome: pre-game menu, identity chip, sign-in panel

oauth/callback/   OAuth redirect landing page (a real file, not a route)

js/               Legacy Babylon.js render layer (browser globals)
  config.js       Game balance constants
  game.js         Babylon.js game loop (coexists with sim tick)
  player.js       Player mesh, movement, input
  enemies.js      Enemy creation and behavior
  ...             (12 files — legacy item/inventory system removed)

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

**Combat**: the player moves (manual input, or an idle movement policy) inside
a bounded arena; enemies path toward them and swing on a cooldown once in
contact, capped by a surround limit. Auto-attack fires at the nearest enemy in
range and damage goes through the full pipeline (flat + increased + more + crit).
Only player attacks kill.

**Gate**: player (or autopilot) picks one of 2-3 affix offers, and may spend
gold to reroll the offers. Pity weights boost under-represented tags — if you
haven't seen crit in 5 gates, it gets 2x weight.

**Dead**: the run ends and folds into the character profile — echoes by depth
reached, a bonus for beating your record, plus any achievements earned. Then a
fresh run starts from a new meta snapshot. Same seed *and the same input
sequence* replay identically.

**Items**: kills drop seeded items into your 48-slot **haul**. When the run ends
the haul banks into the character's 240-slot **vault**, which persists forever.
Your **loadout is fixed for the run** — the roguelite contract rather than the
ARPG one. Gear is chosen at the home-base Armory between runs, and the run
lifecycle is bound to the world: entering the combat zone starts a run,
returning home or dying ends it and banks the haul. See `docs/sim/items.md`.

**Meta**: a save slot is a **character**, not a run. Its profile (echoes, an
upgrade board, achievement unlocks) survives death; runs are attempts inside
it. Meta enters a run only as an immutable snapshot taken at run start, so
buying an upgrade can never rewrite a replay. Movement policies are *earned*
through achievements rather than bought. See `docs/sim/profile.md`.

**Movement** is a first-class sim concern, not a render detail: manual control
is just an input that overrides the active idle policy (`hold` / `center` /
`patrol` / `kite`), so ARPG controls and idle automation share one tick and one
balance model. Which policy is running is the single largest lever on how deep
a run goes. See `docs/sim/movement.md`.

## Saving

The page boots into a save slot menu (pre-Babylon, plain DOM). Runs live in
`localStorage` and autosave on wave clear, death, and tab close. Slots can be
exported as JSON or a portable `arpg3d.v2.<base64url>` code and re-imported
anywhere — saves carry a schema version and are validated/migrated on load.
See `docs/save-system.md` for the format and versioning rules.

## Identity

The site shell owns identity; the game is a guest that receives an
already-resolved player context. **You can play without signing in** — a guest
identity is minted on first visit and is a real, save-bearing identity, not a
null. There is no login wall.

Signing in uses **atproto** (type a handle, authenticate on your own PDS — this
app never sees a password) and is identity-only: it yields your DID and nothing
else. Saves are keyed on that DID, so they follow you to another machine.
Signing in offers a one-time copy of your guest saves; it is a copy, so signing
out returns you to exactly what you had.

Adding another auth method means writing one provider object and registering
it — no other file changes. Games never see a token and never learn atproto
exists.

```bash
npm run dev       # then browse http://127.0.0.1:5173 — NOT localhost, see below

# GitHub Pages project site (served from a subpath):
SITE_BASE=/arpg3d/ SITE_ORIGIN=https://<user>.github.io npm run build
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`,
which derives those two values from the repo and fails the deploy if the
generated `client_id` or callback file would be wrong. It needs Pages set to
build from "GitHub Actions" in repo settings once, by hand.

Dev must be browsed at `127.0.0.1`: atproto's loopback `client_id` requires the
redirect to land there, and `localhost` is a different origin whose session is
invisible to the callback. See `docs/identity.md` for the full contract, the
provider interface, and the trust boundaries.

## Controls

- **WASD / Arrow Keys** — move player (overrides the idle movement policy while held)
- **ESC / P** — pause
- **I** — open the Armory: Haul / Vault / Loadout (ESC, I or E closes)
- **E** — the same screen, when standing at the Armory in Home Base
- Auto-attacks nearest enemy within range
- Release the movement keys and the active idle policy takes back over

## Dev console (localhost only)

```js
// Sim state (primary source of truth)
window.__sim()                // live SimState snapshot
window.__pickGate(0)          // manually resolve current gate (0, 1, or 2)
window.__rerollGate()         // spend gold to reroll the current gate's offers
window.__setAutopilot(false)  // disable autopilot for manual play
window.__setMovePolicy('kite')// idle movement AI: hold | center | patrol | kite
window.__movePolicies()       // all vs unlocked vs active-this-run
window.__profile()            // character meta: echoes, record depth, unlocks
window.__board()              // upgrade board with costs and affordability
window.__buy('vitality')      // spend echoes (applies to the NEXT run)
window.__achievements()       // checklist; these grant movement policies
window.__endRun()             // end the run now and bank its echoes
window.__bag()                // haul: items found this run
window.__stash()              // vault: stored items (persist across runs)
window.__gear()               // loadout + score
window.__equip(0, 'weapon')   // equip stash item (applies to the NEXT run)
window.__autoEquip()          // greedily equip the best of everything
window.__openStash()          // open the stash screen from anywhere
window.__newRun(42)           // restart with specific seed
window.__save()               // force-save the active slot
window.__store                // save store (list/get/remove/exportCode/...)

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
- **Meta layer**: items/stash, atlas, crafting built on sim/affixes.js (echoes and the upgrade board are in — see docs/sim/profile.md)

## License

MIT
