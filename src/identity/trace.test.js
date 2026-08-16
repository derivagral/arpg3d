import test from 'node:test'
import assert from 'node:assert/strict'

import { createIdentityTrace, TRACE_KEY, DEBUG_FLAG_KEY } from './trace.js'
import { mockStorage } from '../testing/mockStorage.js'

const silentSink = () => {
  const calls = { debug: [], warn: [] }
  return {
    calls,
    debug: (...args) => calls.debug.push(args),
    warn: (...args) => calls.warn.push(args),
  }
}

/** A trace wired to memory, with the clock pinned so entries are comparable. */
const makeTrace = (over = {}) => {
  const storage = over.storage ?? mockStorage()
  const flagStorage = over.flagStorage ?? mockStorage()
  const sink = over.sink ?? silentSink()
  let tick = 0
  return {
    storage,
    flagStorage,
    sink,
    trace: createIdentityTrace({
      storage,
      flagStorage,
      sink,
      now: () => 1700000000000 + (tick++ * 1000),
      location: over.location ?? { pathname: '/', search: '' },
      limit: over.limit ?? 60,
    }),
  }
}

test('events are recorded in order with page and timestamp', () => {
  const { trace } = makeTrace()
  trace.event('a.start', { origin: 'http://127.0.0.1:5173' })
  trace.event('a.done')

  const entries = trace.entries()
  assert.equal(entries.length, 2)
  assert.equal(entries[0].name, 'a.start')
  assert.equal(entries[0].origin, 'http://127.0.0.1:5173')
  assert.equal(entries[0].page, '/')
  assert.ok(Date.parse(entries[0].at) > 0)
  assert.equal(entries[1].name, 'a.done')
})

test('the trace survives a new trace over the same storage', () => {
  // This is the property the whole module exists for: the sign-in flow spans
  // separate documents (app → PDS → callback), each of which constructs its
  // own trace over the same sessionStorage. Nothing may be lost at a
  // navigation, because the cause of a callback failure is on the first page.
  const storage = mockStorage()
  const first = makeTrace({ storage, location: { pathname: '/', search: '' } })
  first.trace.event('atproto.signIn.start', { value: 'alice.bsky.social' })

  const second = makeTrace({ storage, location: { pathname: '/oauth/callback/', search: '' } })
  second.trace.event('atproto.callback.start')

  const entries = second.trace.entries()
  assert.deepEqual(entries.map(e => e.name), ['atproto.signIn.start', 'atproto.callback.start'])
  assert.deepEqual(entries.map(e => e.page), ['/', '/oauth/callback/'])
})

test('the buffer is bounded and keeps the newest entries', () => {
  const { trace } = makeTrace({ limit: 3 })
  for (const n of [1, 2, 3, 4, 5]) trace.event(`e${n}`)
  assert.deepEqual(trace.entries().map(e => e.name), ['e3', 'e4', 'e5'])
})

test('errors are always mirrored to the console, events are not', () => {
  const { trace, sink } = makeTrace()
  trace.event('quiet.step')
  assert.equal(sink.calls.debug.length, 0, 'events stay silent without the flag')

  trace.error('loud.step', new Error('boom'))
  assert.equal(sink.calls.warn.length, 1, 'a failure is never silent')
})

test('errors record name, message and one level of cause', () => {
  const { trace } = makeTrace()
  // The OAuth library wraps the real failure: `Failed to resolve identity: x`
  // caused by the DNS or HTTP error that actually explains it.
  const cause = new TypeError('fetch failed')
  trace.error('resolve.failed', new Error('Failed to resolve identity: alice.test', { cause }))

  const [entry] = trace.entries()
  assert.equal(entry.error.name, 'Error')
  assert.match(entry.error.message, /Failed to resolve identity/)
  assert.equal(entry.error.cause.name, 'TypeError')
  assert.equal(entry.error.cause.message, 'fetch failed')
})

