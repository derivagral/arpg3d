/**
 * src/host/host.test.js — the shell/game boundary
 *
 * What matters here is what a game CANNOT reach: no token, no identity
 * object, no capability it did not declare, and no way to mutate the host it
 * was handed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createHost, playerSnapshot, CAPABILITIES } from './host.js'
import { createLocalStorageAdapter } from './storage/localAdapter.js'
import { createSettingsStore, DEFAULT_SETTINGS } from './settings.js'
import { createTelemetry } from './telemetry.js'
import { makeIdentity, KIND_ATPROTO, KIND_ANON } from '../identity/identity.js'
import { mockStorage, failingStorage } from '../testing/mockStorage.js'

const identity = makeIdentity({
  subject: 'did:plc:abc123',
  kind: KIND_ATPROTO,
  display: { handle: 'patrick.bsky.social', name: 'Patrick', avatar: 'https://cdn/x.jpg' },
})

const build = (overrides = {}) => createHost({
  manifest: { id: 'testgame', capabilities: ['storage', 'telemetry', 'settings'] },
  identity,
  storage: mockStorage(),
  onExit: () => {},
  ...overrides,
})

test('the host is frozen — a game cannot bolt capabilities onto it', () => {
  const host = build()
  assert.ok(Object.isFrozen(host))
  assert.throws(() => { 'use strict'; host.storage = null }, TypeError)
  assert.throws(() => { 'use strict'; host.hacked = true }, TypeError)
})

test('an undeclared capability is ABSENT, not merely unused', () => {
  // Absent rather than present-but-empty, so a game that forgot to declare
  // something fails loudly in development instead of silently working until
  // the shell tightens up.
  const host = build({ manifest: { id: 'testgame', capabilities: ['telemetry'] } })

  assert.equal(host.storage, undefined)
  assert.equal(host.settings, undefined)
  assert.equal(host.saves, undefined)
  assert.ok(host.telemetry)
})

test('a game declaring no capabilities still gets player and exit', () => {
  const host = build({ manifest: { id: 'testgame' } })

  assert.ok(host.player)
  assert.equal(typeof host.exit, 'function')
  assert.equal(host.storage, undefined)
})

test('an unknown capability is rejected at mint time', () => {
  assert.throws(
    () => build({ manifest: { id: 'testgame', capabilities: ['root'] } }),
    /unknown capability 'root'/
  )
  assert.ok(CAPABILITIES.includes('storage'))
})

test("declaring 'saves' without the shell granting one is an error", () => {
  assert.throws(
    () => build({ manifest: { id: 'testgame', capabilities: ['saves'] } }),
    /declared 'saves'/
  )
})

test('the player snapshot carries no route back to the auth layer', () => {
  const host = build()

  assert.deepEqual(Object.keys(host.player).sort(), ['display', 'kind', 'subject'])
  assert.equal(host.player.subject, 'did:plc:abc123')
  assert.equal(host.player.display.handle, 'patrick.bsky.social')

  // Nothing resembling a credential or a live session handle.
  const serialized = JSON.stringify(host.player)
  assert.ok(!/token|session|jwt|dpop/i.test(serialized))
})

test('the player snapshot is frozen at both levels', () => {
  const host = build()
  assert.ok(Object.isFrozen(host.player))
  assert.ok(Object.isFrozen(host.player.display))
  assert.throws(() => { 'use strict'; host.player.subject = 'did:plc:someone-else' }, TypeError)
})

test('a guest gets the same shape as a signed-in player', () => {
  // No game code should ever need to branch on logged-in-ness.
  const guest = playerSnapshot(makeIdentity({ subject: 'anon:1', kind: KIND_ANON }))
  assert.deepEqual(Object.keys(guest).sort(), ['display', 'kind', 'subject'])
  assert.equal(guest.display, null)
})

test('launch params are frozen and copied, not shared', () => {
  const launch = { slotId: 'sv_1', simState: { depth: 3 } }
  const host = build({ launch })

  assert.equal(host.launch.slotId, 'sv_1')
  assert.ok(Object.isFrozen(host.launch))

  launch.slotId = 'sv_hacked'
  assert.equal(host.launch.slotId, 'sv_1')
})

test('exit hands control back with a reason', async () => {
  const reasons = []
  const host = build({ onExit: (reason) => reasons.push(reason) })

  await host.exit('died')
  await host.exit()

  assert.deepEqual(reasons, ['died', 'quit'])
})

test('a host cannot be minted without the pieces it needs', () => {
  assert.throws(() => createHost({ manifest: {}, identity, onExit: () => {} }), /manifest.id/)
  assert.throws(() => createHost({ manifest: { id: 'x' }, onExit: () => {} }), /identity/)
  assert.throws(() => createHost({ manifest: { id: 'x' }, identity }), /onExit/)
})

// ── storage adapter ─────────────────────────────────────────────────────────

test('storage is namespaced by game AND subject', async () => {
  const storage = mockStorage()
  const mine = createLocalStorageAdapter({ storage, gameId: 'arpg3d', subject: 'did:plc:a' })
  const theirs = createLocalStorageAdapter({ storage, gameId: 'arpg3d', subject: 'did:plc:b' })
  const otherGame = createLocalStorageAdapter({ storage, gameId: 'idle', subject: 'did:plc:a' })

  await mine.put('slot1', { depth: 7 })

  assert.deepEqual(await mine.get('slot1'), { depth: 7 })
  assert.equal(await theirs.get('slot1'), null)
  assert.equal(await otherGame.get('slot1'), null)
})

test('list only sees its own namespace', async () => {
  const storage = mockStorage()
  const mine = createLocalStorageAdapter({ storage, gameId: 'arpg3d', subject: 'did:plc:a' })
  const theirs = createLocalStorageAdapter({ storage, gameId: 'arpg3d', subject: 'did:plc:b' })

  await mine.put('a', 1)
  await mine.put('b', 2)
  await theirs.put('c', 3)

  assert.deepEqual(await mine.list(), ['a', 'b'])
  assert.deepEqual(await theirs.list(), ['c'])
})

test('every storage method returns a promise', () => {
  // Load-bearing: it is what lets this be swapped for a postMessage or HTTP
  // adapter later without touching a line of game code.
  const adapter = createLocalStorageAdapter({
    storage: mockStorage(), gameId: 'g', subject: 's',
  })
  for (const method of ['get', 'put', 'list', 'remove']) {
    assert.ok(adapter[method]('x', 1) instanceof Promise, `${method} must be async`)
  }
})

test('a corrupt slot reads as empty instead of crashing the boot', async () => {
  const storage = mockStorage()
  const adapter = createLocalStorageAdapter({ storage, gameId: 'g', subject: 's' })
  await adapter.put('slot1', { ok: true })

  const key = [...storage._map.keys()].find(k => k.endsWith('slot1'))
  storage.setItem(key, '{{{not json')

  assert.equal(await adapter.get('slot1'), null)
})

test('remove reports whether anything was there', async () => {
  const adapter = createLocalStorageAdapter({
    storage: mockStorage(), gameId: 'g', subject: 's',
  })
  await adapter.put('slot1', 1)

  assert.equal(await adapter.remove('slot1'), true)
  assert.equal(await adapter.remove('slot1'), false)
})

test('a failed write rejects so the game can tell the player', async () => {
  const adapter = createLocalStorageAdapter({
    storage: failingStorage(), gameId: 'g', subject: 's',
  })
  await assert.rejects(() => adapter.put('slot1', { a: 1 }), /could not write slot/)
})

test('the adapter refuses to be built without a namespace', () => {
  const storage = mockStorage()
  assert.throws(() => createLocalStorageAdapter({ storage, subject: 's' }), /gameId/)
  assert.throws(() => createLocalStorageAdapter({ storage, gameId: 'g' }), /subject/)
})

// ── settings ────────────────────────────────────────────────────────────────

test('settings are read-only through the host', async () => {
  const host = build()
  const settings = await host.settings.get()

  assert.equal(settings.masterVolume, DEFAULT_SETTINGS.masterVolume)
  assert.ok(Object.isFrozen(host.settings))
  assert.equal(host.settings.set, undefined)
})

test('settings merge over defaults and survive an unknown-key write', () => {
  const storage = mockStorage()
  const store = createSettingsStore({ storage, subject: 'did:plc:a' })

  store.set({ masterVolume: 0.2, somethingNew: true })
  const read = store.get()

  assert.equal(read.masterVolume, 0.2)
  assert.equal(read.somethingNew, true)
  assert.equal(read.quality, DEFAULT_SETTINGS.quality)   // default filled in
  assert.equal(read.keybinds.up, 'KeyW')                 // nested default kept
})

test('a partial keybind patch does not wipe the other binds', () => {
  const store = createSettingsStore({ storage: mockStorage(), subject: 's' })
  store.set({ keybinds: { up: 'ArrowUp' } })

  const binds = store.get().keybinds
  assert.equal(binds.up, 'ArrowUp')
  assert.equal(binds.down, 'KeyS')
})

test('settings follow the player, not the game', () => {
  const storage = mockStorage()
  createSettingsStore({ storage, subject: 'did:plc:a' }).set({ masterVolume: 0.1 })

  assert.equal(createSettingsStore({ storage, subject: 'did:plc:a' }).get().masterVolume, 0.1)
  assert.equal(createSettingsStore({ storage, subject: 'did:plc:b' }).get().masterVolume, DEFAULT_SETTINGS.masterVolume)
})

test('corrupt settings fall back to defaults', () => {
  const storage = mockStorage()
  const store = createSettingsStore({ storage, subject: 's' })
  store.set({ masterVolume: 0.3 })

  const key = [...storage._map.keys()][0]
  storage.setItem(key, 'not json')

  assert.deepEqual(store.get().masterVolume, DEFAULT_SETTINGS.masterVolume)
})

// ── telemetry ───────────────────────────────────────────────────────────────

test('telemetry tags records with game and subject', async () => {
  const records = []
  const telemetry = createTelemetry({ sink: r => records.push(r), gameId: 'g', subject: 's' })

  await telemetry.report('run.ended', { depth: 12 })

  assert.equal(records.length, 1)
  assert.equal(records[0].event, 'run.ended')
  assert.deepEqual(records[0].payload, { depth: 12 })
  assert.equal(records[0].gameId, 'g')
  assert.equal(records[0].subject, 's')
  assert.equal(typeof records[0].at, 'number')
})

test('a failing telemetry sink never breaks the run', async () => {
  const telemetry = createTelemetry({
    sink: () => { throw new Error('network down') }, gameId: 'g', subject: 's',
  })
  await telemetry.report('run.ended', { depth: 1 })   // must not reject
})

test('telemetry defaults to a sink that sends nothing anywhere', async () => {
  const telemetry = createTelemetry({ gameId: 'g', subject: 's' })
  await telemetry.report('run.ended', {})
})
