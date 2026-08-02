# Sim — Items, Inventory & Stash

## Why items exist alongside gate affixes
The gate gives you affixes over **time** within a run; items give you affixes
across **slots** and persist **between** runs. Both feed the same stat
derivation, so an item mod and a gate pick are mechanically identical — only
their acquisition and lifetime differ.

## Item shape
```js
{ uid, kind, slot, rarity, ilvl, affixes: [{ id, delta }] }
```

Affixes are stored compactly as `{ id, delta }` because that is **everything**
`deriveStats()` and `aggregateDamageModifiers()` read. An item therefore needs
no hydration to be mechanically correct, and an affix removed from the pool
degrades to a still-working item with an unknown label rather than breaking a
save. Names/descriptions come from `affixMeta(id)` for UI only.

`uid` is unique per character and comes from `SimState.nextUid`, threaded
through state like `nextId` — never a module counter, which would diverge on
resume and break determinism.

## Generation
`rollItem(rng, { ilvl, uid, kind, sourceId })` is seeded and threads rng state,
so a run's drops replay identically. Rarity sets the affix count:

| Rarity    | Weight | Affixes |
|-----------|--------|---------|
| common    | 60     | 1       |
| uncommon  | 25     | 2       |
| rare      | 10     | 3       |
| epic      | 4      | 4       |
| legendary | 1      | 5       |

Drops roll on kill via `rollItemDrop(type, rng, { ilvl: depth })` at per-type
chances mirroring `CONFIG.items.dropChances` (basic 5%, fast 8%, tank 12%,
swarm 3%). `ilvl` tracks depth, so deeper runs roll stronger affixes through
the existing `scaleAffixDelta` wave scaling. Items do **not** use gate pity — a
neutral pity state gives every affix its natural weight.

Unknown enemy types never drop and consume no rng.

## Three containers
All are plain `item|null` arrays so a slot index is stable — moving one item
never reshuffles the others.

| Container | Size | Lives in | Lifetime |
|-----------|------|----------|----------|
| run inventory | `INVENTORY_SIZE` (48) | `SimState.player.inventory` | one run |
| stash | `STASH_SIZE` (240) | `profile.stash` | forever |
| equipment | 10 slots | `profile.equipment` | forever |

Sizes are deliberately generous — sorting gear should be the interesting part,
not fighting for space. `CONFIG.inventory` mirrors these for the legacy UI.

## Equipment lives on the profile, not the run
You choose a loadout at home base between runs; it enters the run through the
`runMeta` snapshot like every other piece of meta. A run never re-equips
itself, so **gear cannot change mid-run** and replays stay reproducible
(tested). Changing gear applies to the *next* run.

`statsForRun(runMeta, runAffixes)` in `sim/player.js` is the single place gear
affixes and gate affixes are combined. `createState()` sizes starting hp from
that same function — an earlier version used `baseForRun()`, which applies meta
upgrades but not gear, so a geared run started at 100/129 hp instead of full.

Rings are generic on drop (`kind: 'ring'`) and fit either `ring1` or `ring2`.

## Loot flow
```
kill → rollItemDrop → run inventory (full bag logs 'item_lost')
run ends → awardRun() folds the haul into profile.stash
home base → equip from stash → next run starts with it
```

Items **survive death**. Losing them would make the idle half punishing, and
the stash is the whole point of the loop. A full stash reports `overflow`
rather than silently eating loot.

## Home base
`homeBase` holds two interactables, deliberately distinct so you never start a
fight while looking for gear:

|          | Combat portal        | Stash                        |
|----------|----------------------|------------------------------|
| Colour   | red                  | blue                         |
| Shape    | tall cylinder        | squat chest + floating beacon |
| Position | `(0, 2, -10)`        | `(0, 0.75, 10)` — opposite side |
| Trigger  | walk in (automatic)  | press **E** (deliberate)     |
| Prompt   | "Combat Zone"        | "Stash — store and equip gear" |

The stash requires a keypress precisely because a portal does not: walking past
your storage should never pull you into a menu, and walking into red should
never be ambiguous.

## The stash screen
`src/ui/stashPanel.js` is the Bag ⇄ Stash ⇄ Equipment surface, opened with
**E** at the home-base stash (or `__openStash()`). Three columns:

- **Run Bag** — click an item to move it to the stash; "Deposit all" empties it
- **Stash** — click to equip into the best slot via `bestSlotFor()`, which
  prefers an empty compatible slot and otherwise replaces your *weakest* one,
  so a second ring fills the free finger instead of overwriting the first
- **Equipped** — click to return a piece to the stash; "Auto" runs `autoEquip()`

It reads the canonical sources directly (SimState bag, profile stash/loadout)
and routes every mutation through the pure helpers in `sim/inventory.js`, so
the panel owns no state of its own. It deliberately does **not** touch the
legacy `InventoryManager`.

Gear changes apply to the **next** run — the screen says so, because the
snapshot rule makes it non-obvious.

## One item pipeline
The legacy layer used to roll its own item on every kill with `Math.random()`
and its own generator, so the loot on the ground had nothing to do with the
loot you owned. Now:

```
sim rolls the item (seeded) → banked into the run bag → logs 'item_drop'
  → src/main.js drains new item_drop events into game.simDropQueue
  → js/game.js shows the next queued drop at the corpse it just made
  → collecting it is cosmetic (flashLoot toast); the item is already yours
```

Sim-owned pickups carry `fromSim: true`. They never re-enter the legacy bag
(the item would exist twice) and are never blocked by the legacy bag being
full. `ItemGenerator` in `js/items.js` is now unused by the drop path.

## Dev console
```js
window.__bag()            // items found in the current run
window.__stash()          // stored items
window.__gear()           // equipped loadout + score
window.__equip(i, slot)   // equip stash item i (applies NEXT run)
window.__unequip(slot)
window.__autoEquip()      // greedily equip the best of everything
window.__sortStash()
window.__stashItem(i)     // move a bag item straight to the stash
```

## Known gaps (deliberate — systems first, UX later)
- No drag-and-drop, no filters, no multi-select; transfer is click-per-item
  plus the bulk buttons.
- The legacy inventory screen (**I**) still exists over the legacy item
  system. It is now the *only* place legacy items appear, since drops no
  longer create them; it should be retired once its stat panel moves over.
- No crafting, no vendor, no item-level rarity bonuses per zone.
- Stash overflow drops loot on run end (reported in console). A real "overflow
  tab" or forced cleanup prompt is the eventual fix.
