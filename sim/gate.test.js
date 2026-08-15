/**
 * sim/gate.test.js — gate reroll mechanics and gold flow through the engine
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createState, tick } from './engine.js'
import { rerollGate } from './gate.js'
import { rerollCost } from './gold.js'
import { serializeSim, hydrateSim } from './save.js'

// Tick with autopilot until the run reaches the given phase (or dies)
const tickUntil = (state, phase, maxTicks = 50000) => {
  let s = state
  for (let i = 0; i < maxTicks; i++) {
    if (s.phase === phase || s.phase === 'dead') return s
    // autopilot off so gates stay open once reached
    s = tick(s, 16.67, { gateChoice: null, autopilot: phase !== 'gate' })
  }
  return s
}

test('kills drop gold and are counted per type', () => {
  let s = createState(123)
  for (let i = 0; i < 20000 && s.phase !== 'dead'; i++) {
    s = tick(s, 16.67, { gateChoice: null, autopilot: true })
  }
  const totalKills = Object.values(s.player.kills).reduce((a, b) => a + b, 0)
  assert.ok(totalKills > 0, 'no kills recorded')
  assert.ok(s.player.gold >= 0)
  // With 30% chance on basics alone, a full run without any gold is ~impossible
  assert.ok(s.player.gold > 0, 'no gold dropped over a full run')
  assert.ok(s.log.some(e => e.type === 'gold_drop') || s.player.gold > 0)
})

test('rerollGate is a no-op when gold is insufficient', () => {
  let s = tickUntil(createState(7), 'gate')
  assert.equal(s.phase, 'gate')
  s = { ...s, player: { ...s.player, gold: 0 } }

  const after = rerollGate(s)
  assert.equal(after, s)
})

test('rerollGate deducts cost, swaps options, and increments rerolls', () => {
  let s = tickUntil(createState(7), 'gate')
  assert.equal(s.phase, 'gate')
  s = { ...s, player: { ...s.player, gold: 1000 } }

  const beforeIds = s.gate.options.map(o => o.affix.id)
  const cost = rerollCost(s.gate.depth, 0)
  const after = rerollGate(s)

  assert.equal(after.player.gold, 1000 - cost)
  assert.equal(after.gate.rerolls, 1)
  assert.equal(after.gate.options.length, s.gate.options.length)
  const afterIds = after.gate.options.map(o => o.affix.id)
  for (const id of afterIds) {
    assert.ok(!beforeIds.includes(id), `rerolled option ${id} was already offered`)
  }
  assert.equal(after.log.at(-1).type, 'gate_rerolled')
})

test('reroll does not touch pity droughts', () => {
  let s = tickUntil(createState(11), 'gate')
  s = { ...s, player: { ...s.player, gold: 1000 } }
  const after = rerollGate(s)
  assert.deepEqual(after.pity, s.pity)
})

test('reroll cost escalates within the same gate', () => {
  let s = tickUntil(createState(13), 'gate')
  s = { ...s, player: { ...s.player, gold: 10000 } }

  const s1 = rerollGate(s)
  const s2 = rerollGate(s1)
  const spent1 = s.player.gold - s1.player.gold
  const spent2 = s1.player.gold - s2.player.gold
  assert.equal(spent2, spent1 * 2)
  assert.equal(s2.gate.rerolls, 2)
})

test('engine consumes gateReroll input during gate phase', () => {
  let s = tickUntil(createState(17), 'gate')
  s = { ...s, player: { ...s.player, gold: 1000 } }
  const beforeIds = s.gate.options.map(o => o.affix.id)

  const after = tick(s, 16.67, { gateChoice: null, autopilot: false, gateReroll: true })
  assert.equal(after.phase, 'gate', 'reroll must not resolve the gate')
  assert.equal(after.gate.rerolls, 1)
  assert.notDeepEqual(after.gate.options.map(o => o.affix.id), beforeIds)
})

test('kills and gate rerolls survive a save round-trip', () => {
  let s = tickUntil(createState(19), 'gate')
  s = { ...s, player: { ...s.player, gold: 1000 } }
  s = rerollGate(s)

  const { state: hydrated, warnings } = hydrateSim(serializeSim(s))
  assert.deepEqual(warnings, [])
  assert.deepEqual(hydrated.player.kills, s.player.kills)
  assert.equal(hydrated.player.gold, s.player.gold)
  assert.equal(hydrated.gate.rerolls, 1)
})

test('old snapshots without enemy swing fields default from templates', () => {
  const s = createState(29)  // combat phase, enemies present
  const snap = serializeSim(s)
  for (const e of snap.enemies) {
    delete e.attackMs
    delete e.lastHitTick
  }

  const { state: hydrated } = hydrateSim(snap)
  for (const e of hydrated.enemies) {
    assert.ok(e.attackMs > 0, `${e.type} hydrated without attackMs`)
    assert.equal(e.lastHitTick, 0)
  }
})

test('old snapshots without kills/rerolls hydrate with defaults', () => {
  let s = tickUntil(createState(23), 'gate')
  const snap = serializeSim(s)
  delete snap.player.kills
  delete snap.gate.rerolls

  const { state: hydrated } = hydrateSim(snap)
  assert.deepEqual(hydrated.player.kills, {})
  assert.equal(hydrated.gate.rerolls, 0)
})
