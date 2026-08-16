import test from 'node:test'
import assert from 'node:assert/strict'

import { createAtprotoProvider, asPlayerFacingError } from './atproto.js'
import { createIdentityTrace } from '../trace.js'
import { LoginInputError, FORM_SERVICE } from '../loginInput.js'
import { mockStorage } from '../../testing/mockStorage.js'

const ORIGIN = 'http://127.0.0.1:5173'

/** A trace wired to memory, so tests can read back what the flow recorded. */
const testTrace = () => createIdentityTrace({
  storage: mockStorage(),
  flagStorage: mockStorage(),
  sink: { debug() {}, warn() {} },
  location: { pathname: '/', search: '' },
})

/**
 * A provider over a fake OAuth client. `signInRedirect` records its argument
 * instead of navigating, which is the one thing a Node test can observe about
 * a flow whose success condition is "the browser left".
 */
const makeProvider = ({ signInRedirect = async () => {}, trace = testTrace() } = {}) => {
  const calls = []
  const provider = createAtprotoProvider({
    origin: ORIGIN,
    base: '/',
    trace,
    loadClient: async () => ({
      BrowserOAuthClient: {
        load: async (opts) => {
          calls.push({ kind: 'load', ...opts })
          return {
            signInRedirect: async (input, options) => {
              calls.push({ kind: 'signInRedirect', input, options })
              return signInRedirect(input, options)
            },
          }
        },
      },
    }),
  })
  return { provider, calls, trace }
}

test('an email never reaches the OAuth client', async () => {
  // The bug this file is really about. Loading the client to be told you
  // typed your email costs a ~200KB download and a metadata round-trip, and
  // then answers with the library's `Failed to resolve identity: <email>`.
  const { provider, calls } = makeProvider()

  await assert.rejects(
    () => provider.signIn('faeries-address0c@icloud.com'),
    (err) => {
      assert.ok(err instanceof LoginInputError)
      assert.equal(err.code, 'email')
      assert.match(err.message, /handle/i)
      return true
    },
  )
  assert.deepEqual(calls, [], 'no client load, no network, for a local mistake')
})

test('a rejected email is traced without recording the address', async () => {
  const { provider, trace } = makeProvider()
  await assert.rejects(() => provider.signIn('faeries-address0c@icloud.com'))

  const report = trace.report()
  assert.match(report, /atproto\.signIn\.rejected/)
  assert.match(report, /code=email/)
  assert.match(report, /f\*+@icloud\.com/, 'the local part is masked')
  assert.doesNotMatch(report, /faeries-address0c/)
})

test('a handle is normalized before it is handed to the client', async () => {
  const { provider, calls } = makeProvider()
  await assert.rejects(() => provider.signIn(' @Alice.BSky.Social '))   // no navigation in Node

  const redirect = calls.find(c => c.kind === 'signInRedirect')
  assert.equal(redirect.input, 'alice.bsky.social')
  assert.equal(redirect.options.scope, 'atproto')
})

test('a server URL is passed through as the no-handle escape hatch', async () => {
  const { provider, calls } = makeProvider()
  await assert.rejects(() => provider.signIn('https://bsky.social/'))

  assert.equal(calls.find(c => c.kind === 'signInRedirect').input, 'https://bsky.social')
})

test('the client_id and redirect_uri are on the record before anything can fail', async () => {
  // Nearly every unexplained atproto sign-in failure is one of these two
  // being wrong for the origin in use, and neither is visible anywhere else.
  const { provider, trace } = makeProvider()
  await assert.rejects(() => provider.signIn('alice.bsky.social'))

  const load = trace.entries().find(e => e.name === 'atproto.client.load')
  assert.equal(load.origin, ORIGIN)
  assert.equal(load.redirectUri, `${ORIGIN}/oauth/callback/`)
  // Loopback dev uses the spec's query-parameter client_id form, and its host
  // is `localhost` even though the redirect must be 127.0.0.1.
  assert.match(load.clientId, /^http:\/\/localhost\?/)
  assert.match(load.clientId, /redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A5173/)
})

