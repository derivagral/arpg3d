/**
 * sim/inventory.js — Bounded item containers and equipment (pure)
 *
 * Three containers, all plain arrays of `item|null` so a slot index is stable
 * (moving an item never reshuffles the others):
 *
 *   run inventory — what you picked up this run, lives in SimState
 *   stash         — persists on the character profile, survives death
 *   equipment     — a slot→item map on the profile; the loadout a run starts with
 *
 * Equipment lives on the PROFILE, not the run: you choose a loadout at home
 * base between runs, and it enters the run through the runMeta snapshot like
 * every other piece of meta (see sim/profile.js). A run never re-equips
 * itself, so gear can't change mid-run and break replay determinism.
 *
 * Every function is pure and returns new containers.
 */

import { SLOTS, slotAccepts, itemScore } from './items.js'

/** Room for a full run's drops without babysitting — QoL, not a challenge. */
export const INVENTORY_SIZE = 48
/** Deep enough that sorting/upgrading is the point, not capacity anxiety. */
export const STASH_SIZE = 240

export const createContainer = (size) => new Array(size).fill(null)
export const createInventory = () => createContainer(INVENTORY_SIZE)
export const createStash = () => createContainer(STASH_SIZE)

export const createEquipment = () =>
  Object.fromEntries(SLOTS.map(s => [s, null]))

// ── Container operations ─────────────────────────────────────────────────────

export const firstEmpty = (container) => container.findIndex(s => s === null)
export const isFull = (container) => firstEmpty(container) === -1
export const countItems = (container) => container.reduce((n, s) => n + (s ? 1 : 0), 0)

/**
 * Add an item at the first empty slot.
 * @returns {{ container: (object|null)[], added: boolean, index: number }}
 */
export const addItem = (container, item) => {
  if (!item) return { container, added: false, index: -1 }
  const index = firstEmpty(container)
  if (index === -1) return { container, added: false, index: -1 }
  const next = [...container]
  next[index] = item
  return { container: next, added: true, index }
}

/**
 * Add as many items as fit, reporting what didn't.
 * @returns {{ container, added: object[], overflow: object[] }}
 */
export const addItems = (container, items = []) => {
  let next = container
  const added = []
  const overflow = []
  for (const item of items) {
    const res = addItem(next, item)
    if (res.added) { next = res.container; added.push(item) }
    else overflow.push(item)
  }
  return { container: next, added, overflow }
}

/** @returns {{ container, item: object|null }} */
export const removeAt = (container, index) => {
  if (index < 0 || index >= container.length || !container[index]) {
    return { container, item: null }
  }
  const next = [...container]
  const item = next[index]
  next[index] = null
  return { container: next, item }
}

/** Move an item between two containers. No-op if source empty or dest full. */
export const transfer = (from, to, index) => {
  const taken = removeAt(from, index)
  if (!taken.item) return { from, to, moved: null }
  const put = addItem(to, taken.item)
  if (!put.added) return { from, to, moved: null }   // dest full: nothing changes
  return { from: taken.container, to: put.container, moved: taken.item }
}

/** Compact a container so items occupy the lowest indices, preserving order. */
export const compact = (container) => {
  const items = container.filter(Boolean)
  const next = createContainer(container.length)
  items.forEach((item, i) => { next[i] = item })
  return next
}

/** Sort by score descending, then compact. Cosmetic QoL, stable and pure. */
export const sortContainer = (container) => {
  const items = container.filter(Boolean).sort((a, b) => itemScore(b) - itemScore(a))
  const next = createContainer(container.length)
  items.forEach((item, i) => { next[i] = item })
  return next
}

// ── Equipment ────────────────────────────────────────────────────────────────

/**
 * Equip an item from a container into a slot. Any item already in that slot
 * goes back to the container (a swap), so gear is never destroyed.
 *
 * @returns {{ equipment, container, equipped: object|null, reason: string|null }}
 */
