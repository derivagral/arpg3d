/**
 * sim/gold.test.js — gold drop rolls and reroll cost curve
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { GOLD_DROPS, rollGoldDrop, rerollCost } from './gold.js'
import { createRNG } from './rng.js'

test('rollGoldDrop is deterministic for the same rng state', () => {
  const rng = createRNG(42)
  const [a1, s1] = rollGoldDrop('tank', rng)
  const [a2, s2] = rollGoldDrop('tank', rng)
  assert.equal(a1, a2)
  assert.equal(s1, s2)
})

test('rollGoldDrop respects per-type amount ranges and drop chance', () => {
  for (const [type, entry] of Object.entries(GOLD_DROPS)) {
    let rng = createRNG(7)
    let drops = 0
    const trials = 2000

    for (let i = 0; i < trials; i++) {
      const [amount, nextRng] = rollGoldDrop(type, rng)
      rng = nextRng
      if (amount > 0) {
        drops++
        assert.ok(amount >= entry.min, `${type} drop ${amount} below min`)
        assert.ok(amount <= entry.max, `${type} drop ${amount} above max`)
      }
    }

    // Observed rate within ±5 percentage points of configured chance
    const rate = drops / trials
    assert.ok(Math.abs(rate - entry.chance) < 0.05,
      `${type} drop rate ${rate} too far from ${entry.chance}`)
  }
})

test('unknown enemy type drops nothing and consumes no rng', () => {
  const rng = createRNG(1)
  const [amount, nextRng] = rollGoldDrop('mystery_boss', rng)
  assert.equal(amount, 0)
  assert.equal(nextRng, rng)
})

test('multiplier scales amounts but never below 1 on a successful drop', () => {
  // Walk rng until a successful tank drop, then compare multiplied roll
  let rng = createRNG(3)
  for (let i = 0; i < 100; i++) {
    const [base, nextRng] = rollGoldDrop('tank', rng)
    if (base > 0) {
      const [doubled] = rollGoldDrop('tank', rng, 2)
      assert.equal(doubled, base * 2)
      const [tiny] = rollGoldDrop('tank', rng, 0.01)
      assert.equal(tiny, 1)
      return
    }
    rng = nextRng
  }
  assert.fail('no tank drop in 100 rolls')
})

test('rerollCost scales with depth and doubles per reroll', () => {
  assert.equal(rerollCost(1), 8)
  assert.equal(rerollCost(5), 20)
  assert.equal(rerollCost(5, 1), 40)
  assert.equal(rerollCost(5, 2), 80)
  assert.ok(rerollCost(10) > rerollCost(5))
})
