/**
 * src/identity/providers/atproto.js — sign in with an atproto handle
 *
 * A public OAuth client: no backend, no client secret, no server-side session.
 * That is what makes this deployable to GitHub Pages at all. See
 * src/identity/clientMetadata.js for how the client identifies itself.
 *
 * What the shell gets out of this is exactly one thing: the user's DID. Scope
 * is identity-only, so there is no repo access to misuse and nothing to leak.
 * Display name and avatar are fetched separately from the public appview,
 * unauthenticated, and are treated as cosmetic — a failed profile fetch
 * degrades to showing the handle, never to a failed sign-in.
 *
 * The OAuth library is loaded by DYNAMIC import, on purpose. It is a large
 * dependency, and a player who never signs in must never pay to download it.
 * It also means this whole module is inert in Node (tests) and on a build
 * where the dependency is missing — `available()` reports false rather than
 * throwing, and the shell just doesn't offer the button.
 *
 * Login UI is a single text field for a handle. There is no password field
 * here and there must never be one: the handle is resolved to a DID, then to
 * that user's PDS, and the user authenticates on their own server. This app
 * never sees a credential.
 */

import {
  makeIdentity,
  withDisplay,
  KIND_ATPROTO,
} from '../identity.js'
import { resolveClientId, IDENTITY_SCOPE } from '../clientMetadata.js'

/** Public appview — unauthenticated profile reads, no token required. */
export const APPVIEW_URL = 'https://public.api.bsky.app'

/** Handle resolution service used to turn a handle into a DID. */
export const HANDLE_RESOLVER = 'https://bsky.social'

/**
 * Fetch the cosmetic half of an identity. Never throws: display data is
 * decoration, and losing it must not cost the player their session.
 *
 * @returns {Promise<{handle: string|null, name: string|null, avatar: string|null}|null>}
 */
export const fetchPublicProfile = async (did, { fetchImpl = globalThis.fetch, appview = APPVIEW_URL } = {}) => {
  if (typeof fetchImpl !== 'function') return null
  try {
    const url = `${appview}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const body = await res.json()
    return {
      handle: body.handle ?? null,
      name: body.displayName ?? null,
      avatar: body.avatar ?? null,
    }
  } catch (_) {
    // Offline, blocked, rate-limited, or the account has no bsky profile
    // record at all (perfectly legal — atproto is not only bluesky).
    return null
  }
}

/**
 * @param {{
 *   origin?: string,
 *   base?: string,
 *   loadClient?: () => Promise<any>,
 *   fetchImpl?: typeof fetch,
 * }} [opts]
 */
export const createAtprotoProvider = ({
  origin = globalThis.location?.origin,
  base = '/',
  loadClient,
  fetchImpl = globalThis.fetch,
} = {}) => {
  // Resolved lazily and memoized: BrowserOAuthClient.load() performs network
  // I/O (it fetches and validates our own metadata document), so it must not
  // run at module load or on boot for players who never sign in.
  let clientPromise = null

  const importClient = loadClient ?? (() => import('@atproto/oauth-client-browser'))

  const getClient = () => {
    if (!clientPromise) {
      clientPromise = (async () => {
        const mod = await importClient()
        const { BrowserOAuthClient } = mod
        return BrowserOAuthClient.load({
          clientId: resolveClientId(origin, base),
          handleResolver: HANDLE_RESOLVER,
        })
      })().catch((err) => {
        clientPromise = null   // let a later attempt retry rather than latch
        throw err
      })
    }
    return clientPromise
  }

  /** OAuthSession → Identity, with a best-effort display block attached. */
  const toIdentity = async (session) => {
    const did = session.did
    const bare = makeIdentity({ subject: did, kind: KIND_ATPROTO })
    const display = await fetchPublicProfile(did, { fetchImpl })
    return display ? withDisplay(bare, display) : bare
  }

  return {
    id: 'atproto',
    label: 'Sign in with Bluesky',
    kind: KIND_ATPROTO,

    /** The provider asks for a handle, so the shell knows to show one field. */
    input: { name: 'handle', label: 'Handle or DID', placeholder: 'you.bsky.social' },

    /**
     * Environment check ONLY — deliberately does not import the OAuth
     * library. The shell calls this to decide whether to show a sign-in
     * button, which is a thing every player's first paint depends on; making
     * it load a large dependency would charge everyone for a feature most
     * never use. A missing dependency therefore surfaces as a failed sign-in
     * rather than a hidden button, which is the right trade: a broken build
     * should be loud, not invisible.
     */
    async available() {
      return typeof globalThis.window !== 'undefined' && Boolean(origin)
    },

    /**
     * Silent restore. The library keeps DPoP keys and the session in
     * IndexedDB and refreshes tokens on its own, so a returning player is
     * signed in without any interaction.
     *
     * `initRestore` is used rather than `init` so that this never accidentally
     * consumes OAuth callback parameters — the callback page owns that, and
     * doing it in two places would race.
     *
     * @returns {Promise<object|null>} Identity, or null if there is no session
     */
    async restore() {
      try {
        const client = await getClient()
        const result = await client.initRestore()
        if (!result?.session) return null
        return await toIdentity(result.session)
      } catch (err) {
        console.warn('[identity] atproto restore failed:', err)
        return null
      }
    },

    /**
     * Begin sign-in. This NAVIGATES AWAY to the user's PDS and never returns
     * — the promise does not resolve on the happy path. The caller must treat
     * a resolved value as failure and must persist anything it needs (such as
     * the return path) BEFORE calling.
     *
     * @param {string} handle
     * @param {{ state?: string }} [opts] `state` round-trips to the callback
     */
    async signIn(handle, { state } = {}) {
      const input = String(handle ?? '').trim().replace(/^@/, '')
      if (!input) throw new Error('Enter your handle to sign in.')
      const client = await getClient()
      await client.signInRedirect(input, { scope: IDENTITY_SCOPE, state })
      // Unreachable in a browser; a resolved call means navigation was blocked.
      throw new Error('Sign-in redirect did not navigate.')
    },

    /**
     * Complete the redirect. Only the callback page calls this: it reads the
     * OAuth parameters off the current URL and exchanges them for a session.
     *
     * @returns {Promise<{ identity: object, state: string|null }>}
     */
    async completeRedirect() {
      const client = await getClient()
      const { session, state } = await client.initCallback()
      return { identity: await toIdentity(session), state: state ?? null }
    },

    /**
     * Revoke the session at the authorization server and drop local keys.
     * Best-effort: if the server is unreachable we still want the local
     * session gone, so the shell can fall back to guest either way.
     */
    async signOut(identity) {
      const sub = identity?.subject
      if (!sub) return
      try {
        const client = await getClient()
        await client.revoke(sub)
      } catch (err) {
        console.warn('[identity] atproto revoke failed (session dropped locally):', err)
      }
    },
  }
}
