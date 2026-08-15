/**
 * sim/save.test.js — save codec round-trip, versioning, and export codes
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createState, tick } from './engine.js'
import { createProfile, BASE_POLICIES } from './profile.js'
import { AFFIX_POOL } from './affixes.js'
import {
  SAVE_SCHEMA_VERSION,
  GAME_ID,
  serializeSim,
  hydrateSim,
  createSaveFile,
  updateSaveFile,
  validateSaveFile,
  checkCompatibility,
  encodeSaveCode,
  decodeSaveCode,
  parseImportText,
} from './save.js'

// Advance a fresh run far enough to accumulate affixes, pity, and rng churn.
const runFor = (seed, ticks) => {
  let s = createState(seed)
  for (let i = 0; i < ticks; i++) {
    s = tick(s, 16.67, { gateChoice: null, autopilot: true })
    if (s.phase === 'dead') break
  }
  return s
}

// Everything except the log must survive a round trip (log is dropped by design).
const stripLog = ({ log, ...rest }) => rest

test('serialize → hydrate round-trips all sim fields except log', () => {
  const state = runFor(12345, 3000)
  const { state: hydrated, warnings } = hydrateSim(serializeSim(state))

  assert.deepEqual(warnings, [])
  assert.deepEqual(stripLog(hydrated), stripLog(state))
  assert.equal(hydrated.log.length, 1)
  assert.equal(hydrated.log[0].type, 'run_resumed')
})

test('hydrated state ticks identically to the original (determinism)', () => {
  let original = runFor(99, 2000)
  let { state: resumed } = hydrateSim(serializeSim(original))

  for (let i = 0; i < 1000; i++) {
    const input = { gateChoice: null, autopilot: true }
    original = tick(original, 16.67, input)
    resumed = tick(resumed, 16.67, input)
  }
  assert.deepEqual(stripLog(resumed), stripLog(original))
})

test('round-trips mid-gate state with pending options', () => {
  // Tick until a gate is open
  let s = createState(7)
  for (let i = 0; i < 100000 && s.phase !== 'gate'; i++) {
    s = tick(s, 16.67, { gateChoice: null, autopilot: false })
  }
  assert.equal(s.phase, 'gate')
  assert.ok(s.gate.options.length >= 2)

  const { state: hydrated } = hydrateSim(serializeSim(s))
  assert.deepEqual(stripLog(hydrated), stripLog(s))

  // Resolving the same choice on both produces the same build
  const a = tick(s, 16.67, { gateChoice: 0, autopilot: false })
  const b = tick(hydrated, 16.67, { gateChoice: 0, autopilot: false })
  assert.deepEqual(b.player.affixes, a.player.affixes)
})

test('affixes rehydrate from pool but keep stored (scaled) deltas', () => {
  const state = createState(1)
  const pooled = AFFIX_POOL.find(a => a.id === 'flat_dmg_1')
  const scaled = { ...pooled, delta: { flatDamage: 7.77 } }  // pretend wave-scaled
  state.player.affixes = [scaled]

  const { state: hydrated, warnings } = hydrateSim(serializeSim(state))
  assert.deepEqual(warnings, [])
  assert.equal(hydrated.player.affixes[0].name, pooled.name)
  assert.deepEqual(hydrated.player.affixes[0].delta, { flatDamage: 7.77 })
})

test('unknown affix ids load as inert stubs with a warning', () => {
  const state = createState(1)
  state.player.affixes = [{
    id: 'removed_affix_x', name: 'Old', desc: '', tags: ['damage'],
    category: 'offense', weight: 1, value: 1,
    delta: { flatDamage: 3 }, minIlvl: 0, slotPool: null, sourcePool: null,
  }]

  const { state: hydrated, warnings } = hydrateSim(serializeSim(state))
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /removed_affix_x/)
  const stub = hydrated.player.affixes[0]
  assert.equal(stub.id, 'removed_affix_x')
  assert.deepEqual(stub.delta, { flatDamage: 3 })
  assert.deepEqual(stub.tags, [])
})

test('createSaveFile produces a valid, compatible envelope', () => {
  const file = createSaveFile(runFor(42, 1500), { name: 'Test Run' })

  assert.equal(file.game, GAME_ID)
  assert.equal(file.v, SAVE_SCHEMA_VERSION)
  assert.equal(file.name, 'Test Run')
  assert.ok(file.id.startsWith('sv_'))
  assert.ok(file.meta.depth >= 1)

  assert.deepEqual(validateSaveFile(file), { ok: true, errors: [] })
  assert.equal(checkCompatibility(file).compatible, true)
})

test('updateSaveFile preserves identity, refreshes snapshot and meta', () => {
  const s1 = runFor(42, 500)
  const file = createSaveFile(s1, { name: 'Slot', now: 1000 })
  const s2 = runFor(42, 4000)
  const updated = updateSaveFile(file, s2, 2000)

  assert.equal(updated.id, file.id)
  assert.equal(updated.createdAt, file.createdAt)
  assert.equal(updated.updatedAt, 2000)
  assert.deepEqual(hydrateSim(updated.sim).state.player, stripLog(s2).player)
})

test('validateSaveFile rejects malformed objects', () => {
  assert.equal(validateSaveFile(null).ok, false)
  assert.equal(validateSaveFile('nope').ok, false)
  assert.equal(validateSaveFile({}).ok, false)
  assert.equal(validateSaveFile({ game: 'other', v: 1 }).ok, false)

  const good = createSaveFile(createState(1), { name: 'x' })
  const badPhase = { ...good, sim: { ...good.sim, phase: 'limbo' } }
  assert.match(validateSaveFile(badPhase).errors.join(), /phase/)
})

test('checkCompatibility rejects newer schema and unmigratable older schema', () => {
  const file = createSaveFile(createState(1), { name: 'x' })

  const newer = { ...file, v: SAVE_SCHEMA_VERSION + 1 }
  const newerResult = checkCompatibility(newer)
  assert.equal(newerResult.compatible, false)
  assert.match(newerResult.reason, /newer/)

  const older = { ...file, v: 0 }
  const olderResult = checkCompatibility(older)
  assert.equal(olderResult.compatible, false)
  assert.match(olderResult.reason, /no migration path/)
})

test('encodeSaveCode → decodeSaveCode round-trips', () => {
  const file = createSaveFile(runFor(5, 2000), { name: 'Códe ✓ Run' })
  const code = encodeSaveCode(file)

  assert.match(code, new RegExp(`^${GAME_ID}\\.v${SAVE_SCHEMA_VERSION}\\.[A-Za-z0-9_-]+$`))
  assert.deepEqual(decodeSaveCode(code), file)
  assert.deepEqual(decodeSaveCode(`  ${code}\n`), file)  // tolerates whitespace
})

test('decodeSaveCode rejects foreign strings', () => {
  assert.throws(() => decodeSaveCode('hello world'))
  assert.throws(() => decodeSaveCode('othergame.v1.eyJ9'))
})

test('parseImportText accepts raw JSON and portable codes', () => {
  const file = createSaveFile(createState(3), { name: 'imp' })
  assert.deepEqual(parseImportText(JSON.stringify(file)), file)
  assert.deepEqual(parseImportText(encodeSaveCode(file)), file)
})

// ── v1 → v2: slots became characters ────────────────────────────────────────

test('a v1 save migrates to v2 with a fresh profile and runMeta', () => {
  // Build a v1-shaped file: no profile on the envelope, no runMeta in the sim
  const modern = createSaveFile(runFor(11, 1500), { name: 'legacy slot' })
  const { profile: _p, ...envelope } = modern
  const { runMeta: _m, ...sim } = modern.sim
  const legacy = { ...envelope, v: 1, sim }

  const { compatible, file, migrated } = checkCompatibility(legacy)
  assert.ok(compatible, 'v1 must have a migration path')
  assert.ok(migrated)
  assert.equal(file.v, SAVE_SCHEMA_VERSION)

  assert.deepEqual(file.profile, createProfile(), 'starts as a brand-new character')
  assert.deepEqual(
    file.sim.runMeta.policies, BASE_POLICIES,
    'a migrated run has only the base policies'
  )

  // And it still loads and ticks
  const { state } = hydrateSim(file.sim)
  assert.equal(state.depth, legacy.sim.depth)
  assert.doesNotThrow(() => tick(state, 16.67, { autopilot: true }))
})

test('the profile round-trips through create/update and reaches slot meta', () => {
  const state = runFor(13, 1200)
  const profile = {
    ...createProfile(), echoes: 140, bestDepth: 9, runs: 4,
    upgrades: { vitality: 2 }, unlocks: ['policy:patrol'],
  }

  const file = createSaveFile(state, { name: 'char', profile })
  assert.equal(file.profile.echoes, 140)
  assert.equal(file.meta.echoes, 140, 'slot list can show standing without hydrating')
  assert.equal(file.meta.bestDepth, 9)

  // Omitting the profile on update preserves the one already stored
  const kept = updateSaveFile(file, state)
  assert.deepEqual(kept.profile, file.profile)

  // Passing one overwrites it
  const bumped = updateSaveFile(file, state, Date.now(), { ...profile, echoes: 300 })
  assert.equal(bumped.profile.echoes, 300)
  assert.equal(bumped.meta.echoes, 300)
})

test('a save created without a profile still validates and loads', () => {
  const file = createSaveFile(createState(2), { name: 'no profile' })
  assert.deepEqual(file.profile, createProfile())
  assert.ok(checkCompatibility(file).compatible)
})
