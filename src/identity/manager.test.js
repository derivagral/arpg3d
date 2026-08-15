/**
 * src/identity/manager.test.js — the shell's identity state machine
 *
 * The provider interface is exercised with fakes rather than the real atproto
 * provider: the point of the interface is that the manager does not know what
 * a provider does, so the tests should not either.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createIdentityManager, SESSION_KEY, RETURN_KEY } from './manager.js'
import { createAnonProvider } from './providers/anon.js'
import { makeIdentity, KIND_ATPROTO, isAnon } from './identity.js'
import { mockStorage } from '../testing/mockStorage.js'

const DID = 'did:plc:abc123'

/** A stand-in redirect provider whose behaviour each test dictates. */
const fakeProvider = (overrides = {}) => ({
  id: 'fake',
  label: 'Sign in with Fake',
  kind: KIND_ATPROTO,
  input: { name: 'handle', label: 'Handle', placeholder: 'you.example' },
  async available() { return true },
  async restore() { return null },
  async signIn() { return makeIdentity({ subject: DID, kind: KIND_ATPROTO }) },
  async signOut() {},
  async completeRedirect() {
    return { identity: makeIdentity({ subject: DID, kind: KIND_ATPROTO }), state: 'fake' }
  },
  ...overrides,
})

const build = (storage, provider = fakeProvider()) =>
  createIdentityManager({
    providers: [provider, createAnonProvider({ storage })],
    storage,
  })

test('a manager without a guest provider is refused', () => {
  // Guest is the fallback floor; without it resolve() could return null and
  // every caller downstream would need a null branch.
  assert.throws(
    () => createIdentityManager({ providers: [fakeProvider()], storage: mockStorage() }),
    /anon.*required/i
  )
})

test('resolve mints a guest on a first visit', async () => {
  const storage = mockStorage()
  const identity = await build(storage).resolve()

  assert.equal(isAnon(identity), true)
  assert.match(identity.subject, /^anon:/)
})

test('the guest subject is stable across boots', async () => {
  const storage = mockStorage()
  const first = await build(storage).resolve()
  const second = await build(storage).resolve()

  // Otherwise every reload would strand the previous visit's saves.
  assert.equal(second.subject, first.subject)
})

test('resolve silently restores the last signed-in session', async () => {
  const storage = mockStorage()
  const signedIn = makeIdentity({ subject: DID, kind: KIND_ATPROTO })
  storage.setItem(SESSION_KEY, 'fake')

  const manager = build(storage, fakeProvider({ async restore() { return signedIn } }))
  const identity = await manager.resolve()

  assert.equal(identity.subject, DID)
  assert.equal(isAnon(identity), false)
})

test('a dead session falls back to guest and stops being retried', async () => {
  const storage = mockStorage()
  storage.setItem(SESSION_KEY, 'fake')

  let restoreCalls = 0
  const manager = build(storage, fakeProvider({
    async restore() { restoreCalls++; return null },
  }))

  const identity = await manager.resolve()
  assert.equal(isAnon(identity), true)
  assert.equal(restoreCalls, 1)

  // The stored pointer is cleared, so the next boot does not pay for it again.
  assert.equal(storage.getItem(SESSION_KEY), null)
  await build(storage, fakeProvider({ async restore() { restoreCalls++; return null } })).resolve()
  assert.equal(restoreCalls, 1)
})

test('a throwing provider still yields a guest rather than failing boot', async () => {
  const storage = mockStorage()
  storage.setItem(SESSION_KEY, 'fake')

  const manager = build(storage, fakeProvider({
    async restore() { throw new Error('network down') },
  }))

  const identity = await manager.resolve()
  assert.equal(isAnon(identity), true)
})

test('signIn stashes the return path before handing off to the provider', async () => {
  const storage = mockStorage()
  let stashedAtCallTime = null

  const manager = build(storage, fakeProvider({
    async signIn() {
      // A redirect provider never returns, so anything written after this
      // call would never run. It has to already be there.
      stashedAtCallTime = storage.getItem(RETURN_KEY)
      return makeIdentity({ subject: DID, kind: KIND_ATPROTO })
    },
  }))

  await manager.resolve()
  await manager.signIn('fake', 'me.example', { returnTo: '/deep/link?x=1' })

  assert.equal(stashedAtCallTime, '/deep/link?x=1')
})

