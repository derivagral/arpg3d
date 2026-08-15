/**
 * src/games/arpg3d/save.test.js — the save format survived being generalized
 *
 * The envelope machinery moved out of sim/save.js into a reusable factory. The
 * only thing that actually matters about that refactor is that it is invisible
 * on disk: a save written by the previous build must still load, byte for
 * byte, or real players lose real runs.
 *
 * `fixtures/pre-refactor-v2.code.txt` is a genuine export code produced by the
 * PRE-refactor codec. It is a frozen artifact — regenerating it to make a
 * failing test pass would defeat the entire point of having it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { hydrateSim } from '../../../sim/save.js'
import { createSaveFormat } from '../../storage/saveFormat.js'
import { storageKeyFor, baseKeyFor } from '../../storage/saveStore.js'
import {
  arpg3dSaveFormat,
  checkCompatibility,
  decodeSaveCode,
  encodeSaveCode,
  parseImportText,
  createSaveFile,
  GAME_ID,
  SAVE_SCHEMA_VERSION,
} from './save.js'

const LEGACY_CODE = readFileSync(
  fileURLToPath(new URL('./fixtures/pre-refactor-v2.code.txt', import.meta.url)),
  'utf8',
).trim()

// ── On-disk compatibility ───────────────────────────────────────────────────

test('a save written by the pre-refactor build still decodes', () => {
  const file = decodeSaveCode(LEGACY_CODE)

  assert.equal(file.game, 'arpg3d')
  assert.equal(file.v, 2)
  assert.equal(file.id, 'sv_legacy1')
  assert.equal(file.name, 'Pre-refactor run')
})

test('a pre-refactor save is still judged compatible and loads', () => {
  const file = decodeSaveCode(LEGACY_CODE)
  const { compatible, reason, file: usable } = checkCompatibility(file)

  assert.equal(compatible, true, `expected compatible, got: ${reason}`)

  const { state, warnings } = hydrateSim(usable.sim)
  assert.deepEqual(warnings, [])
  assert.equal(state.seed, 4242)
  assert.equal(state.depth, file.meta.depth)
  assert.ok(state.player)
})

test('re-encoding a pre-refactor save reproduces the identical code', () => {
  // The strongest statement available: the new codec is byte-for-byte the old
  // one for the same input.
  const file = decodeSaveCode(LEGACY_CODE)
  assert.equal(encodeSaveCode(file), LEGACY_CODE)
})

test('parseImportText still accepts both a code and raw JSON', () => {
  const fromCode = parseImportText(LEGACY_CODE)
  const fromJson = parseImportText(JSON.stringify(fromCode))
  assert.deepEqual(fromJson, fromCode)
})

test('the game tag, schema version and storage keys are unchanged', () => {
  assert.equal(GAME_ID, 'arpg3d')
  assert.equal(SAVE_SCHEMA_VERSION, 2)
  assert.equal(baseKeyFor(), 'arpg3d:saves:v1')
  assert.equal(storageKeyFor('anon:abc'), 'arpg3d:saves:v1:anon%3Aabc')
  assert.equal(storageKeyFor(null), 'arpg3d:saves:v1')

  // And a freshly written file still carries the same tag.
  const fresh = createSaveFile(hydrateSim(decodeSaveCode(LEGACY_CODE).sim).state, { name: 'x' })
  assert.equal(fresh.game, 'arpg3d')
  assert.equal(fresh.v, 2)
})

// ── The generalization actually generalizes ─────────────────────────────────

const idleFormat = createSaveFormat({
  gameId: 'idle',
  schemaVersion: 1,
  buildBody: (state) => ({ blob: { ...state } }),
  validateBody: (file) => (file.blob ? [] : ['missing blob']),
})

test('a second game gets its own tag, codes and keyspace', () => {
  const file = idleFormat.createSaveFile({ ticks: 12 }, { name: 'Idle run' })

  assert.equal(file.game, 'idle')
  assert.equal(file.v, 1)
  assert.deepEqual(file.blob, { ticks: 12 })
  assert.ok(idleFormat.encodeSaveCode(file).startsWith('idle.v1.'))

  // Separate keyspace, so two games can never collide in storage.
  assert.equal(baseKeyFor('idle'), 'idle:saves:v1')
  assert.notEqual(storageKeyFor('anon:abc', 'idle'), storageKeyFor('anon:abc'))
})

test('games refuse each other saves', () => {
  // The magic tag is what stops a foreign file being imported, and it has to
  // keep working now that there is more than one possible tag.
  const arpgFile = decodeSaveCode(LEGACY_CODE)
  const idleFile = idleFormat.createSaveFile({ ticks: 1 }, { name: 'Idle' })

  assert.equal(idleFormat.checkCompatibility(arpgFile).compatible, false)
  assert.match(idleFormat.checkCompatibility(arpgFile).reason, /game tag 'arpg3d' is not 'idle'/)

  assert.equal(checkCompatibility(idleFile).compatible, false)
  assert.match(checkCompatibility(idleFile).reason, /game tag 'idle' is not 'arpg3d'/)

  assert.throws(() => idleFormat.decodeSaveCode(LEGACY_CODE), /not a idle save code/)
})

test('a body validator rejects a structurally broken file', () => {
  const broken = { game: 'idle', v: 1, id: 'sv_1', name: 'x' }
  const { compatible, reason } = idleFormat.checkCompatibility(broken)
  assert.equal(compatible, false)
  assert.match(reason, /missing blob/)
})

test('a spec missing its essentials is refused at construction', () => {
  assert.throws(() => createSaveFormat({ schemaVersion: 1, buildBody: () => ({}) }), /gameId/)
  assert.throws(() => createSaveFormat({ gameId: 'x', buildBody: () => ({}) }), /schemaVersion/)
  assert.throws(() => createSaveFormat({ gameId: 'x', schemaVersion: 1 }), /buildBody/)
})

test('migrations still run per game, keyed off that game version', () => {
  const migrating = createSaveFormat({
    gameId: 'idle',
    schemaVersion: 3,
    migrations: {
      1: (f) => ({ ...f, v: 2, blob: { ...f.blob, viaV1: true } }),
      2: (f) => ({ ...f, v: 3, blob: { ...f.blob, viaV2: true } }),
    },
    buildBody: (state) => ({ blob: { ...state } }),
  })

  const old = { game: 'idle', v: 1, id: 'sv_1', name: 'Old', blob: { ticks: 5 } }
  const { compatible, migrated, file } = migrating.checkCompatibility(old)

  assert.equal(compatible, true)
  assert.equal(migrated, true)
  assert.equal(file.v, 3)
  assert.deepEqual(file.blob, { ticks: 5, viaV1: true, viaV2: true })

  // No path from a version with no step: refuse rather than silently mangle.
  const orphan = { game: 'idle', v: 1, id: 'sv_1', name: 'Old', blob: {} }
  const noPath = createSaveFormat({
    gameId: 'idle', schemaVersion: 2, migrations: {}, buildBody: () => ({ blob: {} }),
  })
  assert.equal(noPath.checkCompatibility(orphan).compatible, false)
})
