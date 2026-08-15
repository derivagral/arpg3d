/**
 * sim/inventory.test.js — item generation, containers, equipment, stash flow
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SLOTS, RARITIES, ITEM_DROPS,
  rollItem, rollItemDrop, itemScore, itemName, slotAccepts,
} from './items.js'
import {
  INVENTORY_SIZE, STASH_SIZE,
  createInventory, createStash, createEquipment, createContainer,
  addItem, addItems, removeAt, transfer, compact, sortContainer,
  firstEmpty, isFull, countItems,
  equipFrom, unequipTo, equippedAffixes, loadoutScore, autoEquip, bestSlotFor,
  hydrateContainer, hydrateEquipment,
} from './inventory.js'
import { createRNG } from './rng.js'
import { createState, tick } from './engine.js'
import { createProfile, awardRun, summarizeRun, runMetaFor } from './profile.js'
import { statsForRun } from './player.js'
import { serializeSim, hydrateSim } from './save.js'

const mkItem = (over = {}) => ({
  uid: 1, kind: 'weapon', slot: 'weapon', rarity: 'common', ilvl: 1,
  affixes: [{ id: 'flat_dmg_1', delta: { flatDamage: 2 } }],
  ...over,
})

// ── Generation ───────────────────────────────────────────────────────────────

test('rollItem is deterministic for the same rng state', () => {
  const rng = createRNG(99)
  assert.deepEqual(rollItem(rng, { ilvl: 5, uid: 1 }), rollItem(rng, { ilvl: 5, uid: 1 }))
})

test('rolled items have a valid kind, rarity, and the right affix count', () => {
  let rng = createRNG(7)
  for (let i = 0; i < 300; i++) {
    const [item, next] = rollItem(rng, { ilvl: 3, uid: i })
    rng = next
    const rarity = RARITIES.find(r => r.id === item.rarity)
    assert.ok(rarity, `unknown rarity ${item.rarity}`)
    assert.equal(item.affixes.length, rarity.affixes)
    assert.ok(item.affixes.every(a => a.id && a.delta), 'affixes must be {id, delta}')
    const ids = item.affixes.map(a => a.id)
    assert.equal(new Set(ids).size, ids.length, 'no duplicate affixes on one item')
  }
})

test('rarer items carry more affixes than common ones', () => {
  const common = RARITIES.find(r => r.id === 'common').affixes
  const legendary = RARITIES.find(r => r.id === 'legendary').affixes
  assert.ok(legendary > common)
})

test('rollItemDrop respects per-type chance and never drops for unknown types', () => {
  const [none, rng] = rollItemDrop('mystery', createRNG(1))
  assert.equal(none, null)
  assert.equal(rng, createRNG(1), 'unknown type consumes no rng')

  let r = createRNG(3)
  let drops = 0
  const trials = 3000
  for (let i = 0; i < trials; i++) {
    const [item, next] = rollItemDrop('tank', r, { ilvl: 1, uid: i })
    r = next
    if (item) drops++
  }
  const rate = drops / trials
  assert.ok(Math.abs(rate - ITEM_DROPS.tank) < 0.04, `tank drop rate ${rate}`)
})

test('itemScore ranks a richer item above a plainer one', () => {
  const plain = mkItem()
  const rich = mkItem({ affixes: [
    { id: 'flat_dmg_2', delta: { flatDamage: 5 } },
    { id: 'max_hp_1', delta: { maxHp: 12 } },
  ] })
  assert.ok(itemScore(rich) > itemScore(plain))
  assert.equal(itemScore(null), 0)
  assert.ok(itemName(plain).length > 0)
})

// ── Containers ───────────────────────────────────────────────────────────────

test('containers start empty at the configured size', () => {
  assert.equal(createInventory().length, INVENTORY_SIZE)
  assert.equal(createStash().length, STASH_SIZE)
  assert.ok(INVENTORY_SIZE >= 40, 'inventory should be generous, not fiddly')
  assert.equal(countItems(createInventory()), 0)
  assert.equal(firstEmpty(createInventory()), 0)
})

test('addItem fills the first empty slot and reports failure when full', () => {
  let c = createContainer(2)
  ;({ container: c } = addItem(c, mkItem({ uid: 1 })))
  ;({ container: c } = addItem(c, mkItem({ uid: 2 })))
  assert.ok(isFull(c))

  const res = addItem(c, mkItem({ uid: 3 }))
  assert.equal(res.added, false)
  assert.equal(res.index, -1)
  assert.equal(res.container, c, 'a failed add returns the same container')
})

test('addItems reports overflow rather than dropping loot silently', () => {
  const c = createContainer(2)
  const items = [mkItem({ uid: 1 }), mkItem({ uid: 2 }), mkItem({ uid: 3 })]
  const { container, added, overflow } = addItems(c, items)
  assert.equal(added.length, 2)
  assert.equal(overflow.length, 1)
  assert.equal(countItems(container), 2)
})

test('removeAt clears exactly one slot and leaves indices stable', () => {
  let c = createContainer(3)
  ;({ container: c } = addItem(c, mkItem({ uid: 1 })))
  ;({ container: c } = addItem(c, mkItem({ uid: 2 })))

  const { container, item } = removeAt(c, 0)
  assert.equal(item.uid, 1)
  assert.equal(container[0], null)
  assert.equal(container[1].uid, 2, 'other items must not shift')

  assert.equal(removeAt(container, 0).item, null, 'removing an empty slot is a no-op')
  assert.equal(removeAt(container, 99).item, null, 'out of range is a no-op')
})

test('transfer moves between containers and is a no-op when the target is full', () => {
  let from = createContainer(2)
  ;({ container: from } = addItem(from, mkItem({ uid: 1 })))
  const to = createContainer(1)

  const ok = transfer(from, to, 0)
  assert.equal(ok.moved.uid, 1)
  assert.equal(countItems(ok.from), 0)
  assert.equal(countItems(ok.to), 1)

  let full = createContainer(1)
  ;({ container: full } = addItem(full, mkItem({ uid: 9 })))
  let src = createContainer(1)
  ;({ container: src } = addItem(src, mkItem({ uid: 2 })))
  const blocked = transfer(src, full, 0)
  assert.equal(blocked.moved, null)
  assert.equal(countItems(blocked.from), 1, 'item stays put when it cannot move')
})

test('compact and sort preserve every item', () => {
  let c = createContainer(5)
  c[3] = mkItem({ uid: 1 })
  c[0] = mkItem({ uid: 2, affixes: [{ id: 'max_hp_2', delta: { maxHp: 29 } }] })

  const packed = compact(c)
  assert.equal(countItems(packed), 2)
  assert.ok(packed[0] && packed[1])

  const sorted = sortContainer(c)
  assert.equal(countItems(sorted), 2)
  assert.ok(itemScore(sorted[0]) >= itemScore(sorted[1]), 'best first')
})

// ── Equipment ────────────────────────────────────────────────────────────────

test('equipping moves the item out of the container into the slot', () => {
  let inv = createContainer(4)
  ;({ container: inv } = addItem(inv, mkItem({ uid: 1 })))

  const res = equipFrom(createEquipment(), inv, 0, 'weapon')
  assert.equal(res.equipped.uid, 1)
  assert.equal(res.equipment.weapon.uid, 1)
  assert.equal(countItems(res.container), 0)
})

test('equipping over an occupied slot swaps rather than destroying gear', () => {
  let inv = createContainer(4)
  ;({ container: inv } = addItem(inv, mkItem({ uid: 1 })))
  ;({ container: inv } = addItem(inv, mkItem({ uid: 2 })))

  let { equipment, container } = equipFrom(createEquipment(), inv, 0, 'weapon')
  // uid 1 left index 0; uid 2 is still at index 1
  const swap = equipFrom(equipment, container, 1, 'weapon')

  assert.equal(swap.equipment.weapon.uid, 2)
  assert.equal(countItems(swap.container), 1, 'the old weapon came back')
  assert.equal(swap.container.find(Boolean).uid, 1)
})

test('items only fit slots that accept them, and rings fit either finger', () => {
  const ring = mkItem({ uid: 5, kind: 'ring', slot: 'ring' })
  assert.ok(slotAccepts('ring1', ring))
  assert.ok(slotAccepts('ring2', ring))
  assert.ok(!slotAccepts('head', ring))

  let inv = createContainer(2)
  ;({ container: inv } = addItem(inv, mkItem({ uid: 1 })))  // weapon
  const bad = equipFrom(createEquipment(), inv, 0, 'head')
  assert.equal(bad.equipped, null)
  assert.match(bad.reason, /does not fit/)

  const unknown = equipFrom(createEquipment(), inv, 0, 'nonsense')
  assert.equal(unknown.reason, 'unknown slot')
})

test('unequip returns gear to the container, or no-ops when there is no room', () => {
  let inv = createContainer(1)
  ;({ container: inv } = addItem(inv, mkItem({ uid: 1 })))
  const { equipment, container } = equipFrom(createEquipment(), inv, 0, 'weapon')

  const back = unequipTo(equipment, container, 'weapon')
  assert.equal(back.removed.uid, 1)
  assert.equal(back.equipment.weapon, null)

  // Container full → gear stays equipped rather than vanishing
  let full = createContainer(1)
  ;({ container: full } = addItem(full, mkItem({ uid: 7 })))
  const blocked = unequipTo(equipment, full, 'weapon')
  assert.equal(blocked.removed, null)
  assert.equal(blocked.equipment.weapon.uid, 1)

  assert.equal(unequipTo(createEquipment(), full, 'weapon').removed, null, 'empty slot no-ops')
})

test('equippedAffixes flattens every worn item', () => {
  const eq = createEquipment()
  eq.weapon = mkItem({ uid: 1 })
  eq.head = mkItem({ uid: 2, kind: 'head', slot: 'head', affixes: [{ id: 'max_hp_1', delta: { maxHp: 12 } }] })

  const affixes = equippedAffixes(eq)
  assert.equal(affixes.length, 2)
  assert.deepEqual(equippedAffixes(null), [])
  assert.ok(loadoutScore(eq) > 0)
})

test('bestSlotFor fills an empty slot before replacing a worn one', () => {
  const ring = mkItem({ uid: 5, kind: 'ring', slot: 'ring' })
  const eq = createEquipment()

  assert.equal(bestSlotFor(ring, eq), 'ring1', 'first ring goes to the free finger')

  eq.ring1 = mkItem({ uid: 6, kind: 'ring', slot: 'ring' })
  assert.equal(bestSlotFor(ring, eq), 'ring2', 'second ring must not overwrite the first')

  // Both fingers full → replace the weaker one
  eq.ring1 = mkItem({ uid: 7, kind: 'ring', slot: 'ring',
    affixes: [{ id: 'flat_dmg_2', delta: { flatDamage: 99 } }] })
  eq.ring2 = mkItem({ uid: 8, kind: 'ring', slot: 'ring',
    affixes: [{ id: 'flat_dmg_1', delta: { flatDamage: 1 } }] })
  assert.equal(bestSlotFor(ring, eq), 'ring2', 'replaces the weakest ring')

  assert.equal(bestSlotFor(null, eq), null)
  assert.equal(bestSlotFor({ kind: 'junk', slot: 'junk', affixes: [] }, eq), null)
  assert.equal(bestSlotFor(mkItem(), createEquipment()), 'weapon')
})

test('autoEquip takes upgrades and leaves worse items alone', () => {
  let inv = createContainer(6)
  const weak = mkItem({ uid: 1, affixes: [{ id: 'flat_dmg_1', delta: { flatDamage: 2 } }] })
  const strong = mkItem({ uid: 2, affixes: [{ id: 'flat_dmg_2', delta: { flatDamage: 50 } }] })
  ;({ container: inv } = addItem(inv, weak))
  ;({ container: inv } = addItem(inv, strong))

  const res = autoEquip(createEquipment(), inv)
  assert.equal(res.equipment.weapon.uid, 2, 'best weapon wins')

  const again = autoEquip(res.equipment, res.container)
  assert.equal(again.changes.length, 0, 'nothing left to upgrade')
})

// ── Integration: drops → stash → equipment → stats ──────────────────────────

test('kills drop items into the run inventory', () => {
  let s = createState(4242)
  for (let i = 0; i < 200000 && s.phase !== 'dead'; i++) {
    s = tick(s, 16.67, { gateChoice: null, autopilot: true })
  }
  const found = s.player.inventory.filter(Boolean)
  assert.ok(found.length > 0, 'a full run should drop at least one item')
  assert.ok(s.log.some(e => e.type === 'item_drop'))
  assert.ok(found.every(it => it.uid > 0), 'items carry unique ids')
  assert.equal(new Set(found.map(i => i.uid)).size, found.length, 'uids are unique')
})

test('a finished run deposits its haul into the character stash', () => {
  let s = createState(4242)
  for (let i = 0; i < 200000 && s.phase !== 'dead'; i++) {
    s = tick(s, 16.67, { gateChoice: null, autopilot: true })
  }
  const haul = s.player.inventory.filter(Boolean)
  const { profile, stashed, overflow } = awardRun(createProfile(), summarizeRun(s))

  assert.equal(stashed.length, haul.length)
  assert.equal(overflow.length, 0)
  assert.equal(countItems(profile.stash), haul.length)
})

test('a full stash reports overflow instead of losing items', () => {
  const profile = { ...createProfile(), stash: new Array(STASH_SIZE).fill(mkItem()) }
  const { overflow } = awardRun(profile, {
    depth: 2, kills: {}, gold: 0, elapsed: 1, items: [mkItem({ uid: 999 })],
  })
  assert.equal(overflow.length, 1)
})

test('equipped gear changes a run’s derived stats', () => {
  const eq = createEquipment()
  eq.weapon = mkItem({ uid: 1, affixes: [{ id: 'flat_dmg_2', delta: { flatDamage: 5 } }] })
  eq.head = mkItem({ uid: 2, kind: 'head', slot: 'head', affixes: [{ id: 'max_hp_2', delta: { maxHp: 29 } }] })

  const bare = statsForRun(runMetaFor(createProfile()), [])
  const geared = statsForRun(runMetaFor({ ...createProfile(), equipment: eq }), [])

  assert.equal(geared.flatDamage, bare.flatDamage + 5)
  assert.equal(geared.maxHp, bare.maxHp + 29)
})

test('a geared run starts with the extra health its gear grants', () => {
  const eq = createEquipment()
  eq.chest = mkItem({ uid: 1, kind: 'chest', slot: 'chest', affixes: [{ id: 'max_hp_2', delta: { maxHp: 29 } }] })
  const geared = createState(1, runMetaFor({ ...createProfile(), equipment: eq }))
  assert.equal(geared.player.maxHp, createState(1).player.maxHp + 29)
  assert.equal(geared.player.hp, geared.player.maxHp)
})

test('gear cannot change mid-run', () => {
  const eq = createEquipment()
  eq.weapon = mkItem({ uid: 1 })
  const profile = { ...createProfile(), equipment: eq }
  const s = createState(5, runMetaFor(profile))

  profile.equipment.weapon = mkItem({ uid: 2, affixes: [{ id: 'flat_dmg_2', delta: { flatDamage: 999 } }] })
  const after = tick(s, 16.67, { autopilot: false })
  assert.equal(after.runMeta.equipment.weapon.uid, 1, 'run keeps its snapshot loadout')
})

// ── Persistence ──────────────────────────────────────────────────────────────

test('run inventory and loadout survive a save round-trip', () => {
  const eq = createEquipment()
  eq.weapon = mkItem({ uid: 1 })
  let s = createState(4242, runMetaFor({ ...createProfile(), equipment: eq }))
  for (let i = 0; i < 40000 && s.phase !== 'dead'; i++) {
    s = tick(s, 16.67, { gateChoice: null, autopilot: true })
  }

  const { state: h } = hydrateSim(serializeSim(s))
  assert.deepEqual(h.player.inventory, s.player.inventory)
  assert.equal(h.nextUid, s.nextUid)
  assert.deepEqual(h.runMeta.equipment, s.runMeta.equipment)
})

test('pre-item snapshots hydrate with an empty bag and no loadout', () => {
  const snap = serializeSim(createState(3))
  delete snap.player.inventory
  delete snap.nextUid
  delete snap.runMeta.equipment

  const { state } = hydrateSim(snap)
  assert.equal(state.player.inventory.length, INVENTORY_SIZE)
  assert.equal(countItems(state.player.inventory), 0)
  assert.equal(state.nextUid, 1)
  assert.deepEqual(state.runMeta.equipment, createEquipment())
})

test('hydrateContainer and hydrateEquipment tolerate junk and resize', () => {
  assert.equal(hydrateContainer(null, 5).length, 5)
  assert.equal(hydrateContainer('nonsense', 5).length, 5)

  // Oversized input keeps every item it can rather than truncating blindly
  const oversized = new Array(8).fill(null).map((_, i) => mkItem({ uid: i + 1 }))
  const shrunk = hydrateContainer(oversized, 5)
  assert.equal(shrunk.length, 5)
  assert.equal(countItems(shrunk), 5)

  assert.deepEqual(hydrateEquipment(null), createEquipment())
  assert.equal(hydrateEquipment({ weapon: mkItem(), bogus: mkItem() }).weapon.uid, 1)
  assert.ok(!('bogus' in hydrateEquipment({ bogus: mkItem() })))
})

test('every equipment slot is a known slot', () => {
  assert.deepEqual(Object.keys(createEquipment()), SLOTS)
})
