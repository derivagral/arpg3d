# Rewards & Gameplay Loops — Design Notes

Goal: mix ARPG grinding/planning (items, affixes, build decisions) with the
long-horizon satisfaction of the idle genre, without breaking the sim-first
architecture. This doc maps reward paths onto what already exists, proposes a
module ("league") pattern, and sequences the work.

## Ground rules (derived from the architecture)

1. **Meta-progression is an input, not a mutation.** Every persistent system
   must be expressible as a parameter to `createState(seed, meta)` — extra base
   stats, an expanded affix pool, run modifiers. A run stays a pure function:
   `run = f(seed, metaSnapshot, inputs)`. Determinism and replays survive.
2. **The autopilot IS the idle game.** Manual play beats it by design
   (`sim/autopilot.js`); that gap is the active-play reward. Idle progression
   should raise the autopilot's floor, never its ceiling above a human.
3. **No trade economy.** Browser, single-player — this is SSF. Economy means
   sinks and deterministic crafting, not markets. Smart-loot + pity
   (`sim/pity.js`) replace trading as the bad-luck valve.
4. **Items stay the power fantasy.** Idle-genre infinite multipliers inflate
   until items don't matter. Budget rule: total meta *scaling* stays small
   (≤ ~2x lifetime); meta *breadth* (unlocks) is uncapped.

## Reward path taxonomy

Two axes: **per-run vs. persistent**, and **scaling (infinite) vs.
completable (finite)**. A healthy game has all four quadrants; the current
build only has the top-left cell.

|                | Scaling (numbers go up)                          | Completable (checklists, 100%)                     |
|----------------|--------------------------------------------------|----------------------------------------------------|
| **Per-run**    | Gate affixes, wave-scaled (exists)               | Equipment slots filled, set bonuses, in-run objectives |
| **Persistent** | Legacy/echo currency → small % nodes, soft-capped | Affix-pool unlocks, zones, autopilot features, achievement stats |

### Per-run scaling — exists, needs a ceiling counterweight
Gate affixes scale linearly with depth (`scaleAffixDelta`, +19.7%/wave, no
cap). **Enemy *stats* do not scale with depth at all** — only wave count
(`5 + 3·depth`) and the type mix change. (An earlier draft of this doc said
difficulty "caps at 3x"; that was the legacy render layer's time-based
scaling, which the sim never had.)

So the only thing that ends a run today is enemy count outpacing your
clear speed, which lands around depth 4 standing still and depth 22+ kiting.
That works — runs do end — but it means difficulty is one-dimensional. For
the death→echoes loop to stay meaningful at depth 50+, enemy stats will need
a depth term of their own; otherwise affix scaling eventually wins outright.
Depth at death becomes the score that feeds meta currency.

### Per-run completable — equipment
`js/inventory.js` already stubs 10 slots and `slotPool` filtering works in
`AFFIX_POOL`. Items dropped in-run give a second, *spatial* progression track
(fill slots, upgrade pieces) alongside the gate's *temporal* track. Per-run
completable goals ("filled all slots with rare+") are the session-level
satisfaction the gate loop alone can't give.

### Persistent scaling — legacy currency (the idle anchor)
On death, award **echoes** proportional to depth reached (superlinear past
personal best, so pushing matters more than re-farming). Spend on a small
upgrade board: +X base damage, +Y starting HP, etc., with hard diminishing
returns. This is paragon/D3-altar territory — deliberately modest. Stored in a
new **profile state** beside run state (save schema v2; migration framework in
`sim/save.js` is ready and empty).

### Persistent completable — the real meta reward
The most architecture-friendly path, because the affix system is registry-shaped:

- **Affix-pool unlocks**: new affixes enter `AFFIX_POOL` only after an unlock
  ("kill 50 elites → unlocks `life_steal_2`"). The pool itself becomes the
  collection. Pure data: pool composition is part of `meta`.
- **Movement-AI unlocks** (now the strongest version of this idea): the
  movement policy ladder in `sim/movement.js` — `hold` → `center` → `patrol`
  → `kite` — spans death at depth 4 vs depth 22+ on identical seeds. That
  ~5x spread makes movement the single largest lever on run outcome, so
  selling better idle movement is real progression, not a stat trickle.
  `DEFAULT_POLICY` is deliberately `center` (not the best) to leave headroom.
  Gate these on the profile/unlock system rather than changing the default.
- **Autopilot upgrades**: unlock smarter *gate* heuristics (synergy awareness
  exists; add pity-awareness, build-commitment, defensive-panic). Buying
  intelligence for your idle worker is a proven idle-genre hook and it's just
  swapping the scoring function.
- **Zone/content unlocks**: `AreaManager` is a skeleton; zones unlock by
  meta milestones, each with its own enemy mix and marker pool.
- **Achievement stats**: finite checklist (D3 altar style) granting one-time
  small bonuses. Cheap to add, very completionist-friendly.

## Active vs. idle: split rewards by *kind*, not just size

The marker/elite layer (`js/enemies.js` elite abilities, `CONFIG.markers`)
is the active skill content; swarm waves are the idle throughput content.
Differentiate what they pay out:

- **Swarm / autopilot farming** → **quantity**: gold, echoes, common items,
  XP. High volume, low variance. Safe to grant offline.
