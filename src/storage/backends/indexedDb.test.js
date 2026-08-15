/**
 * src/storage/backends/indexedDb.test.js
 *
 * Runs against fake-indexeddb, which implements the real IDB semantics
 * (transactions, upgrade events, key ordering) in Node. It is a shim, not the
 * browser, so the browser check in the PR covers the rest.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'

import { createIndexedDbBackend, migrateBackend, indexedDbAvailable } from './indexedDb.js'
import { createMemoryBackend } from './localStorage.js'
import { createSaveStore } from '../saveStore.js'
import { createState } from '../../../sim/engine.js'

// A fresh IDBFactory per backend keeps tests from sharing a database.
const freshBackend = (opts = {}) =>
  createIndexedDbBackend({ idb: new IDBFactory(), ...opts })

test('round-trips a value', async () => {
  const backend = freshBackend()
  assert.equal(await backend.read('missing'), null)

  await backend.write('k', 'hello')
  assert.equal(await backend.read('k'), 'hello')

  await backend.remove('k')
  assert.equal(await backend.read('k'), null)
  await backend.close()
})

test('values survive reopening the database', async () => {
  // The point of using IndexedDB at all — durability across sessions.
  const idb = new IDBFactory()
  const first = createIndexedDbBackend({ idb })
  await first.write('k', 'durable')
  await first.close()

  const second = createIndexedDbBackend({ idb })
  assert.equal(await second.read('k'), 'durable')
  await second.close()
})

test('concurrent opens share one database handle', async () => {
  const backend = freshBackend()
  await Promise.all([
    backend.write('a', '1'),
    backend.write('b', '2'),
    backend.write('c', '3'),
  ])
  assert.deepEqual(
    await Promise.all([backend.read('a'), backend.read('b'), backend.read('c')]),
    ['1', '2', '3'],
  )
  await backend.close()
})

test('it reports that it cannot flush synchronously', async () => {
  // IndexedDB has no synchronous API, so the unload path must fall back
  // rather than assume. Callers feature-detect on exactly this.
  const backend = freshBackend()
  assert.equal(backend.canWriteSync, false)
  assert.equal(backend.writeSync, undefined)
  await backend.close()
})

test('keys() enumerates what is stored', async () => {
  const backend = freshBackend()
  await backend.write('arpg3d:saves:v1:a', 'x')
  await backend.write('arpg3d:saves:v1:b', 'y')

  assert.deepEqual((await backend.keys()).sort(), ['arpg3d:saves:v1:a', 'arpg3d:saves:v1:b'])
  await backend.close()
})

test('a missing IndexedDB is refused loudly, not silently', () => {
  assert.throws(() => createIndexedDbBackend({ idb: null }), /not available/)
  assert.equal(typeof indexedDbAvailable(), 'boolean')
})

// ── It is a real drop-in for the save store ─────────────────────────────────

test('the save store works unchanged on IndexedDB', async () => {
  const backend = freshBackend()
  const store = createSaveStore({ backend, subject: 'did:plc:abc' })

  const file = await store.create('Run', createState(7))
  assert.equal((await store.get(file.id)).name, 'Run')
  assert.equal((await store.list()).length, 1)

  // The store reports the backend's limitation upward, so the game's unload
  // path degrades instead of silently no-opping.
  assert.equal(store.canWriteSync, false)
  assert.equal(store.updateSync(file.id, createState(8)), null)
  await backend.close()
})

test('serialized writes still hold on a genuinely async backend', async () => {
  // localStorage resolves effectively instantly; IndexedDB does not. This is
  // where interleaving would actually bite.
  const backend = freshBackend()
  const store = createSaveStore({ backend, subject: 'did:plc:abc' })

  await Promise.all([
    store.create('A', createState(1)),
    store.create('B', createState(2)),
    store.create('C', createState(3)),
  ])

  assert.deepEqual((await store.list()).map(s => s.name).sort(), ['A', 'B', 'C'])
  await backend.close()
})

// ── Migration between backends ──────────────────────────────────────────────

test('migration copies saves across and leaves the source intact', async () => {
  const from = createMemoryBackend()
  const to = freshBackend()

  const source = createSaveStore({ backend: from, subject: 'did:plc:abc' })
  await source.create('Existing run', createState(5))
  const key = source.key

  const { copied, skipped } = await migrateBackend({ from, to, keys: [key] })

  assert.deepEqual(copied, [key])
  assert.deepEqual(skipped, [])

  // Readable on the new backend...
  const moved = createSaveStore({ backend: to, subject: 'did:plc:abc' })
  assert.equal((await moved.list())[0].name, 'Existing run')

  // ...and still present on the old one, as a backup.
  assert.equal((await source.list()).length, 1)
  await to.close()
})

test('migration never overwrites data already in the target', async () => {
  const from = createMemoryBackend()
  const to = freshBackend()

  await from.write('k', 'old')
  await to.write('k', 'newer')

  const { copied, skipped } = await migrateBackend({ from, to, keys: ['k'] })

  assert.deepEqual(copied, [])
  assert.deepEqual(skipped, ['k'])
  assert.equal(await to.read('k'), 'newer')
  await to.close()
})

test('migration skips keys the source does not have', async () => {
  const from = createMemoryBackend()
  const to = freshBackend()

  const { copied, skipped } = await migrateBackend({ from, to, keys: ['absent'] })

  assert.deepEqual(copied, [])
  assert.deepEqual(skipped, ['absent'])
  await to.close()
})
