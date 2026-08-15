# Sim — Profile (meta progression)

## A slot is a character
A save slot owns a **profile** that survives death; runs are attempts inside
it. Deleting a slot deletes its meta, so a new slot is a genuine fresh start.

This is also the cheap path to leagues/seasons later: a temporary league is
just another profile, not a new storage tier. A global "account" tier can be
layered on top without moving anything that exists today.

## The determinism rule
**A run never reads profile state while it ticks.** The profile is
snapshotted into the run at creation as `SimState.runMeta`, so

```
run = f(seed, runMeta, inputs)
```

stays true. Buying an upgrade mid-run cannot retroactively change a replay,
and offline simulation (roadmap step 5) stays reproducible. `createState(seed,
runMeta)` takes the snapshot; `baseForRun(runMeta)` turns it into the run's
base stats. Passing a live profile object into a run is a bug.

## Shape
```js
{
  v, echoes, spent, bestDepth, runs,
  lifetime: { kills: {type: n}, gold, depth, elapsed },
  upgrades: { [upgradeId]: level },
  unlocks: ['policy:patrol', ...],
  achievements: ['depth_4', ...],
}
```

`runMetaFor(profile)` → `{ upgrades, policies }` — everything a run needs and
nothing that can change under it.

## Echoes
Awarded by `awardRun()` when a run ends:

- **base** — `depth·(depth+1)/2`. Triangular, so payout grows with the *square*
  of depth: a deep run is worth far more than several shallow ones. An earlier
  flat per-depth rate meant farming a comfortable depth paid the same trickle
  forever and the board never funded itself.
- **pb** — 25 per depth level beyond your previous record. Pushing beats
  repeating a safe depth.

Both halves exist on purpose: base keeps idle farming worthwhile, pb keeps
pushing worthwhile.

## Upgrade board
Four upgrades, all capped so a fully-maxed board stays within roughly a **2x**
power budget (enforced by test). Deliberately not damage-dense — items
(roadmap step 3) are meant to be the power fantasy, and a board granting big
flat damage spends that budget twice.

| Upgrade  | Effect                | Max |
|----------|-----------------------|-----|
| Vitality | +8 max health         | 8   |
| Might    | +2 base damage        | 8   |
| Recovery | +0.4 hp/sec regen     | 5   |
| Reach    | +0.5 attack range     | 4   |

**No upgrade may ever grant move speed.** The movement balance rests on the
`fast` archetype (0.17) outrunning the player (0.15); a meta move-speed bonus
re-creates the bug where every movement policy becomes unkillable.
`sim/profile.test.js` enforces this against the whole board.

## Achievements → movement policies
The persistent-*completable* track. Policies are **earned, not bought** — they
read as mastery, and echoes stay the numeric currency.

| Achievement | Requirement          | Grants          |
|-------------|----------------------|-----------------|
| Descent     | Reach depth 4        | `policy:patrol` |
| Evasion     | Reach depth 20       | `policy:kite`   |
| Slayer      | 1000 lifetime kills  | —               |
| Hoarder     | 2000 lifetime gold   | —               |

Threshold tuning is load-bearing. The `center` default plateaus at depth 4, so
**the first unlock must be reachable by the policy the player already has**.
An earlier draft gated patrol at depth 6: no idle run could ever reach it and
progression deadlocked at a flat trickle forever. Verify any threshold change
by simulating the loop headlessly, not by eye.

The engine clamps `input.movePolicy` to `runMeta.policies` — the sim never
trusts the input to be legitimate.

## Measured progression
Autopilot gate picks, greedy shopper, best unlocked policy each run:

| Run | Policy | Depth | Echoes | Note                    |
|-----|--------|-------|--------|-------------------------|
| 1   | center | 4     | 110    | unlocks patrol          |
| 2   | patrol | 22    | 703    | unlocks kite            |
| 3   | kite   | 49    | 1900   | Slayer + Hoarder        |
| 4   | kite   | 54    | 1610   | board maxed             |
| 5+  | kite   | ~50-60| ~1500  | echoes accumulate unspent |

**Known runway limit**: the board maxes around run 4 and echoes then pile up
with nothing to buy. That is the designed handoff to items/stash (step 3) and
modules (step 4) — the board is a starter sink, not the long tail. If those
slip, add board tiers or an echo→gold conversion rather than raising the 2x cap.

## Save integration
Schema **v2**. The profile lives on the SaveFile envelope beside `sim`, and
`buildMeta()` denormalizes `echoes`/`bestDepth`/`runs` so slot lists can show
a character's standing without hydrating the sim.

`MIGRATIONS[1]` upgrades v1 saves: they gain a fresh profile and their run
gains a base-policy `runMeta`, loading as a brand-new character mid-run with
nothing lost. This is the first migration the framework has actually run.

## Dev console
```js
window.__profile()       // echoes, record depth, unlocks, lifetime stats
window.__board()         // upgrades with level/cost/affordability
window.__buy(id)         // buy a level — applies to the NEXT run
window.__achievements()  // checklist and what each grants
window.__movePolicies()  // all vs unlocked vs active-this-run
window.__endRun()        // end the run now and bank its echoes
```