test('console mirroring is off by default and sticky once enabled', () => {
  const flagStorage = mockStorage()
  const off = makeTrace({ flagStorage })
  assert.equal(off.trace.mirroring(), false)

  off.trace.setMirroring(true)
  assert.equal(flagStorage.getItem(DEBUG_FLAG_KEY), '1')

  // A later page load — a fresh trace — still mirrors, which is what makes
  // ?identityDebug=1 usable across a redirect it cannot survive as a query.
  const later = makeTrace({ flagStorage })
  assert.equal(later.trace.mirroring(), true)
  later.trace.event('mirrored')
  assert.equal(later.sink.calls.debug.length, 1)

  later.trace.setMirroring(false)
  assert.equal(flagStorage.getItem(DEBUG_FLAG_KEY), null)
})

test('?identityDebug toggles mirroring and persists the choice', () => {
  const flagStorage = mockStorage()
  const on = makeTrace({ flagStorage, location: { pathname: '/', search: '?identityDebug=1' } })
  assert.equal(on.trace.mirroring(), true)
  assert.equal(flagStorage.getItem(DEBUG_FLAG_KEY), '1')

  const off = makeTrace({ flagStorage, location: { pathname: '/', search: '?identityDebug=0' } })
  assert.equal(off.trace.mirroring(), false)
  assert.equal(flagStorage.getItem(DEBUG_FLAG_KEY), null)
})

test('report() is pasteable text covering every entry', () => {
  const { trace } = makeTrace()
  trace.event('atproto.client.load', { clientId: 'http://localhost?redirect_uri=x' })
  trace.error('atproto.signIn.failed', new Error('nope'))

  const report = trace.report()
  assert.match(report, /atproto\.client\.load/)
  assert.match(report, /clientId=http:\/\/localhost/)
  assert.match(report, /!! Error: nope/)
})

test('report() shows the cause, which is usually the real answer', () => {
  const { trace } = makeTrace()
  trace.error('atproto.signIn.failed', new Error('Failed to resolve identity: alice.test', {
    cause: new TypeError('Failed to fetch'),
  }))

  assert.match(trace.report(), /caused by TypeError: Failed to fetch/)
})

test('report() and entries() are safe on an empty or corrupt buffer', () => {
  const { trace, storage } = makeTrace()
  assert.deepEqual(trace.entries(), [])
  assert.match(trace.report(), /empty/)

  storage.setItem(TRACE_KEY, 'not json{')
  assert.deepEqual(trace.entries(), [], 'a corrupt buffer must not break sign-in')
  trace.event('still.works')
  assert.deepEqual(trace.entries().map(e => e.name), ['still.works'])
})

test('clear() empties the buffer', () => {
  const { trace } = makeTrace()
  trace.event('a')
  trace.clear()
  assert.deepEqual(trace.entries(), [])
})

test('tracing never throws when storage is unavailable', () => {
  // Private-mode Safari and a full quota both throw from setItem. Losing the
  // trace is acceptable; losing sign-in because of the trace is not.
  const hostile = {
    getItem() { throw new Error('denied') },
    setItem() { throw new Error('denied') },
    removeItem() { throw new Error('denied') },
  }
  const { trace } = makeTrace({ storage: hostile, flagStorage: hostile })
  assert.doesNotThrow(() => trace.event('a'))
  assert.doesNotThrow(() => trace.error('b', new Error('x')))
  assert.doesNotThrow(() => trace.clear())
  assert.deepEqual(trace.entries(), [])
})

test('install() exposes the trace on a target object', () => {
  const { trace } = makeTrace()
  const target = {}
  trace.event('hello')
  trace.install(target)

  assert.deepEqual(target.__identity.trace().map(e => e.name), ['hello'])
  assert.match(target.__identity.report(), /hello/)
  target.__identity.clear()
  assert.deepEqual(target.__identity.trace(), [])
})
