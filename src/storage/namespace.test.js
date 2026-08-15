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
import { createMemoryBackend } from './backends/localStorage.js'

const GUEST = 'anon:0193-abcd'
const DID = 'did:plc:abc123'

const account = makeIdentity({ subject: DID, kind: KIND_ATPROTO })

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

test('two subjects cannot see each other saves', async () => {
  const backend = createMemoryBackend()
  const guest = createSaveStore({ backend, subject: GUEST })
  const mine = createSaveStore({ backend, subject: DID })

  await guest.create('Guest run', runFor(1, 200))

  assert.equal((await guest.list()).length, 1)
  assert.equal((await mine.list()).length, 0)

  await mine.create('Account run', runFor(2, 200))
  assert.equal((await guest.list()).length, 1)
  assert.equal((await mine.list()).length, 1)
})

test('omitting a subject targets the un-namespaced legacy key', async () => {
  const backend = createMemoryBackend()
  const store = createSaveStore({ backend })

  await store.create('Legacy', runFor(3, 100))
  assert.equal((await store.list()).length, 1)
  assert.equal(store.key, STORAGE_KEY)
})

// ── Adoption of pre-identity saves ──────────────────────────────────────────

test('pre-identity saves are adopted once, by the guest', async () => {
  const backend = createMemoryBackend()
  await createSaveStore({ backend }).create('Old save', runFor(4, 200))

  assert.equal(await adoptLegacySaves(backend, GUEST), true)

  const adopted = await createSaveStore({ backend, subject: GUEST }).list()
  assert.equal(adopted[0].name, 'Old save')

  // The original blob survives as a free backup — adoption copies.
  assert.ok(await backend.read(STORAGE_KEY))
  assert.equal(await backend.read(ADOPTED_KEY), GUEST)
})

test('a second subject cannot also adopt the same legacy saves', async () => {
  const backend = createMemoryBackend()
  await createSaveStore({ backend }).create('Old save', runFor(5, 200))

  assert.equal(await adoptLegacySaves(backend, GUEST), true)
  // Otherwise whoever signed in next would inherit the previous player's runs.
  assert.equal(await adoptLegacySaves(backend, DID), false)
  assert.equal((await createSaveStore({ backend, subject: DID }).list()).length, 0)
})

test('adoption does not clobber a subject that already has saves', async () => {
  const backend = createMemoryBackend()
  await createSaveStore({ backend }).create('Legacy', runFor(6, 200))
  await createSaveStore({ backend, subject: GUEST }).create('Mine', runFor(7, 200))

  assert.equal(await adoptLegacySaves(backend, GUEST), false)
  const names = (await createSaveStore({ backend, subject: GUEST }).list()).map(s => s.name)
  assert.deepEqual(names, ['Mine'])
})

test('adoption is a no-op when there is nothing to adopt', async () => {
  assert.equal(await adoptLegacySaves(createMemoryBackend(), GUEST), false)
  assert.equal(await adoptLegacySaves(createMemoryBackend(), null), false)
  assert.equal(await adoptLegacySaves(null, GUEST), false)
})

// ── The claim offer ─────────────────────────────────────────────────────────

test('the claim is offered only when there is something to bring', async () => {
  const empty = createMemoryBackend()
  assert.equal((await claimOffer({ backend: empty, from: GUEST, to: account })).offer, false)

  const backend = createMemoryBackend()
  await createSaveStore({ backend, subject: GUEST }).create('Guest run', runFor(8, 200))

  const offer = await claimOffer({ backend, from: GUEST, to: account })
  assert.equal(offer.offer, true)
  assert.equal(offer.count, 1)
})

test('no claim is offered to a guest, or to the same subject', async () => {
  const backend = createMemoryBackend()
  await createSaveStore({ backend, subject: GUEST }).create('Guest run', runFor(9, 200))

  const guestIdentity = makeIdentity({ subject: 'anon:other', kind: KIND_ANON })
  assert.equal((await claimOffer({ backend, from: GUEST, to: guestIdentity })).offer, false)

  const self = makeIdentity({ subject: GUEST, kind: KIND_ANON })
  assert.equal((await claimOffer({ backend, from: GUEST, to: self })).offer, false)
  assert.equal((await claimOffer({ backend, from: null, to: account })).offer, false)
})

test('claiming copies saves across without emptying the guest namespace', async () => {
  const backend = createMemoryBackend()
  const guest = createSaveStore({ backend, subject: GUEST })
  await guest.create('Run A', runFor(10, 200))
  await guest.create('Run B', runFor(11, 200))

  const { claimed, skipped } = await claimSaves({ backend, from: GUEST, to: DID })

  assert.equal(claimed, 2)
  assert.deepEqual(skipped, [])
  assert.equal((await createSaveStore({ backend, subject: DID }).list()).length, 2)
  // Copy, not move: signing out must return the player to what they had.
  assert.equal((await guest.list()).length, 2)
})

test('claimed saves get fresh ids so nothing is overwritten', async () => {
  const backend = createMemoryBackend()
  const guest = createSaveStore({ backend, subject: GUEST })
  const original = await guest.create('Run A', runFor(12, 200))

  const target = createSaveStore({ backend, subject: DID })
  await target.create('Pre-existing', runFor(13, 200))

  await claimSaves({ backend, from: GUEST, to: DID })

  const list = await target.list()
  assert.equal(list.length, 2)
  assert.equal(list.filter(s => s.id === original.id).length, 0)
  assert.ok(list.some(s => s.name === 'Pre-existing'))
  assert.ok(list.some(s => s.name === 'Run A'))
})