test('a resolved signIn is a failure, because the browser should have left', async () => {
  const { provider, trace } = makeProvider()
  await assert.rejects(() => provider.signIn('alice.bsky.social'), /did not navigate/)
  assert.match(trace.report(), /atproto\.signIn\.noNavigation/)
})

test('a resolver failure becomes an answer, and keeps the original as cause', () => {
  const original = new Error('Failed to resolve identity: alyce.bsky.social')
  const shown = asPlayerFacingError(original, 'alyce.bsky.social', 'handle')

  assert.notEqual(shown, original)
  assert.match(shown.message, /couldn't find alyce\.bsky\.social/i)
  assert.match(shown.message, /spelling/i)
  assert.equal(shown.cause, original, 'the real error is never thrown away')
})

test('offline is not reported as a typo', () => {
  // The library reports "can't reach the resolver" and "no such handle" with
  // the same message. Telling someone with no network to check their spelling
  // sends them off to fix a handle that was correct.
  for (const cause of [
    new TypeError('Failed to fetch'),
    new TypeError('NetworkError when attempting to fetch resource.'),
    new TypeError('Load failed'),                       // Safari's wording
    new Error('ECONNREFUSED 127.0.0.1:443'),
  ]) {
    const shown = asPlayerFacingError(
      new Error('Failed to resolve identity: alice.bsky.social', { cause }),
      'alice.bsky.social',
      'handle',
    )
    assert.match(shown.message, /connection/i, `for ${cause.message}`)
    assert.doesNotMatch(shown.message, /spelling/i, `for ${cause.message}`)
  }
})

test('a genuine lookup miss still reads as a lookup miss', () => {
  const shown = asPlayerFacingError(
    new Error('Failed to resolve identity: nope.bsky.social', {
      cause: new Error('Unable to resolve handle'),
    }),
    'nope.bsky.social',
    'handle',
  )
  assert.match(shown.message, /spelling/i)
  assert.doesNotMatch(shown.message, /connection/i)
})

test('a resolver failure on a server URL says so in server terms', () => {
  const shown = asPlayerFacingError(
    new Error('Failed to resolve identity: https://pds.example.com'),
    'https://pds.example.com',
    FORM_SERVICE,
  )
  assert.match(shown.message, /couldn't reach https:\/\/pds\.example\.com/i)
})

test('errors that are not resolution failures are passed through untouched', () => {
  // Rewriting an error you do not recognise is how a real diagnosis gets
  // hidden — a network or metadata failure must keep its own words.
  const network = new TypeError('Failed to fetch')
  assert.equal(asPlayerFacingError(network, 'alice.bsky.social', 'handle'), network)

  const input = new LoginInputError('type your handle', 'empty')
  assert.equal(asPlayerFacingError(input, '', 'handle'), input)
})

test('restore degrades to guest and records why', async () => {
  const trace = testTrace()
  const provider = createAtprotoProvider({
    origin: ORIGIN,
    base: '/',
    trace,
    loadClient: async () => { throw new Error('chunk load failed') },
  })

  assert.equal(await provider.restore(), null, 'a broken restore is never fatal')
  const report = trace.report()
  assert.match(report, /atproto\.client\.failed/)
  assert.match(report, /chunk load failed/)
})

test('available() reports the environment without loading the library', async () => {
  let loaded = false
  const provider = createAtprotoProvider({
    origin: ORIGIN,
    base: '/',
    trace: testTrace(),
    loadClient: async () => { loaded = true; return {} },
  })

  await provider.available()
  assert.equal(loaded, false, 'first paint must not pay for a feature most never use')
})

test('the sign-in field is labelled for a handle and warns off the email', () => {
  const { provider } = makeProvider()
  assert.equal(provider.input.name, 'handle')
  assert.match(provider.input.placeholder, /bsky\.social/)
  assert.match(provider.input.hint, /email/i)
})
