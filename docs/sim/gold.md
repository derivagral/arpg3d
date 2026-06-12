# Sim — Gold

## What is gold?
Gold is the run's spendable currency, owned by `sim/gold.js`. It is a
first-class entity: every source and sink goes through this module so other
systems (markers, objectives, future modules) can interact with gold without
touching the tick loop.

Current source: enemy kills. Current sink: gate rerolls.

## What counts as a kill
Any enemy death the player survives — both attack kills and melee trades
(the current melee rule consumes an enemy when it lands a contact hit).
A credited kill grants xp, increments `player.kills[type]`, applies
lifesteal, and rolls a gold drop. The shared path is `creditKill()` inside
`engine.js` tick. If melee behavior later changes to persistent attackers,
trade-credits disappear naturally and all drops migrate to attack kills.

`player.kills` is a per-type counter (`{ basic: 12, tank: 3, ... }`) — it
exists so kill-count-driven systems (unlocks, achievements, alternative gold
formulas) have data to hook into without a save migration later.

## Drop table
```js
GOLD_DROPS = {
  basic: { chance: 0.30, min: 1, max: 3 },
  fast:  { chance: 0.25, min: 2, max: 4 },
  tank:  { chance: 0.50, min: 5, max: 10 },
  swarm: { chance: 0.15, min: 1, max: 2 },
}
```
Values mirror the legacy render layer (js/config.js) so the sim economy
matches what players already see. Unknown enemy types drop nothing and
consume no rng — new types are goldless until added here.

`rollGoldDrop(type, rng, mult)` returns `[amount, nextRng]`; `amount` is 0
on a miss. `mult` is the quantity hook for gold-find stats, markers
(Greed Totem), and modules — a successful drop never pays less than 1.

## Gate reroll sink
```js
rerollCost(depth, rerollsUsed) = (5 + 3 * depth) * 2 ** rerollsUsed
```
- Scales with depth because income does (bigger waves, better types).
- Doubles per reroll within the same gate — chains get prohibitive fast.
- Tuning intent: the first reroll is out of reach at the depth-2 gate
  (~5–10 gold held vs cost 11), affordable at depth 3+ if the player saved.
  Rerolling should feel like spending a wave's income, not a tax.

Mechanics live in `gate.js → rerollGate(state)`; see docs/sim/gate.md.

## Log events
- `gold_drop` `{ id, amount }` — on a successful drop (render hook for
  pickup visuals/sfx)
- `gate_rerolled` `{ depth, cost, rerolls }` — on a paid reroll

## Save format
`player.gold` was already in schema v1. `player.kills` and `gate.rerolls`
are additive fields — old snapshots hydrate them to `{}` / `0`, no version
bump or migration required.

## Future sources/sinks (design intent)
Sources: objectives, markers, offline autopilot payouts, module currencies.
Sinks: crafting, gambling, respec. All should be pure functions in this
module (or their own module importing this one), never inline in tick().
See docs/design/rewards-and-loops.md for the roadmap.
