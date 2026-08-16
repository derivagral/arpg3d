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

## The loadout is static per run
Gear lives on the **profile** and reaches a run only through the `runMeta`
snapshot taken at `createState()`. It cannot change while the run is alive.

This is the roguelite contract (Slay the Spire, Rogue Genesia) rather than the
ARPG one: what you take in is what you fight with. It was chosen over live
swapping for a concrete reason — reproducing a run means replaying its
decisions, and a mid-run equip is a decision *about an item the log doesn't
know the stats of yet*. Making the loadout an input to the run instead of an
event inside it keeps `run = f(seed, runMeta, inputs)` genuinely small.

A run therefore carries **no equipment of its own** — a second copy on the
player would only be somewhere for the two to disagree (tested).

### Where the player actually equips
Because gear is fixed per run, equipping is a between-runs planning action, and
the run lifecycle is bound to the world:

| Event | Run |
|-------|-----|
| Enter the combat zone | `createState(seed, runMetaFor(profile))` — a new run wearing what you just chose |
| Return home / die | `awardRun()` — haul banks, echoes pay out |
| At home base | no run ticking; the loadout is editable |

The sim only ticks inside the combat zone. That's what makes "your loadout is
locked for the run" true rather than merely stated, and it gives home base a
job beyond being a lobby. The Armory's Loadout column is read-only during a
run — there's no action to offer, so it doesn't pretend there is.

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

`awardRun()` **copies** the haul into the vault — it cannot empty the run's
bag, because the bag is sim state and the profile is not. The caller must
clear it, keeping any `overflow` that didn't fit. Forgetting leaves the same
items in both columns, which reads as duplicated loot and duplicates for real
on the next "Store all". `sim/profile.test.js` pins the accounting: every
item ends up in exactly one of `stashed` or `overflow`.

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
**I** anywhere, or **E** at the home-base Armory (or `__openStash()`).

Terminology is deliberate — **Haul** (found this run) → **Vault** (kept
forever) → **Loadout** (worn). Internal field names still read `inventory` /
`stash` / `equipment`; renaming those would be a save migration for no
player-visible gain.

Three columns:

- **Haul** — click an item to store it; "Store all" empties it into the Vault
- **Vault** — click to equip into the best slot via `bestSlotFor()`, which
  prefers an empty compatible slot and otherwise replaces your *weakest* one,
  so a second ring fills the free finger instead of overwriting the first
- **Loadout** — click to return a piece to the Vault; "Best" runs `autoEquip()`

It reads the canonical sources directly (SimState bag, profile stash/loadout)
and routes every mutation through the pure helpers in `sim/inventory.js`, so
the panel owns no state of its own. It deliberately does **not** touch the
legacy `InventoryManager`.

The panel takes `canEquip()` and renders the Loadout column read-only when it
returns false (i.e. mid-run), with the reason stated in the header.

## One item pipeline, one gear screen
The legacy layer used to roll its own item on every kill with `Math.random()`
and its own generator, so the loot on the ground had nothing to do with the
loot you owned. That generator (`js/items.js`), the legacy container
(`js/inventory.js`), and the legacy inventory screen it fed have all been
deleted — **I** now opens the same panel as **E**. One item system, one view.

Now:

```
sim rolls the item (seeded) → banked into the run bag → logs 'item_drop'
  → src/main.js drains new item_drop events into game.simDropQueue
  → js/game.js shows the next queued drop at the corpse it just made
  → collecting it is cosmetic (flashLoot toast); the item is already yours
```

Sim-owned pickups carry `fromSim: true`. They never re-enter the legacy bag
(the item would exist twice) and are never blocked by the legacy bag being
full. `ItemGenerator` in `js/items.js` is now unused by the drop path.

## Movement policies have no selector yet
`syncSimToRender()` is no longer a stub: inside the combat zone the rendered
player **is** the sim player, so the policy ladder is now visible behaviour
rather than a balance model with no expression on screen. See
docs/sim/movement.md.

What is still missing is only the *view*. `input.movePolicy` is restored from
`profile.movePolicy` and changed through `game.movement.set()`, which the dev
console reaches as `window.__setMovePolicy()`; nothing in the game surfaces the
choice. The mechanism underneath (persisted preference, validated setter,
`POLICY_META` labels) is complete and is what a selector would bind to.

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
- No character-stats panel yet. The legacy inventory screen carried one; it
  was removed with the rest of that screen and hasn't been rebuilt on the new
  view.
- No crafting, no vendor, no item-level rarity bonuses per zone.
- Vault overflow stays in the haul with a console warning rather than being
  destroyed, but a new run recreates the haul — so it is lost if you don't
  make room before heading out. A real overflow tab is the eventual fix.
