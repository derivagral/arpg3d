/**
 * sim/profile.test.js — echoes, upgrade board, achievements, meta determinism
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createProfile,
  echoesForRun,
  awardRun,
  purchaseUpgrade,
  upgradeCost,
  applyUpgrades,
  unlockedPolicies,
  activePolicy,
  setMovePolicy,
  runMetaFor,
  summarizeRun,
  hydrateProfile,
  countUnseen,
  highestUid,
  UPGRADES,
  ACHIEVEMENTS,
  BASE_POLICIES,
  ECHO_PER_DEPTH,
  ECHO_PB_BONUS,
} from './profile.js'
import { BASE_PLAYER, baseForRun, derivePlayerStats } from './player.js'
import { createState, tick } from './engine.js'
import { MOVE_POLICIES, DEFAULT_POLICY } from './movement.js'

// ── Echo payout ──────────────────────────────────────────────────────────────

test('echoes pay for depth reached, so farming is never worthless', () => {
  const { base, pb, total } = echoesForRun(10, 10)
  assert.equal(base, ECHO_PER_DEPTH * (10 * 11) / 2, 'triangular in depth')
  assert.equal(pb, 0, 'no record bonus when not beating the record')
  assert.equal(total, base)
})

test('payout grows super-linearly, so a deep run beats several shallow ones', () => {
  const deep = echoesForRun(20, 20).base
  const shallow = echoesForRun(5, 5).base
  assert.ok(deep > shallow * 4, `depth 20 (${deep}) should dwarf 4x depth 5 (${shallow})`)
})

test('beating the record pays a bonus per new depth level', () => {
  const { pb } = echoesForRun(13, 10)
  assert.equal(pb, 3 * ECHO_PB_BONUS)
})

test('pushing pays substantially more than repeating a safe depth', () => {
  const farm = echoesForRun(10, 10).total
  const push = echoesForRun(13, 10).total
  assert.ok(push > farm * 2, `push ${push} should dwarf farm ${farm}`)
})

// ── awardRun ─────────────────────────────────────────────────────────────────

const summary = (over = {}) => ({ depth: 5, kills: { basic: 10 }, gold: 30, elapsed: 1000, ...over })

test('awardRun banks echoes, raises the record, and accumulates lifetime stats', () => {
  const p0 = createProfile()
  const { profile: p1, echoes } = awardRun(p0, summary())

  assert.equal(p1.echoes, echoes.total)
  assert.equal(p1.bestDepth, 5)
  assert.equal(p1.runs, 1)
  assert.equal(p1.lifetime.gold, 30)
  assert.deepEqual(p1.lifetime.kills, { basic: 10 })

  const { profile: p2 } = awardRun(p1, summary({ depth: 3, kills: { basic: 4, tank: 1 } }))
  assert.equal(p2.bestDepth, 5, 'a worse run does not lower the record')
  assert.equal(p2.runs, 2)
  assert.deepEqual(p2.lifetime.kills, { basic: 14, tank: 1 })
})

test('awardRun does not mutate the profile it is given', () => {
  const p0 = createProfile()
  const snapshot = JSON.parse(JSON.stringify(p0))
  awardRun(p0, summary())
  assert.deepEqual(p0, snapshot)
})

// ── Achievements → policy unlocks ────────────────────────────────────────────

test('reaching depth thresholds unlocks movement policies', () => {
  let p = createProfile()
  assert.deepEqual(unlockedPolicies(p), BASE_POLICIES)

  ;({ profile: p } = awardRun(p, summary({ depth: 4 })))
  assert.ok(unlockedPolicies(p).includes('patrol'), 'depth 4 should grant patrol')
  assert.ok(!unlockedPolicies(p).includes('kite'), 'kite is not earned yet')

  ;({ profile: p } = awardRun(p, summary({ depth: 20 })))
  assert.ok(unlockedPolicies(p).includes('kite'), 'depth 20 should grant kite')
})

// ── The standing order (movement policy preference) ──────────────────────────

test('a fresh profile starts on the default policy', () => {
  assert.equal(createProfile().movePolicy, DEFAULT_POLICY)
  assert.equal(activePolicy(createProfile()), DEFAULT_POLICY)
})

test('setMovePolicy refuses unknown and locked policies, with a reason', () => {
  const p = createProfile()

  const unknown = setMovePolicy(p, 'sprint')
  assert.equal(unknown.set, false)
  assert.match(unknown.reason, /unknown/)
  assert.equal(unknown.profile, p, 'a refusal returns the profile untouched')

  const locked = setMovePolicy(p, 'patrol')
  assert.equal(locked.set, false)
  assert.match(locked.reason, /not unlocked/)
  assert.equal(locked.profile.movePolicy, DEFAULT_POLICY)
})

test('setMovePolicy takes an unlocked policy and is pure', () => {
  const before = createProfile()
  const snapshot = JSON.parse(JSON.stringify(before))

  const { profile: earned } = awardRun(before, summary({ depth: 4 }))
  const { profile: next, set } = setMovePolicy(earned, 'patrol')

  assert.equal(set, true)
  assert.equal(next.movePolicy, 'patrol')
  assert.deepEqual(before, snapshot, 'the input profile is never mutated')
})

test('a stored policy is clamped to what the profile can actually use', () => {
  // Reachable by editing a save, or by a policy being retired from the pool.
  // Either way the engine would silently fall back; say so here instead.
  assert.equal(activePolicy({ ...createProfile(), movePolicy: 'kite' }), DEFAULT_POLICY)
  assert.equal(activePolicy({ ...createProfile(), movePolicy: 'sprint' }), DEFAULT_POLICY)

  const { profile: earned } = awardRun(createProfile(), summary({ depth: 20 }))
  assert.equal(activePolicy({ ...earned, movePolicy: 'kite' }), 'kite')
})

test('the chosen policy survives a save round-trip', () => {
  const { profile: earned } = awardRun(createProfile(), summary({ depth: 4 }))
  const { profile: chosen } = setMovePolicy(earned, 'patrol')

  const reloaded = hydrateProfile(JSON.parse(JSON.stringify(chosen)))
  assert.equal(reloaded.movePolicy, 'patrol')

  // A save written before this field existed reads as the default, not undefined.
  const legacy = { ...JSON.parse(JSON.stringify(chosen)) }
  delete legacy.movePolicy
  assert.equal(hydrateProfile(legacy).movePolicy, DEFAULT_POLICY)
})

test('achievements are awarded once and reported when earned', () => {
  let p = createProfile()
  const first = awardRun(p, summary({ depth: 4 }))
  assert.ok(first.unlocked.some(a => a.id === 'depth_4'))

  const second = awardRun(first.profile, summary({ depth: 7 }))
  assert.ok(!second.unlocked.some(a => a.id === 'depth_4'), 'no duplicate award')
  assert.equal(
    second.profile.achievements.filter(id => id === 'depth_4').length, 1
  )
})

test('lifetime achievements fire off accumulated stats', () => {
  let p = createProfile()
  for (let i = 0; i < 30; i++) {
    ;({ profile: p } = awardRun(p, summary({ depth: 1, kills: { basic: 40 }, gold: 80 })))
  }
  assert.ok(p.achievements.includes('slayer_1000'), '1200 kills should earn Slayer')
  assert.ok(p.achievements.includes('hoarder_2000'), '2400 gold should earn Hoarder')
})

test('every policy an achievement grants actually exists', () => {
  for (const a of ACHIEVEMENTS) {
    if (!a.grants?.startsWith('policy:')) continue
    const name = a.grants.slice('policy:'.length)
    assert.ok(name in MOVE_POLICIES, `${a.id} grants unknown policy '${name}'`)
  }
})

// ── Upgrade board ────────────────────────────────────────────────────────────

test('purchases spend echoes and raise the level', () => {
  let p = { ...createProfile(), echoes: 1000 }
  const cost = upgradeCost('vitality', 0)
  const { profile: next, bought } = purchaseUpgrade(p, 'vitality')

  assert.ok(bought)
  assert.equal(next.upgrades.vitality, 1)
  assert.equal(next.echoes, 1000 - cost)
  assert.equal(next.spent, cost)
})

test('purchases fail cleanly when unaffordable, unknown, or maxed', () => {
  const broke = { ...createProfile(), echoes: 0 }
  assert.equal(purchaseUpgrade(broke, 'vitality').bought, false)
  assert.equal(purchaseUpgrade(broke, 'vitality').profile, broke, 'no-op returns same profile')

  const rich = { ...createProfile(), echoes: 1e9 }
  assert.equal(purchaseUpgrade(rich, 'no_such_upgrade').bought, false)

  const vit = UPGRADES.find(u => u.id === 'vitality')
  const maxed = { ...rich, upgrades: { vitality: vit.maxLevel } }
  assert.equal(purchaseUpgrade(maxed, 'vitality').bought, false)
  assert.equal(upgradeCost('vitality', vit.maxLevel), null)
})

test('upgrade costs increase with level', () => {
  assert.ok(upgradeCost('vitality', 3) > upgradeCost('vitality', 0))
})

test('applyUpgrades modifies base stats without mutating the base', () => {
  const before = { ...BASE_PLAYER }
  const upgraded = applyUpgrades(BASE_PLAYER, { vitality: 3, might: 2 })

  assert.equal(upgraded.maxHp, BASE_PLAYER.maxHp + 24)
  assert.equal(upgraded.damage, BASE_PLAYER.damage + 4)
  assert.deepEqual(BASE_PLAYER, before, 'BASE_PLAYER must not be mutated')
})

test('levels beyond maxLevel are clamped', () => {
  const vit = UPGRADES.find(u => u.id === 'vitality')
  const absurd = applyUpgrades(BASE_PLAYER, { vitality: 9999 })
  const capped = applyUpgrades(BASE_PLAYER, { vitality: vit.maxLevel })
  assert.equal(absurd.maxHp, capped.maxHp)
})

test('NO upgrade may touch move speed', () => {
  // The movement balance rests on 'fast' (0.17) outrunning the player (0.15).
  // A meta move-speed bonus makes every policy unkillable again.
  const maxed = Object.fromEntries(UPGRADES.map(u => [u.id, u.maxLevel]))
  const upgraded = applyUpgrades(BASE_PLAYER, maxed)
  assert.equal(upgraded.speed, BASE_PLAYER.speed, 'meta must never grant move speed')
})

test('a fully-maxed board stays within roughly a 2x power budget', () => {
  const maxed = Object.fromEntries(UPGRADES.map(u => [u.id, u.maxLevel]))
  const up = applyUpgrades(BASE_PLAYER, maxed)
  assert.ok(up.maxHp / BASE_PLAYER.maxHp <= 2, `maxHp ${up.maxHp} exceeds 2x budget`)
  assert.ok(up.damage / BASE_PLAYER.damage <= 2, `damage ${up.damage} exceeds 2x budget`)
})

// ── Determinism: meta enters a run only as a snapshot ────────────────────────

test('a run uses the meta it was created with, not live profile state', () => {
  const profile = { ...createProfile(), upgrades: { vitality: 4 } }
  const meta = runMetaFor(profile)
  const s = createState(42, meta)

  const expected = applyUpgrades(BASE_PLAYER, { vitality: 4 }).maxHp
  assert.equal(s.player.maxHp, expected, 'upgrades apply at run creation')

  // Mutating the profile afterwards must not affect the live run
  profile.upgrades.vitality = 8
  const after = tick(s, 16.67, { autopilot: false })
  assert.equal(after.player.maxHp, expected, 'run must not observe later meta changes')
})

test('runMeta drives derived stats through baseForRun', () => {
  const meta = runMetaFor({ ...createProfile(), upgrades: { might: 3 } })
  assert.equal(baseForRun(meta).damage, BASE_PLAYER.damage + 6)
  assert.equal(derivePlayerStats([], baseForRun(meta)).damage, BASE_PLAYER.damage + 6)
  assert.equal(baseForRun(undefined).damage, BASE_PLAYER.damage, 'no meta → plain base')
})

test('the engine ignores a movement policy the run has not unlocked', () => {
  const locked = createState(11)  // default profile: hold + center only
  assert.ok(!locked.runMeta.policies.includes('kite'))

  // Drive a few hundred ticks with an illegitimate policy; the player should
  // behave as the default (center) rather than kiting.
  let cheat = locked
  let honest = locked
  for (let i = 0; i < 300; i++) {
    cheat = tick(cheat, 16.67, { autopilot: false, movePolicy: 'kite' })
    honest = tick(honest, 16.67, { autopilot: false })
  }
  assert.equal(cheat.player.x, honest.player.x)
  assert.equal(cheat.player.z, honest.player.z)
})

test('summarizeRun captures what the profile needs', () => {
  let s = createState(8)
  for (let i = 0; i < 2000 && s.phase !== 'dead'; i++) {
    s = tick(s, 16.67, { gateChoice: null, autopilot: true })
  }
  const sum = summarizeRun(s)
  assert.equal(sum.depth, s.depth)
  assert.equal(sum.gold, s.player.gold)
  assert.deepEqual(sum.kills, s.player.kills)
})

// ── Banking accounting ───────────────────────────────────────────────────────

test('awardRun COPIES the haul — every item is accounted for exactly once', () => {
  // awardRun does not (and cannot) empty the run's bag, so the caller must.
  // If it forgets, the same items sit in both the haul and the vault: they
  // read as duplicated, and storing again would really duplicate them.
  // stashed + overflow must therefore cover the input with no gaps or repeats.
  const items = Array.from({ length: 5 }, (_, i) => ({ uid: i + 1, affixes: [] }))
  const { profile, stashed, overflow } = awardRun(createProfile(), {
    depth: 3, kills: {}, gold: 0, elapsed: 1, items,
  })

  const seen = [...stashed, ...overflow].map(i => i.uid).sort()
  assert.deepEqual(seen, [1, 2, 3, 4, 5], 'no item lost or double-counted')
  assert.equal(countUnseen(profile.stash, 0), 5, 'all five reached the vault')
})

test('a full vault leaves the overflow for the caller to keep', () => {
  const full = { ...createProfile(), stash: new Array(240).fill({ uid: 0, affixes: [] }) }
  const items = [{ uid: 1, affixes: [] }, { uid: 2, affixes: [] }]
  const { stashed, overflow } = awardRun(full, {
    depth: 1, kills: {}, gold: 0, elapsed: 1, items,
  })
  assert.equal(stashed.length, 0)
  assert.deepEqual(overflow.map(i => i.uid), [1, 2], 'nothing is silently destroyed')
})

// ── New-item nudge bookkeeping ───────────────────────────────────────────────

test('countUnseen only counts items above the seen watermark', () => {
  const bag = [
    { uid: 1 }, null, { uid: 4 }, { uid: 7 }, null,
  ]
  assert.equal(countUnseen(bag, 0), 3, 'nothing seen yet')
  assert.equal(countUnseen(bag, 4), 1, 'only uid 7 is newer')
  assert.equal(countUnseen(bag, 7), 0, 'all caught up')
  assert.equal(countUnseen([], 0), 0)
  assert.equal(countUnseen(undefined, 0), 0)
})

test('highestUid finds the watermark to acknowledge, never going backwards', () => {
  const bag = [{ uid: 3 }, null, { uid: 9 }]
  assert.equal(highestUid(bag, 0), 9)
  assert.equal(highestUid([], 5), 5, 'an empty bag keeps the old watermark')
  assert.equal(highestUid([{ uid: 2 }], 5), 5, 'older items never lower it')
})

test('the seen watermark persists through hydration', () => {
  assert.equal(createProfile().seenItemUid, 0)
  assert.equal(hydrateProfile({ seenItemUid: 12 }).seenItemUid, 12)
  assert.equal(hydrateProfile({}).seenItemUid, 0)
})

// ── Hydration ────────────────────────────────────────────────────────────────

test('hydrateProfile fills defaults and tolerates junk', () => {
  assert.deepEqual(hydrateProfile(null), createProfile())
  assert.deepEqual(hydrateProfile('nonsense'), createProfile())

  const partial = hydrateProfile({ echoes: 50, upgrades: { might: 2 } })
  assert.equal(partial.echoes, 50)
  assert.deepEqual(partial.upgrades, { might: 2 })
  assert.deepEqual(partial.unlocks, [])
  assert.deepEqual(partial.lifetime.kills, {})
})
