/**
 * sim/engine.test.js — melee persistence, kill crediting, gate recovery
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createState, tick, ENEMY_TEMPLATES } from './engine.js'
import { resolveGate, GATE_HEAL_FRACTION } from './gate.js'

// A state with a single hand-placed enemy, no autopilot surprises
const stateWithEnemy = (overrides = {}) => {
  const s = createState(1)
  return {
    ...s,
    enemies: [{
      id: 999, type: 'basic',
      hp: 100000, maxHp: 100000,   // unkillable: isolates melee behavior
      x: 0.7, z: 0,                // inside melee range (1.0)
      damage: 4, speed: 0.04, xp: 5,
      attackMs: 2500, lastHitTick: 0,
      ...overrides,
    }],
  }
}

test('in-range enemies persist after swinging and damage the player', () => {
  let s = stateWithEnemy()
  s = { ...s, tick: 1000 }  // cooldown long elapsed
  const hpBefore = s.player.hp

  s = tick(s, 16.67, { autopilot: false })
  assert.equal(s.enemies.length, 1, 'enemy must persist after its swing')
  assert.equal(s.player.hp, hpBefore - 4)
  assert.equal(s.enemies[0].lastHitTick, s.tick)
})

test('enemies swing on cooldown, not every tick', () => {
  let s = stateWithEnemy()
  s = { ...s, tick: 1000 }
  s = tick(s, 16.67, { autopilot: false })
  const hpAfterFirstSwing = s.player.hp

  // Next few ticks are inside the swing cooldown — no further damage
  for (let i = 0; i < 10; i++) s = tick(s, 16.67, { autopilot: false })
  assert.equal(s.player.hp, hpAfterFirstSwing)

  // After the full cooldown (~150 ticks at 2500ms) it swings again
  for (let i = 0; i < 160; i++) s = tick(s, 16.67, { autopilot: false })
  assert.equal(s.player.hp, hpAfterFirstSwing - 4)
})

test('melee swings do not credit kills or gold', () => {
  let s = stateWithEnemy()
  s = { ...s, tick: 1000 }
  for (let i = 0; i < 200; i++) s = tick(s, 16.67, { autopilot: false })

  assert.deepEqual(s.player.kills, {})
  assert.equal(s.player.gold, 0)
  assert.ok(s.log.every(e => e.type !== 'gold_drop'))
})

test('attack kills credit kills, xp, and roll gold', () => {
  let s = stateWithEnemy({ hp: 1, maxHp: 1, x: 5, z: 0 })  // one shot, out of melee
  s = { ...s, tick: 1000 }
  s = tick(s, 16.67, { autopilot: false })

  assert.equal(s.enemies.length, 0)
  assert.deepEqual(s.player.kills, { basic: 1 })
  assert.equal(s.player.xp, 5)
})

test('all templates define melee swing fields', () => {
  for (const [type, tmpl] of Object.entries(ENEMY_TEMPLATES)) {
    assert.ok(tmpl.attackMs > 0, `${type} missing attackMs`)
    assert.ok(tmpl.damage > 0, `${type} missing damage`)
  }
})

test('resolveGate heals a fraction of maxHp', () => {
  let s = createState(2)
  // Force a gate with a known non-maxHp option
  for (let i = 0; i < 50000 && s.phase !== 'gate'; i++) {
    s = tick(s, 16.67, { gateChoice: null, autopilot: true })
    if (s.phase === 'gate' && s.gate.options.some(o => !o.affix.delta.maxHp)) break
    if (s.phase === 'gate') s = tick(s, 16.67, { gateChoice: 0, autopilot: false })
  }
  assert.equal(s.phase, 'gate')
  const idx = s.gate.options.findIndex(o => !o.affix.delta.maxHp)
  s = { ...s, player: { ...s.player, hp: 10 } }

  const after = resolveGate(s, idx)
  assert.equal(after.player.hp, Math.min(after.player.maxHp, 10 + after.player.maxHp * GATE_HEAL_FRACTION))
})

test('picking a maxHp affix grows the live pool and current hp', () => {
  let s = createState(3)
  for (let i = 0; i < 50000 && s.phase !== 'dead'; i++) {
    if (s.phase === 'gate' && s.gate.options.some(o => o.affix.delta.maxHp)) break
    const input = s.phase === 'gate'
      ? { gateChoice: 0, autopilot: false }
      : { gateChoice: null, autopilot: false }
    s = tick(s, 16.67, input)
  }
  assert.equal(s.phase, 'gate', 'never saw a maxHp offer')

  const idx = s.gate.options.findIndex(o => o.affix.delta.maxHp)
  const gain = s.gate.options[idx].affix.delta.maxHp
  const { maxHp, hp } = s.player

  const after = resolveGate(s, idx)
  assert.equal(after.player.maxHp, maxHp + gain)
  assert.ok(after.player.hp >= Math.min(after.player.maxHp, hp + gain),
    'current hp must grow by at least the maxHp gain')
})
