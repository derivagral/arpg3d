import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeLoginInput,
  redactLoginInput,
  LoginInputError,
  FORM_HANDLE,
  FORM_DID,
  FORM_SERVICE,
} from './loginInput.js'

/** Assert a rejection and hand back the error, so tests can read `code`. */
const rejected = (input) => {
  try {
    normalizeLoginInput(input)
  } catch (err) {
    assert.ok(err instanceof LoginInputError, `expected LoginInputError, got ${err}`)
    return err
  }
  assert.fail(`expected ${JSON.stringify(input)} to be rejected`)
}

test('handles are accepted and normalized', () => {
  for (const [input, expected] of [
    ['alice.bsky.social', 'alice.bsky.social'],
    ['  alice.bsky.social  ', 'alice.bsky.social'],
    ['@alice.bsky.social', 'alice.bsky.social'],
    ['Alice.BSky.Social', 'alice.bsky.social'],
    ['alice.bsky.social.', 'alice.bsky.social'],
    ['my-site.com', 'my-site.com'],
    ['4chan.org', '4chan.org'],
  ]) {
    assert.deepEqual(normalizeLoginInput(input), { value: expected, form: FORM_HANDLE })
  }
})

test('DIDs are accepted and keep their case', () => {
  assert.deepEqual(
    normalizeLoginInput('did:plc:abcDEF123'),
    { value: 'did:plc:abcDEF123', form: FORM_DID },
  )
  // did:web identifiers are host names that may be mixed case in the wild;
  // lowercasing a DID would change which account it points at.
  assert.deepEqual(
    normalizeLoginInput('  did:web:Example.COM  '),
    { value: 'did:web:Example.COM', form: FORM_DID },
  )
})

test('a server URL is accepted as the no-handle escape hatch', () => {
  for (const [input, expected] of [
    ['https://bsky.social', 'https://bsky.social'],
    ['https://bsky.social/', 'https://bsky.social'],
    ['HTTPS://bsky.social', 'https://bsky.social'],
    ['https://pds.example.com/sub/', 'https://pds.example.com/sub'],
  ]) {
    assert.deepEqual(normalizeLoginInput(input), { value: expected, form: FORM_SERVICE })
  }
})

test('an email is rejected with an answer, not a resolver failure', () => {
  const err = rejected('faeries-address0c@icloud.com')
  assert.equal(err.code, 'email')
  // The whole point: the player is told what to type instead, and where to
  // find it. A message that only says "invalid" leaves them exactly as stuck.
  assert.match(err.message, /handle/i)
  assert.match(err.message, /alice\.bsky\.social/)
  assert.match(err.message, /bsky\.social/)
  // And their address is not echoed back onto the screen.
  assert.doesNotMatch(err.message, /faeries-address0c/)
})

test('an email is diagnosed as an email, not as bad characters', () => {
  // '@' fails the character rule too, so ordering inside normalize matters:
  // "handles are letters, numbers, dots and dashes" would be a true and
  // useless answer to someone who typed the thing the Bluesky app wants.
  assert.equal(rejected('someone@example.org').code, 'email')
  assert.equal(rejected('  Someone@Example.org ').code, 'email')
})

test('a bare name is told what is missing', () => {
  const err = rejected('alice')
  assert.equal(err.code, 'no-domain')
  assert.match(err.message, /alice\.bsky\.social/)
})

test('empty input is rejected before anything is loaded', () => {
  assert.equal(rejected('').code, 'empty')
  assert.equal(rejected('   ').code, 'empty')
  assert.equal(rejected(null).code, 'empty')
  assert.equal(rejected(undefined).code, 'empty')
})

test('malformed handles are rejected with a specific reason', () => {
  assert.equal(rejected('alice bsky social').code, 'bad-characters')
  assert.equal(rejected('alice_bsky.social').code, 'bad-characters')
  assert.equal(rejected('alice..social').code, 'empty-label')
  assert.equal(rejected('-alice.social').code, 'label-hyphen')
  assert.equal(rejected('alice-.social').code, 'label-hyphen')
  assert.equal(rejected(`${'a'.repeat(64)}.social`).code, 'label-too-long')
  assert.equal(rejected(`${'a.'.repeat(140)}social`).code, 'too-long')
  // An IP address is a plausible thing to paste and is never a handle.
  assert.equal(rejected('127.0.0.1').code, 'numeric-tld')
})

test('malformed server URLs are rejected', () => {
  assert.equal(rejected('https://').code, 'bad-url')
  assert.equal(rejected('http://alice:pw@example.com').code, 'url-credentials')
})

test('the trace redacts an email but not a public identifier', () => {
  // Handles, DIDs and server URLs are public and are the whole value of a
  // trace; an email is neither public nor needed to debug this.
  assert.equal(redactLoginInput('alice.bsky.social'), 'alice.bsky.social')
  assert.equal(redactLoginInput('@alice.bsky.social'), 'alice.bsky.social')
  assert.equal(redactLoginInput('did:plc:abc123'), 'did:plc:abc123')
  assert.equal(redactLoginInput('https://bsky.social'), 'https://bsky.social')

  assert.equal(redactLoginInput('faeries-address0c@icloud.com'), 'f****************@icloud.com')
  assert.equal(redactLoginInput('a@b.com'), 'a*@b.com')
  assert.equal(redactLoginInput(''), '(empty)')
})
