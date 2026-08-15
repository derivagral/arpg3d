/**
 * src/storage/namespace.test.js — saves are keyed on identity subject
 *
 * The property under test throughout: one player can never see another
 * player's saves, and upgrading from guest to account never destroys anything.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createState, tick } from '../../sim/engine.js'
import {
  createSaveStore,
  storageKeyFor,
  adoptLegacySaves,
  STORAGE_KEY,
  ADOPTED_KEY,
} from './saveStore.js'
import { claimOffer, claimSaves, declineClaim, claimAnswered } from './claim.js'
import { makeIdentity, KIND_ANON, KIND_ATPROTO } from '../identity/identity.js'
import { mockStorage } from '../testing/mockStorage.js'

const GUEST = 'anon:0193-abcd'
const DID = 'did:plc:abc123'

const runFor = (seed, ticks) => {
  let s = createState(seed)
  for (let i = 0; i < ticks; i++) s = tick(s, 16.67, { autopilot: true })
  return s
}

test('a subject gets its own key, and the colons are escaped', () => {
  assert.equal(storageKeyFor(null), STORAGE_KEY)
  assert.equal(storageKeyFor(DID), `${STORAGE_KEY}:did%3Aplc%3Aabc123`)
  assert.notEqual(storageKeyFor(GUEST), storageKeyFor(DID))
})

test('two subjects cannot see each other saves', () => {
  const storage = mockStorage()
  const guest = createSaveStore({ storage, subject: GUEST })
  const account = createSaveStore({ storage, subject: DID })

  guest.create('Guest run', runFor(1, 200))

  assert.equal(guest.list().length, 1)
  assert.equal(account.list().length, 0)

  account.create('Account run', runFor(2, 200))
  assert.equal(guest.list().length, 1)
  assert.equal(account.list().length, 1)
})

test('the positional storage form still works for pre-identity callers', () => {
  // createSaveStore(storage) predates subjects; breaking it would break every
  // existing call site and test at once.
  const storage = mockStorage()
  const store = createSaveStore(storage)

  store.create('Legacy', runFor(3, 100))
  assert.equal(store.list().length, 1)
  assert.equal(store.key, STORAGE_KEY)
})

test('pre-identity saves are adopted once, by the guest', () => {
  const storage = mockStorage()
  createSaveStore(storage).create('Old save', runFor(4, 200))

  assert.equal(adoptLegacySaves(storage, GUEST), true)
  assert.equal(createSaveStore({ storage, subject: GUEST }).list()[0].name, 'Old save')

  // The original blob survives as a free backup — adoption copies.
  assert.ok(storage.getItem(STORAGE_KEY))
  assert.equal(storage.getItem(ADOPTED_KEY), GUEST)
})

test('a second subject cannot also adopt the same legacy saves', () => {
  const storage = mockStorage()
  createSaveStore(storage).create('Old save', runFor(5, 200))

  assert.equal(adoptLegacySaves(storage, GUEST), true)
  // Otherwise whoever signed in next would inherit the previous player's runs.
  assert.equal(adoptLegacySaves(storage, DID), false)
  assert.equal(createSaveStore({ storage, subject: DID }).list().length, 0)
})

test('adoption does not clobber a subject that already has saves', () => {
  const storage = mockStorage()
  createSaveStore(storage).create('Legacy', runFor(6, 200))
  createSaveStore({ storage, subject: GUEST }).create('Mine', runFor(7, 200))

  assert.equal(adoptLegacySaves(storage, GUEST), false)
  const names = createSaveStore({ storage, subject: GUEST }).list().map(s => s.name)
  assert.deepEqual(names, ['Mine'])
})

test('adoption is a no-op when there is nothing to adopt', () => {
  assert.equal(adoptLegacySaves(mockStorage(), GUEST), false)
  assert.equal(adoptLegacySaves(mockStorage(), null), false)
  assert.equal(adoptLegacySaves(null, GUEST), false)
})

// ── The claim offer ─────────────────────────────────────────────────────────

const account = makeIdentity({ subject: DID, kind: KIND_ATPROTO })

test('the claim is offered only when there is something to bring', () => {
  const empty = mockStorage()
  assert.equal(claimOffer({ storage: empty, from: GUEST, to: account }).offer, false)

  const storage = mockStorage()
  createSaveStore({ storage, subject: GUEST }).create('Guest run', runFor(8, 200))
  const offer = claimOffer({ storage, from: GUEST, to: account })
  assert.equal(offer.offer, true)
  assert.equal(offer.count, 1)
})

test('no claim is offered to a guest, or to the same subject', () => {
  const storage = mockStorage()
  createSaveStore({ storage, subject: GUEST }).create('Guest run', runFor(9, 200))

  const guestIdentity = makeIdentity({ subject: 'anon:other', kind: KIND_ANON })
  assert.equal(claimOffer({ storage, from: GUEST, to: guestIdentity }).offer, false)

  const self = makeIdentity({ subject: GUEST, kind: KIND_ANON })
  assert.equal(claimOffer({ storage, from: GUEST, to: self }).offer, false)
  assert.equal(claimOffer({ storage, from: null, to: account }).offer, false)
})

test('claiming copies saves across without emptying the guest namespace', () => {
  const storage = mockStorage()
  const guest = createSaveStore({ storage, subject: GUEST })
  guest.create('Run A', runFor(10, 200))
  guest.create('Run B', runFor(11, 200))

  const { claimed, skipped } = claimSaves({ storage, from: GUEST, to: DID })

  assert.equal(claimed, 2)
  assert.deepEqual(skipped, [])
  assert.equal(createSaveStore({ storage, subject: DID }).list().length, 2)
  // Copy, not move: signing out must return the player to what they had.
  assert.equal(guest.list().length, 2)
})

test('claimed saves get fresh ids so nothing is overwritten', () => {
  const storage = mockStorage()
  const guest = createSaveStore({ storage, subject: GUEST })
  const original = guest.create('Run A', runFor(12, 200))

  const target = createSaveStore({ storage, subject: DID })
  target.create('Pre-existing', runFor(13, 200))

  claimSaves({ storage, from: GUEST, to: DID })

  const list = target.list()
  assert.equal(list.length, 2)
  assert.equal(list.filter(s => s.id === original.id).length, 0)
  assert.ok(list.some(s => s.name === 'Pre-existing'))
  assert.ok(list.some(s => s.name === 'Run A'))
})

test('the offer is made once per guest-to-account pair', () => {
  const storage = mockStorage()
  createSaveStore({ storage, subject: GUEST }).create('Run A', runFor(14, 200))

  assert.equal(claimOffer({ storage, from: GUEST, to: account }).offer, true)
  claimSaves({ storage, from: GUEST, to: DID })
  assert.equal(claimOffer({ storage, from: GUEST, to: account }).offer, false)

  // A different account gets its own offer — two people can share a browser.
  const other = makeIdentity({ subject: 'did:plc:other', kind: KIND_ATPROTO })
  assert.equal(claimOffer({ storage, from: GUEST, to: other }).offer, true)
})

test('declining is remembered, and copies nothing', () => {
  const storage = mockStorage()
  createSaveStore({ storage, subject: GUEST }).create('Run A', runFor(15, 200))

  declineClaim({ storage, from: GUEST, to: DID })

  assert.equal(claimAnswered(storage, GUEST, DID), true)
  assert.equal(claimOffer({ storage, from: GUEST, to: account }).offer, false)
  assert.equal(createSaveStore({ storage, subject: DID }).list().length, 0)
})

test('one unusable save does not sink the rest of the claim', () => {
  const storage = mockStorage()
  const guest = createSaveStore({ storage, subject: GUEST })
  guest.create('Good', runFor(16, 200))
  const bad = guest.create('Bad', runFor(17, 200))

  // Forge a version from the future, which checkCompatibility must refuse.
  const raw = JSON.parse(storage.getItem(storageKeyFor(GUEST)))
  raw.saves[bad.id].v = 9999
  storage.setItem(storageKeyFor(GUEST), JSON.stringify(raw))

  const { claimed, skipped } = claimSaves({ storage, from: GUEST, to: DID })

  assert.equal(claimed, 1)
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0].name, 'Bad')
  assert.equal(createSaveStore({ storage, subject: DID }).list()[0].name, 'Good')
})

test('a corrupt envelope is backed up per namespace, not across them', () => {
  const storage = mockStorage()
  storage.setItem(storageKeyFor(GUEST), 'not json{{{')

  const store = createSaveStore({ storage, subject: GUEST })
  assert.deepEqual(store.list(), [])
  assert.equal(storage.getItem(`${storageKeyFor(GUEST)}:corrupt-backup`), 'not json{{{')
})