test('a failed signIn does not leave a stale session pointer', async () => {
  const storage = mockStorage()
  const manager = build(storage, fakeProvider({
    async signIn() { throw new Error('bad handle') },
  }))

  await manager.resolve()
  await assert.rejects(() => manager.signIn('fake', 'nope'), /bad handle/)

  assert.equal(storage.getItem(SESSION_KEY), null)
  assert.equal(storage.getItem(RETURN_KEY), null)
})

test('completeRedirect resolves the session and consumes the return path', async () => {
  const storage = mockStorage()
  storage.setItem(SESSION_KEY, 'fake')
  storage.setItem(RETURN_KEY, '/where/i/was')

  const manager = build(storage)
  const { identity, returnTo } = await manager.completeRedirect()

  assert.equal(identity.subject, DID)
  assert.equal(returnTo, '/where/i/was')
  // Consumed, so a stray reload of the callback cannot replay it.
  assert.equal(storage.getItem(RETURN_KEY), null)
})

test('signing out returns the player to the SAME guest, not a new one', async () => {
  const storage = mockStorage()
  const manager = build(storage)

  const guestBefore = await manager.resolve()

  storage.setItem(SESSION_KEY, 'fake')
  const signedIn = await build(storage, fakeProvider({
    async restore() { return makeIdentity({ subject: DID, kind: KIND_ATPROTO }) },
  })).resolve()
  assert.equal(signedIn.subject, DID)

  const after = await manager.signOut()

  // Signing out must not orphan the saves the player made as a guest.
  assert.equal(after.subject, guestBefore.subject)
  assert.equal(isAnon(after), true)
})

test('signOut revokes through the provider that owns the session', async () => {
  const storage = mockStorage()
  storage.setItem(SESSION_KEY, 'fake')

  let revoked = null
  const manager = build(storage, fakeProvider({
    async restore() { return makeIdentity({ subject: DID, kind: KIND_ATPROTO }) },
    async signOut(identity) { revoked = identity.subject },
  }))

  await manager.resolve()
  await manager.signOut()

  assert.equal(revoked, DID)
})

test('a failing revoke still drops the player to guest', async () => {
  const storage = mockStorage()
  storage.setItem(SESSION_KEY, 'fake')

  const manager = build(storage, fakeProvider({
    async restore() { return makeIdentity({ subject: DID, kind: KIND_ATPROTO }) },
    async signOut() { throw new Error('server unreachable') },
  }))

  await manager.resolve()
  const after = await manager.signOut()
  assert.equal(isAnon(after), true)
})

test('subscribers see the current identity immediately and on every change', async () => {
  const storage = mockStorage()
  const manager = build(storage)
  await manager.resolve()

  const seen = []
  const unsubscribe = manager.subscribe(id => seen.push(id.subject))

  assert.equal(seen.length, 1)          // fired with the current value

  await manager.signOut()
  assert.equal(seen.length, 2)

  unsubscribe()
  await manager.signOut()
  assert.equal(seen.length, 2)          // no longer listening
})

test('one throwing subscriber does not starve the others', async () => {
  const storage = mockStorage()
  const manager = build(storage)
  await manager.resolve()

  let reached = false
  manager.subscribe(() => { throw new Error('bad listener') })
  manager.subscribe(() => { reached = true })

  await manager.signOut()
  assert.equal(reached, true)
})

test('availableProviders omits anything unusable here', async () => {
  const storage = mockStorage()
  const manager = createIdentityManager({
    providers: [
      fakeProvider({ id: 'nope', async available() { return false } }),
      fakeProvider({ id: 'boom', async available() { throw new Error('x') } }),
      fakeProvider(),
      createAnonProvider({ storage }),
    ],
    storage,
  })

  const ids = (await manager.availableProviders()).map(p => p.id)
  assert.deepEqual(ids, ['fake', 'anon'])
})

test('forgetGuest mints a different subject', async () => {
  const storage = mockStorage()
  const manager = build(storage)

  const before = await manager.resolve()
  const after = await manager.forgetGuest()

  assert.notEqual(after.subject, before.subject)
  assert.equal(isAnon(after), true)
})

test('the manager survives storage being unavailable', async () => {
  // Private browsing: nothing persists, but the player must still get in.
  const manager = createIdentityManager({
    providers: [createAnonProvider({ storage: null })],
    storage: null,
  })

  const identity = await manager.resolve()
  assert.equal(isAnon(identity), true)
  assert.match(identity.subject, /^anon:/)
})
