/**
 * src/identity/clientMetadata.test.js — the atproto client_id rules
 *
 * These are the details that fail sign-in outright rather than degrading, so
 * they are worth pinning down: exact redirect URIs, the loopback carve-out,
 * and identity-only scope.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeBase,
  siteUri,
  redirectUri,
  metadataUrl,
  isLoopback,
  resolveClientId,
  buildClientMetadata,
  IDENTITY_SCOPE,
} from './clientMetadata.js'

test('normalizeBase collapses every spelling to one form', () => {
  assert.equal(normalizeBase(undefined), '/')
  assert.equal(normalizeBase(''), '/')
  assert.equal(normalizeBase('/'), '/')
  assert.equal(normalizeBase('arpg3d'), '/arpg3d/')
  assert.equal(normalizeBase('/arpg3d'), '/arpg3d/')
  assert.equal(normalizeBase('arpg3d/'), '/arpg3d/')
  assert.equal(normalizeBase('/arpg3d/'), '/arpg3d/')
})

test('URLs are built for a GitHub Pages project subpath', () => {
  const origin = 'https://derivagral.github.io'
  const base = '/arpg3d/'

  assert.equal(siteUri(origin, base), 'https://derivagral.github.io/arpg3d/')
  assert.equal(metadataUrl(origin, base), 'https://derivagral.github.io/arpg3d/client-metadata.json')
  assert.equal(redirectUri(origin, base), 'https://derivagral.github.io/arpg3d/oauth/callback/')
})

test('the redirect URI keeps its trailing slash', () => {
  // It must match the registered value byte-for-byte, and the callback is a
  // directory index — dropping the slash silently breaks the exchange.
  assert.ok(redirectUri('https://x.dev', '/').endsWith('/oauth/callback/'))
  assert.ok(redirectUri('https://x.dev', '/sub/').endsWith('/sub/oauth/callback/'))
})

test('loopback origins are recognized, real ones are not', () => {
  assert.equal(isLoopback('http://localhost:5173'), true)
  assert.equal(isLoopback('http://127.0.0.1:5173'), true)
  assert.equal(isLoopback('http://[::1]:5173'), true)
  assert.equal(isLoopback('https://derivagral.github.io'), false)
  assert.equal(isLoopback('not a url'), false)
})

test('a deployed client_id is the URL of its own metadata document', () => {
  assert.equal(
    resolveClientId('https://derivagral.github.io', '/arpg3d/'),
    'https://derivagral.github.io/arpg3d/client-metadata.json'
  )
})

test('a loopback client_id uses the development query-parameter form', () => {
  const clientId = resolveClientId('http://127.0.0.1:5173', '/')

  // The client_id host must be literally `localhost` even when the site is
  // being served from 127.0.0.1 — the two are not interchangeable here.
  assert.ok(clientId.startsWith('http://localhost?'))

  const params = new URL(clientId).searchParams
  assert.equal(params.get('scope'), IDENTITY_SCOPE)
  assert.equal(params.get('redirect_uri'), 'http://127.0.0.1:5173/oauth/callback/')
})

test('metadata declares a public, DPoP-bound, identity-only client', () => {
  const meta = buildClientMetadata('https://derivagral.github.io', '/arpg3d/')

  // No secret to leak, and tokens bound to a key the browser never transmits.
  assert.equal(meta.token_endpoint_auth_method, 'none')
  assert.equal(meta.dpop_bound_access_tokens, true)

  // Identity-only: 'atproto' alone, with no transition:generic. Widening this
  // later forces revoke + re-auth for every existing user.
  assert.equal(meta.scope, 'atproto')
  assert.ok(!meta.scope.includes('transition'))

  assert.deepEqual(meta.response_types, ['code'])
  assert.deepEqual(meta.redirect_uris, ['https://derivagral.github.io/arpg3d/oauth/callback/'])

  // client_id must be the document's own URL, or the server cannot verify it.
  assert.equal(meta.client_id, metadataUrl('https://derivagral.github.io', '/arpg3d/'))
})

test('metadata is JSON-serializable as emitted', () => {
  const meta = buildClientMetadata('https://x.dev', '/')
  assert.deepEqual(JSON.parse(JSON.stringify(meta)), meta)
})
