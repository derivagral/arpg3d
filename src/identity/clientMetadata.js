/**
 * src/identity/clientMetadata.js — atproto OAuth client identification
 *
 * atproto OAuth has no client registration step. Your `client_id` IS a URL,
 * and the authorization server fetches it to learn who you are. That makes
 * client identity origin+path-bound, which has three consequences this module
 * exists to handle:
 *
 *   1. The metadata must be generated from the deploy's base URL, not
 *      hardcoded. Production, a GitHub Pages project subpath, a preview
 *      branch and localhost are four different clients.
 *
 *   2. `redirect_uris` must be exact and must have a real file behind them.
 *      On GitHub Pages there is no SPA rewrite, so a client-side route would
 *      404. `oauth/callback/index.html` is therefore a real directory with a
 *      real file, registered as a second Vite entry point — not a router path.
 *
 *   3. Local development cannot serve an https client_id, so the spec carves
 *      out a loopback form: the literal `http://localhost` with the metadata
 *      passed as query parameters. Note the asymmetry — the client_id host
 *      must be `localhost`, but the redirect_uri host must be `127.0.0.1` or
 *      `[::1]`. Browsing dev at http://localhost:5173 will therefore complete
 *      the redirect on a DIFFERENT origin than it started on, and the session
 *      (IndexedDB) will appear to vanish. Dev must be browsed at 127.0.0.1.
 *
 * Scope is `atproto` and only `atproto`: that is the identity-only scope. It
 * yields the DID and nothing else — no repo read, no write, and no scary
 * consent screen. Display name and avatar come from the public appview,
 * unauthenticated. Widening this later (e.g. to write scores into the user's
 * PDS) requires revoke + re-auth for every existing user, so it is a decision
 * to make deliberately, not to drift into.
 *
 * Pure module: no network, no globals. The Vite plugin uses it at build time
 * and the provider uses it at runtime, so the two can never disagree.
 */

export const CLIENT_NAME = 'ARPG3D'
export const IDENTITY_SCOPE = 'atproto'
export const METADATA_FILENAME = 'client-metadata.json'

/** Path segment of the OAuth callback, relative to the site base. */
export const CALLBACK_SEGMENT = 'oauth/callback/'

/**
 * Normalize a Vite `base` to exactly one leading and one trailing slash, so
 * that joining is unambiguous ('' and '/' and '/repo' all behave).
 * @returns {string}
 */
export const normalizeBase = (base) => {
  const trimmed = String(base ?? '/').trim()
  if (trimmed === '' || trimmed === '/') return '/'
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}/`
}

/** Absolute site root for this deploy, e.g. https://user.github.io/arpg3d/ */
export const siteUri = (origin, base) => `${String(origin).replace(/\/+$/, '')}${normalizeBase(base)}`

/** Absolute redirect URI. Trailing slash matters — it must match byte-for-byte. */
export const redirectUri = (origin, base) => `${siteUri(origin, base)}${CALLBACK_SEGMENT}`

/** Absolute URL of the metadata document, which doubles as the client_id. */
export const metadataUrl = (origin, base) => `${siteUri(origin, base)}${METADATA_FILENAME}`

/**
 * True when this origin can host a real https client_id. Loopback origins
 * cannot, and must use the query-parameter form instead.
 * @returns {boolean}
 */
export const isLoopback = (origin) => {
  let host
  try {
    ({ hostname: host } = new URL(origin))
  } catch (_) {
    return false
  }
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

/**
 * The client_id for this deploy.
 *
 * Loopback gets the spec's development form. Everything else gets the URL of
 * the generated metadata document.
 * @returns {string}
 */
export const resolveClientId = (origin, base) => {
  if (!isLoopback(origin)) return metadataUrl(origin, base)
  const params = new URLSearchParams({
    redirect_uri: redirectUri(origin, base),
    scope: IDENTITY_SCOPE,
  })
  return `http://localhost?${params.toString()}`
}

/**
 * The full client metadata document. Emitted as a static JSON file at build
 * time; the authorization server fetches it directly.
 *
 * `token_endpoint_auth_method: 'none'` + `dpop_bound_access_tokens: true` is
 * what makes this a public client: there is no secret to leak, and tokens are
 * bound to a key the browser holds and never transmits.
 *
 * @returns {object} JSON-serializable client metadata
 */
export const buildClientMetadata = (origin, base, { clientName = CLIENT_NAME } = {}) => ({
  client_id: metadataUrl(origin, base),
  client_name: clientName,
  client_uri: siteUri(origin, base),
  redirect_uris: [redirectUri(origin, base)],
  scope: IDENTITY_SCOPE,
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  application_type: 'web',
  token_endpoint_auth_method: 'none',
  dpop_bound_access_tokens: true,
})