export const equipFrom = (equipment, container, index, slot) => {
  const item = container[index]
  if (!item) return { equipment, container, equipped: null, reason: 'empty slot' }
  if (!SLOTS.includes(slot)) return { equipment, container, equipped: null, reason: 'unknown slot' }
  if (!slotAccepts(slot, item)) {
    return { equipment, container, equipped: null, reason: `${item.kind} does not fit ${slot}` }
  }

  const taken = removeAt(container, index)
  const previous = equipment[slot]
  let nextContainer = taken.container

  if (previous) {
    const put = addItem(nextContainer, previous)
    // The freed index guarantees room, so this cannot fail — but stay honest.
    if (!put.added) return { equipment, container, equipped: null, reason: 'no room to swap' }
    nextContainer = put.container
  }

  return {
    equipment: { ...equipment, [slot]: item },
    container: nextContainer,
    equipped: item,
    reason: null,
  }
}

/** Unequip a slot back into a container. No-op if the container is full. */
export const unequipTo = (equipment, container, slot) => {
  const item = equipment[slot]
  if (!item) return { equipment, container, removed: null }
  const put = addItem(container, item)
  if (!put.added) return { equipment, container, removed: null }
  return { equipment: { ...equipment, [slot]: null }, container: put.container, removed: item }
}

/**
 * Every affix granted by equipped gear, flattened.
 * Shape is `{ id, delta }` — all deriveStats/aggregateDamageModifiers read.
 */
export const equippedAffixes = (equipment) => {
  if (!equipment) return []
  const out = []
  for (const slot of SLOTS) {
    const item = equipment[slot]
    if (item) out.push(...item.affixes)
  }
  return out
}

/** Total score of equipped gear — a quick "how geared am I" number. */
export const loadoutScore = (equipment) =>
  SLOTS.reduce((n, s) => n + itemScore(equipment?.[s]), 0)

/**
 * Which slot an item should go to when the player just clicks it.
 * Prefers an empty compatible slot, else the weakest occupied one — so a
 * second ring fills the free finger instead of overwriting the first, and
 * an upgrade replaces your worst piece rather than an arbitrary one.
 *
 * @returns {string|null} slot id, or null if nothing accepts the item
 */
export const bestSlotFor = (item, equipment) => {
  if (!item) return null
  const fits = SLOTS.filter(s => slotAccepts(s, item))
  if (fits.length === 0) return null
  const empty = fits.find(s => !equipment?.[s])
  if (empty) return empty
  return fits.reduce((worst, s) =>
    itemScore(equipment[s]) < itemScore(equipment[worst]) ? s : worst, fits[0])
}

/**
 * Greedy auto-equip: for each slot, equip the best-scoring compatible item in
 * the container if it beats what's worn. Used by the stash UI's one-click
 * "equip best" and as a sane default for idle players.
 */
export const autoEquip = (equipment, container) => {
  let eq = equipment
  let cont = container
  const changes = []

  for (const slot of SLOTS) {
    let bestIdx = -1
    let bestScore = itemScore(eq[slot])
    cont.forEach((item, i) => {
      if (!slotAccepts(slot, item)) return
      const score = itemScore(item)
      if (score > bestScore) { bestScore = score; bestIdx = i }
    })
    if (bestIdx === -1) continue
    const res = equipFrom(eq, cont, bestIdx, slot)
    if (res.equipped) {
      eq = res.equipment
      cont = res.container
      changes.push({ slot, item: res.equipped })
    }
  }

  return { equipment: eq, container: cont, changes }
}

/** Normalize arbitrary stored data into a valid container of `size`. */
export const hydrateContainer = (raw, size) => {
  const next = createContainer(size)
  if (!Array.isArray(raw)) return next
  // Preserve indices where possible; overflow falls into the first free slot.
  raw.slice(0, size).forEach((item, i) => { next[i] = item ?? null })
  if (raw.length > size) {
    let overflow = raw.slice(size).filter(Boolean)
    for (const item of overflow) {
      const idx = firstEmpty(next)
      if (idx === -1) break
      next[idx] = item
    }
  }
  return next
}

/** Normalize arbitrary stored data into a valid equipment map. */
export const hydrateEquipment = (raw) => {
  const eq = createEquipment()
  if (!raw || typeof raw !== 'object') return eq
  for (const slot of SLOTS) if (raw[slot]) eq[slot] = raw[slot]
  return eq
}
