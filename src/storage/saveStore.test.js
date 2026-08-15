/**
 * src/storage/saveStore.test.js — CRUD against a Map-backed mock storage
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createState, tick } from '../../sim/engine.js'
import { encodeSaveCode, SAVE_SCHEMA_VERSION } from '../games/arpg3d/save.js'
import { createSaveStore, STORAGE_KEY } from './saveStore.js'

const mockStorage = () => {
  const map = new Map()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  }
}

const runFor = (seed, ticks) => {
  let s = createState(seed)
  for (let i = 0; i < ticks; i++) s = tick(s, 16.67, { autopilot: true })
  return s
}

test('create + get + list round-trip', async () => {
  const store = createSaveStore({ storage: mockStorage() })
  const sim = runFor(1, 1000)
  const file = await store.create('First', sim)

  assert.equal((await store.get(file.id)).name, 'First')
  const list = await store.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].id, file.id)
  assert.equal(list[0].compatible, true)
  assert.equal(list[0].meta.depth, sim.depth)
})

test('list sorts by updatedAt descending', async () => {
  const store = createSaveStore({ storage: mockStorage() })
  const a = await store.create('A', createState(1))
  await new Promise(r => setTimeout(r, 5))
  const b = await store.create('B', createState(2))
  await new Promise(r => setTimeout(r, 5))
  await store.update(a.id, runFor(1, 500))  // touching A moves it to the top

  assert.deepEqual((await store.list()).map(s => s.name), ['A', 'B'])
  assert.equal(b.name, 'B')
})

test('update overwrites the snapshot; missing id returns null', async () => {
  const store = createSaveStore({ storage: mockStorage() })
  const file = await store.create('Run', createState(9))
  const later = runFor(9, 3000)

  const updated = await store.update(file.id, later)
  assert.equal(updated.id, file.id)
  assert.equal((await store.get(file.id)).meta.depth, later.depth)
  assert.equal(await store.update('sv_missing', later), null)
})

test('rename and remove', async () => {
  const store = createSaveStore({ storage: mockStorage() })
  const file = await store.create('Old Name', createState(1))

  await store.rename(file.id, 'New Name')
  assert.equal((await store.get(file.id)).name, 'New Name')

  assert.equal(await store.remove(file.id), true)
  assert.equal(await store.get(file.id), null)
  assert.equal(await store.remove(file.id), false)
})

test('importSaveFile assigns a fresh id and never clobbers existing slots', async () => {
  const store = createSaveStore({ storage: mockStorage() })
  const original = await store.create('Mine', runFor(4, 1000))

  // Re-import an export of the same slot (id collision case)
  const imported = await store.importSaveFile(JSON.parse(await store.exportJson(original.id)))
  assert.notEqual(imported.id, original.id)
  assert.equal((await store.list()).length, 2)
})

test('importSaveFile rejects incompatible payloads', async () => {
  const store = createSaveStore({ storage: mockStorage() })
  await assert.rejects(() => store.importSaveFile({ game: 'other' }), /cannot import/)

  const file = await store.create('x', createState(1))
  const newer = { ...(await store.get(file.id)), v: SAVE_SCHEMA_VERSION + 1 }
  await assert.rejects(() => store.importSaveFile(newer), /newer/)
})

test('exportJson and exportCode round-trip through import', async () => {
  const store = createSaveStore({ storage: mockStorage() })
  const file = await store.create('Share Me', runFor(8, 2000))

  const fromJson = await store.importSaveFile(JSON.parse(await store.exportJson(file.id)))
  assert.equal(fromJson.name, 'Share Me')
  assert.deepEqual(fromJson.sim, file.sim)

  assert.equal(await store.exportCode(file.id), encodeSaveCode(await store.get(file.id)))
  assert.equal(await store.exportJson('sv_missing'), null)
  assert.equal(await store.exportCode('sv_missing'), null)
})

test('corrupt envelope is backed up, not destroyed', async () => {
  const storage = mockStorage()
  storage.setItem(STORAGE_KEY, '{not json!!')
  const store = createSaveStore({ storage })

  assert.deepEqual(await store.list(), [])
  assert.equal(storage.getItem(`${STORAGE_KEY}:corrupt-backup`), '{not json!!')

  // Store remains usable afterwards
  const file = await store.create('Recovered', createState(1))
  assert.equal((await store.get(file.id)).name, 'Recovered')
})
