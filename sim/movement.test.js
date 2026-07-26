/**
 * sim/movement.test.js — arena bounds, movement policies, manual override
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ARENA_RADIUS,
  PATROL_POINTS,
  MOVE_POLICIES,
  DEFAULT_POLICY,
  clampToArena,
  resolveMove,
} from './movement.js'
import { createState, tick, ENGAGEMENT_SLOTS, BASE_PLAYER, ENEMY_TEMPLATES } from './engine.js'
import { createProfile, runMetaFor } from './profile.js'

// Runs are gated to the policies their character unlocked, so tests that
// exercise patrol/kite must start from a profile that has them.
const META_ALL = runMetaFor({
  ...createProfile(),
  unlocks: ['policy:patrol', 'policy:kite'],
})

const player = (over = {}) => ({ x: 0, z: 0, waypoint: 0, ...over })
const isUnit = ([x, z]) => {
  const m = Math.sqrt(x * x + z * z)
  return m === 0 || Math.abs(m - 1) < 1e-9
}

test('clampToArena leaves interior points and clamps exterior to the rim', () => {
  assert.deepEqual(clampToArena(3, 4), [3, 4])
  const [x, z] = clampToArena(ARENA_RADIUS * 3, 0)
  assert.equal(Math.round(Math.hypot(x, z)), ARENA_RADIUS)
})

test('hold never moves', () => {
  assert.deepEqual(MOVE_POLICIES.hold(player({ x: 5, z: 5 })), [0, 0, 0])
})

test('center walks back toward the origin and settles there', () => {
  const [x, z] = MOVE_POLICIES.center(player({ x: 10, z: 0 }))
  assert.ok(x < 0, 'should move back toward origin')
  assert.equal(z, 0)
  assert.deepEqual(MOVE_POLICIES.center(player()), [0, 0, 0], 'no jitter at origin')
})

test('patrol advances its waypoint on arrival and heads to the next', () => {
  const first = PATROL_POINTS[0]
  const [, , wp] = MOVE_POLICIES.patrol(player({ x: first.x, z: first.z }))
  assert.equal(wp, 1, 'reaching a waypoint advances the circuit')

  const [x, z, held] = MOVE_POLICIES.patrol(player({ x: 0, z: 0, waypoint: 0 }))
  assert.equal(held, 0, 'still travelling keeps the waypoint')
  assert.ok(isUnit([x, z]))
  assert.ok(x > 0, 'heads toward the +x waypoint')
})

test('patrol circuit wraps around', () => {
  const last = PATROL_POINTS[PATROL_POINTS.length - 1]
  const [, , wp] = MOVE_POLICIES.patrol(
    player({ x: last.x, z: last.z, waypoint: PATROL_POINTS.length - 1 })
  )
  assert.equal(wp, 0)
})

test('kite flees the threat and falls back to center when clear', () => {
  const enemies = [{ x: 3, z: 0 }]
  const [x, z] = MOVE_POLICIES.kite(player({ x: 5, z: 0 }), enemies)
  assert.ok(isUnit([x, z]))
  assert.ok(x > 0, 'should move away from an enemy on the -x side')

  // Nothing within threat radius → behaves like center
  const far = [{ x: 500, z: 500 }]
  assert.deepEqual(
    MOVE_POLICIES.kite(player({ x: 5, z: 0 }), far),
    MOVE_POLICIES.center(player({ x: 5, z: 0 }), far)
  )
})

test('manual move input overrides the active policy', () => {
  const p = player({ x: 5, z: 5 })
  const manual = resolveMove(p, [], { move: { x: 0, z: 10 }, movePolicy: 'hold' })
  assert.deepEqual(manual, [0, 1, 0], 'normalized, and hold did not win')
})

test('resolveMove falls back to the default policy for unknown names', () => {
  const p = player({ x: 7, z: 0 })
  assert.deepEqual(
    resolveMove(p, [], { movePolicy: 'nonexistent' }),
    MOVE_POLICIES[DEFAULT_POLICY](p, [])
  )
})

test('policies keep the player inside the arena over a long run', () => {
  let s = createState(5, META_ALL)
  for (let i = 0; i < 5000 && s.phase !== 'dead'; i++) {
    s = tick(s, 16.67, { gateChoice: null, autopilot: true, movePolicy: 'patrol' })
    assert.ok(
      Math.hypot(s.player.x, s.player.z) <= ARENA_RADIUS + 1e-9,
      'player escaped the arena'
    )
  }
})

test('engagement slots cap simultaneous attackers', () => {
  // Ring far more enemies around the player than there are slots
  const base = createState(9)
  const swarm = Array.from({ length: 20 }, (_, i) => ({
    id: 1000 + i, type: 'basic', hp: 1e6, maxHp: 1e6,
    x: Math.cos(i) * 0.4, z: Math.sin(i) * 0.4,
    damage: 5, speed: 0, xp: 1, attackMs: 100, lastHitTick: 0,
  }))
  let s = { ...base, enemies: swarm, tick: 10000 }

  const before = s.player.hp
  s = tick(s, 16.67, { autopilot: false, movePolicy: 'hold' })
  const hits = s.player.hp === before ? 0 : (before - s.player.hp) / 5
  assert.ok(hits <= ENGAGEMENT_SLOTS, `${hits} enemies swung, cap is ${ENGAGEMENT_SLOTS}`)
  assert.equal(s.enemies.length, 20, 'crowded enemies still persist')
})

test('movement policy materially changes run outcome', () => {
  const runTo = (policy) => {
    let s = createState(31337, META_ALL)
    for (let i = 0; i < 60000 && s.phase !== 'dead'; i++) {
      s = tick(s, 16.67, { gateChoice: null, autopilot: true, movePolicy: policy })
    }
    return s.depth
  }
  assert.ok(runTo('kite') > runTo('hold'), 'kiting must outperform standing still')
})

test('player position survives a save round-trip', async () => {
  const { serializeSim, hydrateSim } = await import('./save.js')
  let s = createState(77, META_ALL)
  for (let i = 0; i < 600; i++) {
    s = tick(s, 16.67, { gateChoice: null, autopilot: true, movePolicy: 'patrol' })
  }
  const { state: h } = hydrateSim(serializeSim(s))
  assert.equal(h.player.x, s.player.x)
  assert.equal(h.player.z, s.player.z)
  assert.equal(h.player.waypoint, s.player.waypoint)
})

test('pre-movement snapshots hydrate at the origin', async () => {
  const { serializeSim, hydrateSim } = await import('./save.js')
  const snap = serializeSim(createState(3))
  delete snap.player.x
  delete snap.player.z
  delete snap.player.waypoint

  const { state } = hydrateSim(snap)
  assert.equal(state.player.x, 0)
  assert.equal(state.player.z, 0)
  assert.equal(state.player.waypoint, 0)
})

test('maxHp has a single source: derived stats, never accumulation', async () => {
  const { derivePlayerStats } = await import('./player.js')
  let s = createState(123, META_ALL)
  for (let i = 0; i < 40000 && s.phase !== 'dead'; i++) {
    s = tick(s, 16.67, { gateChoice: null, autopilot: true, movePolicy: 'kite' })
    if (s.phase === 'combat') {
      assert.equal(s.player.maxHp, derivePlayerStats(s.player.affixes).maxHp)
    }
  }
  assert.ok(s.player.affixes.length > 0, 'run gained no affixes')
})

test('BASE_PLAYER speed outpaces slow archetypes but not the fast one', () => {
  // Guards the balance premise that movement is a tradeoff, not immunity
  assert.ok(ENEMY_TEMPLATES.fast.speed > BASE_PLAYER.speed, 'fast must catch the player')
  assert.ok(ENEMY_TEMPLATES.tank.speed < BASE_PLAYER.speed, 'tank must be kiteable')
})