- **Elite / boss / objective play** → **quality**: `sourcePool` affixes (the
  syntax already exists — `sourcePool: ['boss_skeleton_king']`), uniques,
  module-specific currencies, unlock progress. Telegraphed abilities (ground
  slam, dash) mean a human earns these; the autopilot shouldn't reliably clear
  them.

This makes "log in, do the boss content, leave the farm running" the natural
session shape — the D3/PoE session inside an idle wrapper. Movement is what
makes that split mechanically real rather than just a reward-table policy:
manual control (`input.move`) outperforms every idle policy, so encounters
worth doing by hand genuinely reward being at the keyboard, while farm modes
run on a policy you chose and upgraded.

### Offline progress: simulate it for real
Because `sim/` is pure and Node-importable, offline gains don't need to be
faked with a formula: on return, run the autopilot headless for the elapsed
time (fast-forwarded ticks, or sampled: simulate N representative minutes and
extrapolate). Cap offline hours like every idle game. Deterministic offline
progress — replayable, exploit-resistant — is a genuinely rare feature and a
direct payoff of the architecture.

## Economy: sinks before sources

Gold is a first-class sim entity (`sim/gold.js`) with kill drops as its
source. Ordered by leverage:

1. ~~**Gate manipulation**~~ — **shipped**. Gold rerolls the current gate's
   offers at `(5 + 3·depth) · 2^rerolls`, excluding held and already-offered
   affixes, without touching pity. Adding a 4th option is the natural
   follow-on. The autopilot never rerolls, so gold judgement stays a
   manual-play edge.
2. **Deterministic crafting**: PoE-style currencies, but each one is a pure
   function on item state (`reroll affix tier`, `add affix from tag X`,
   `upgrade rarity`). No trade means crafting must be the gear endgame; pity
   logic can extend to crafting outcomes.
3. **Gamble vendor**: gold → random item of chosen slot. Classic, simple sink.
4. **Respec / loadout costs** once persistent trees exist.

## The planning layer (ARPG "homework" between runs)

Planning is where ARPG players live between sessions. Three stages:

1. **Pre-run loadout**: a persistent **stash**. Items found in runs survive
   death; equip a starting loadout before the next run. Items become meta
   currency — the genre's core loop ("this run's drops make the next run
   better") with no extra systems.
2. **Map crafting / risk-reward**: spend currency to apply run modifiers at
   start ("+40% enemy HP, +25% item quantity"). Modifiers are inputs to
   `createState` — deterministic, and they're the contract between difficulty
   and reward that maps/torments provide.
3. **Atlas-style completable tree**: a node graph spending echoes/keys to
   unlock zones, raise module frequency, spec farming preferences. This is
   the long-term completable spine that ties every system above together.

## Modules ("leagues"): architecture

Each content module is a self-contained, data-first package:

```js
{
  id: 'bosskeys',
  status: 'temp' | 'core',          // PoE-style lifecycle
  affixes: [...],                    // merged into the run's affix pool
  enemyTemplates: {...},             // merged into spawn tables
  markers: [...],                    // merged into CONFIG.markers.pool
  currencies: [...],                 // module-scoped drops
  hooks: { onWaveStart, onGateGenerate, onKill, onDeath },
  saveSlice: { version, migrate },   // namespaced profile data
}
```

Required refactor: `AFFIX_POOL`, enemy templates, and the marker pool become
**registries composed at run start** from core + enabled modules, instead of
static arrays. The engine gains a small fixed set of hook points; modules
never patch the tick loop. Enabled-module list is part of `meta` → still
deterministic.

Lifecycle: a `temp` module's `saveSlice` is namespaced, so retiring one is a
save migration (archive or fold rewards into core) — "going core" is a flag
flip plus a migration entry.

First three module candidates, matching the active/idle split:

- **Boss keys** (active): elites drop key fragments → boss arena gate →
  `sourcePool` affixes and uniques. Exercises the elite ability content.
- **Breach-style surge** (idle): timed density spike mid-wave, pays quantity.
  Autopilot-friendly, makes farm mode spiky and watchable.
- **Map device** (planning): the risk/reward modifier system above, shipped
  as a module to prove the registry pattern reaches run-config too.

## Sequencing

Ordered by leverage-per-effort and dependency:

1. ~~**Gold sink: gate reroll/skip**~~ — **done**. Gold is a sim entity with
   kill drops and a reroll sink.
1b. ~~**Position & movement policies**~~ — **done**, and it turned out to be a
   prerequisite rather than a nicety: with enemies persisting, a position-less
   sim let incoming dps scale with wave size. Movement + a surround limit
   (`ENGAGEMENT_SLOTS`) fixed that, and handed the meta layer its best unlock
   track. Manual control is an input override, so ARPG encounters and idle
   farming share one tick.
2. **Profile state + echoes + small upgrade board** — save schema v2,
   separates run/profile state (every later system needs this split), first
   death→reward loop. The game stops being session-amnesiac here. **This is
   also where movement policies get gated** — today all four are freely
   selectable via `input.movePolicy`, which is the unlock ladder given away.
3. **Items + stash** — in-run drops into the stubbed slots, stash persists
   across runs, pre-run loadout. Items become the long-term chase.
4. **Module registry refactor + boss-keys module** — composable pools, engine
   hooks, first `sourcePool` content. Active play now has exclusive rewards.
5. **Offline autopilot farming** — headless sim of a designated farm zone,
   capped. The idle promise, delivered last because it needs 2–4 to have
   something worth accruing.

Each step ships a complete loop on its own; nothing depends on a later step
to feel finished.