test('the offer is made once per guest-to-account pair', async () => {
  const backend = createMemoryBackend()
  await createSaveStore({ backend, subject: GUEST }).create('Run A', runFor(14, 200))

  assert.equal((await claimOffer({ backend, from: GUEST, to: account })).offer, true)
  await claimSaves({ backend, from: GUEST, to: DID })
  assert.equal((await claimOffer({ backend, from: GUEST, to: account })).offer, false)

  // A different account gets its own offer — two people can share a browser.
  const other = makeIdentity({ subject: 'did:plc:other', kind: KIND_ATPROTO })
  assert.equal((await claimOffer({ backend, from: GUEST, to: other })).offer, true)
})

test('declining is remembered, and copies nothing', async () => {
  const backend = createMemoryBackend()
  await createSaveStore({ backend, subject: GUEST }).create('Run A', runFor(15, 200))

  await declineClaim({ backend, from: GUEST, to: DID })

  assert.equal(await claimAnswered(backend, GUEST, DID), true)
  assert.equal((await claimOffer({ backend, from: GUEST, to: account })).offer, false)
  assert.equal((await createSaveStore({ backend, subject: DID }).list()).length, 0)
})

test('one unusable save does not sink the rest of the claim', async () => {
  const backend = createMemoryBackend()
  const guest = createSaveStore({ backend, subject: GUEST })
  await guest.create('Good', runFor(16, 200))
  const bad = await guest.create('Bad', runFor(17, 200))

  // Forge a version from the future, which checkCompatibility must refuse.
  const raw = JSON.parse(await backend.read(storageKeyFor(GUEST)))
  raw.saves[bad.id].v = 9999
  await backend.write(storageKeyFor(GUEST), JSON.stringify(raw))

  const { claimed, skipped } = await claimSaves({ backend, from: GUEST, to: DID })

  assert.equal(claimed, 1)
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0].name, 'Bad')
  assert.equal((await createSaveStore({ backend, subject: DID }).list())[0].name, 'Good')
})

test('a corrupt envelope is backed up per namespace, not across them', async () => {
  const backend = createMemoryBackend()
  await backend.write(storageKeyFor(GUEST), 'not json{{{')

  const store = createSaveStore({ backend, subject: GUEST })
  assert.deepEqual(await store.list(), [])
  assert.equal(await backend.read(`${storageKeyFor(GUEST)}:corrupt-backup`), 'not json{{{')
})

// ── Async-specific hazards ──────────────────────────────────────────────────

test('concurrent writes do not lose each other', async () => {
  // The envelope holds every slot, so an interleaved read-modify-write loses a
  // whole save rather than a field. This is the hazard going async introduced,
  // and the reason the store serializes.
  const backend = createMemoryBackend()
  const store = createSaveStore({ backend, subject: DID })

  await Promise.all([
    store.create('A', createState(1)),
    store.create('B', createState(2)),
    store.create('C', createState(3)),
  ])

  const names = (await store.list()).map(s => s.name).sort()
  assert.deepEqual(names, ['A', 'B', 'C'])
})

test('interleaved updates settle on the last write, not a lost one', async () => {
  const backend = createMemoryBackend()
  const store = createSaveStore({ backend, subject: DID })
  const a = await store.create('A', createState(1))
  const b = await store.create('B', createState(2))

  await Promise.all([
    store.update(a.id, runFor(1, 300)),
    store.update(b.id, runFor(2, 600)),
    store.rename(a.id, 'A renamed'),
  ])

  const list = await store.list()
  assert.equal(list.length, 2)                                   // neither slot lost
  assert.ok(list.some(s => s.name === 'A renamed'))
  assert.ok(list.some(s => s.name === 'B'))
})

test('a slow backend still serializes correctly', async () => {
  // Real async backends (IndexedDB, HTTP) resolve on a later turn, which is
  // exactly when interleaving would bite. Prove the chain holds when it does.
  const inner = createMemoryBackend()
  const slow = {
    canWriteSync: false,
    async read(k) { await new Promise(r => setTimeout(r, 2)); return inner.read(k) },
    async write(k, v) { await new Promise(r => setTimeout(r, 2)); return inner.write(k, v) },
    async remove(k) { return inner.remove(k) },
  }
  const store = createSaveStore({ backend: slow, subject: DID })

  await Promise.all([
    store.create('A', createState(1)),
    store.create('B', createState(2)),
    store.create('C', createState(3)),
  ])

  assert.deepEqual((await store.list()).map(s => s.name).sort(), ['A', 'B', 'C'])
  assert.equal(store.canWriteSync, false)
})

test('updateSync writes without awaiting, for the unload path', async () => {
  const backend = createMemoryBackend()
  const store = createSaveStore({ backend, subject: DID })
  const file = await store.create('Run', createState(1))
  const later = runFor(1, 800)

  // No await: this is what `pagehide` gets, where a promise may never resolve.
  const written = store.updateSync(file.id, later)

  assert.ok(written)
  assert.equal(JSON.parse(backend.readSync(storageKeyFor(DID))).saves[file.id].meta.depth, later.depth)
  assert.equal(store.updateSync('sv_missing', later), null)
})

test('updateSync reports failure when the backend cannot write synchronously', async () => {
  const inner = createMemoryBackend()
  const asyncOnly = {
    canWriteSync: false,
    read: (k) => inner.read(k),
    write: (k, v) => inner.write(k, v),
    remove: (k) => inner.remove(k),
  }
  const store = createSaveStore({ backend: asyncOnly, subject: DID })
  const file = await store.create('Run', createState(1))

  // Callers must feature-detect and fall back to a best-effort async write.
  assert.equal(store.canWriteSync, false)
  assert.equal(store.updateSync(file.id, createState(2)), null)
})
