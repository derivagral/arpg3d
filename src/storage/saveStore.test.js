/**
 * src/storage/saveStore.test.js — CRUD against a Map-backed mock storage
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createState, tick } from '../../sim/engine.js'
import { encodeSaveCode, SAVE_SCHEMA_VERSION } from '../../sim/save.js'
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

test('create + get + list round-trip', () => {
  const store = createSaveStore(mockStorage())
  const sim = runFor(1, 1000)
  const file = store.create('First', sim)

  assert.equal(store.get(file.id).name, 'First')
  const list = store.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].id, file.id)
  assert.equal(list[0].compatible, true)
  assert.equal(list[0].meta.depth, sim.depth)
})

test('list sorts by updatedAt descending', async () => {
  const store = createSaveStore(mockStorage())
  const a = store.create('A', createState(1))
  await new Promise(r => setTimeout(r, 5))
  const b = store.create('B', createState(2))
  await new Promise(r => setTimeout(r, 5))
  store.update(a.id, runFor(1, 500))  // touching A moves it to the top

  assert.deepEqual(store.list().map(s => s.name), ['A', 'B'])
  assert.equal(b.name, 'B')
})

test('update overwrites the snapshot; missing id returns null', () => {
  const store = createSaveStore(mockStorage())
  const file = store.create('Run', createState(9))
  const later = runFor(9, 3000)

  const updated = store.update(file.id, later)
  assert.equal(updated.id, file.id)
  assert.equal(store.get(file.id).meta.depth, later.depth)
  assert.equal(store.update('sv_missing', later), null)
})

test('rename and remove', () => {
  const store = createSaveStore(mockStorage())
  const file = store.create('Old Name', createState(1))

  store.rename(file.id, 'New Name')
  assert.equal(store.get(file.id).name, 'New Name')

  assert.equal(store.remove(file.id), true)
  assert.equal(store.get(file.id), null)
  assert.equal(store.remove(file.id), false)
})

test('importSaveFile assigns a fresh id and never clobbers existing slots', () => {
  const store = createSaveStore(mockStorage())
  const original = store.create('Mine', runFor(4, 1000))

  // Re-import an export of the same slot (id collision case)
  const imported = store.importSaveFile(JSON.parse(store.exportJson(original.id)))
  assert.notEqual(imported.id, original.id)
  assert.equal(store.list().length, 2)
})

test('importSaveFile rejects incompatible payloads', () => {
  const store = createSaveStore(mockStorage())
  assert.throws(() => store.importSaveFile({ game: 'other' }), /cannot import/)

  const file = store.create('x', createState(1))
  const newer = { ...store.get(file.id), v: SAVE_SCHEMA_VERSION + 1 }
  assert.throws(() => store.importSaveFile(newer), /newer/)
})

test('exportJson and exportCode round-trip through import', () => {
  const store = createSaveStore(mockStorage())
  const file = store.create('Share Me', runFor(8, 2000))

  const fromJson = store.importSaveFile(JSON.parse(store.exportJson(file.id)))
  assert.equal(fromJson.name, 'Share Me')
  assert.deepEqual(fromJson.sim, file.sim)

  assert.equal(store.exportCode(file.id), encodeSaveCode(store.get(file.id)))
  assert.equal(store.exportJson('sv_missing'), null)
  assert.equal(store.exportCode('sv_missing'), null)
})

test('corrupt envelope is backed up, not destroyed', () => {
  const storage = mockStorage()
  storage.setItem(STORAGE_KEY, '{not json!!')
  const store = createSaveStore(storage)

  assert.deepEqual(store.list(), [])
  assert.equal(storage.getItem(`${STORAGE_KEY}:corrupt-backup`), '{not json!!')

  // Store remains usable afterwards
  const file = store.create('Recovered', createState(1))
  assert.equal(store.get(file.id).name, 'Recovered')
})
