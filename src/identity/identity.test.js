/**
 * src/identity/identity.test.js — the Identity value type
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  makeIdentity,
  isAnon,
  displayLabel,
  shortSubject,
  subjectKey,
  withDisplay,
  sameSubject,
  KIND_ANON,
  KIND_ATPROTO,
} from './identity.js'

test('an identity is frozen, including its display block', () => {
  const id = makeIdentity({
    subject: 'did:plc:abc123',
    kind: KIND_ATPROTO,
    display: { handle: 'patrick.bsky.social' },
  })

  assert.ok(Object.isFrozen(id))
  assert.ok(Object.isFrozen(id.display))
  assert.throws(() => { 'use strict'; id.subject = 'did:plc:evil' }, TypeError)
})

test('a half-formed identity is rejected rather than stored', () => {
  // A bad subject means saves written to the wrong namespace, so this must
  // fail loudly at construction, not silently downstream.
  assert.throws(() => makeIdentity({ kind: KIND_ANON }), TypeError)
  assert.throws(() => makeIdentity({ subject: '', kind: KIND_ANON }), TypeError)
  assert.throws(() => makeIdentity({ subject: 'anon:1' }), TypeError)
})

test('display defaults to null and normalizes partial input', () => {
  const bare = makeIdentity({ subject: 'anon:1', kind: KIND_ANON })
  assert.equal(bare.display, null)

  const partial = makeIdentity({
    subject: 'did:plc:x',
    kind: KIND_ATPROTO,
    display: { name: 'Patrick' },
  })
  assert.deepEqual(partial.display, { handle: null, name: 'Patrick', avatar: null })
})

test('displayLabel prefers handle, then name, then a shortened subject', () => {
  const guest = makeIdentity({ subject: 'anon:abc', kind: KIND_ANON })
  assert.equal(displayLabel(guest), 'Guest')

  const handled = makeIdentity({
    subject: 'did:plc:x', kind: KIND_ATPROTO, display: { handle: 'a.bsky.social', name: 'A' },
  })
  assert.equal(displayLabel(handled), '@a.bsky.social')

  const named = makeIdentity({
    subject: 'did:plc:x', kind: KIND_ATPROTO, display: { name: 'Patrick' },
  })
  assert.equal(displayLabel(named), 'Patrick')

  const anonymousDid = makeIdentity({
    subject: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaaaa', kind: KIND_ATPROTO,
  })
  assert.match(displayLabel(anonymousDid), /^did:plc:/)
})

test('isAnon distinguishes guests from signed-in players', () => {
  assert.equal(isAnon(makeIdentity({ subject: 'anon:1', kind: KIND_ANON })), true)
  assert.equal(isAnon(makeIdentity({ subject: 'did:plc:x', kind: KIND_ATPROTO })), false)
  assert.equal(isAnon(null), false)
})

test('subjectKey escapes the colons every DID contains', () => {
  // Unescaped, 'did:plc:x' would collide with the ':' separators callers use
  // to build storage keys.
  assert.equal(subjectKey('did:plc:abc'), 'did%3Aplc%3Aabc')
  assert.equal(subjectKey('anon:1-2'), 'anon%3A1-2')
})

test('shortSubject is lossy and only for display', () => {
  assert.equal(shortSubject('anon:short'), 'anon:short')
  const long = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  assert.ok(shortSubject(long).length < long.length)
  assert.ok(shortSubject(long).includes('…'))
})

test('withDisplay refreshes cosmetics without touching the key', () => {
  const before = makeIdentity({ subject: 'did:plc:x', kind: KIND_ATPROTO })
  const after = withDisplay(before, { handle: 'new.handle' })

  assert.equal(after.subject, before.subject)
  assert.equal(after.kind, before.kind)
  assert.equal(after.display.handle, 'new.handle')
})

test('sameSubject compares the key, not the handle', () => {
  const a = makeIdentity({ subject: 'did:plc:x', kind: KIND_ATPROTO, display: { handle: 'old' } })
  const b = makeIdentity({ subject: 'did:plc:x', kind: KIND_ATPROTO, display: { handle: 'new' } })
  const c = makeIdentity({ subject: 'did:plc:y', kind: KIND_ATPROTO, display: { handle: 'old' } })

  // A handle can change hands; the DID cannot. Renaming must not look like a
  // different player, and a reused handle must not look like the same one.
  assert.equal(sameSubject(a, b), true)
  assert.equal(sameSubject(a, c), false)
  assert.equal(sameSubject(a, null), false)
})
