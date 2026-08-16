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
import { resolveClientId, redirectUri, IDENTITY_SCOPE } from '../clientMetadata.js'
import {
  normalizeLoginInput,
  redactLoginInput,
  LoginInputError,
  LOGIN_HINT,
  DEFAULT_ENTRYWAY,
  FORM_SERVICE,
} from '../loginInput.js'
import { identityTrace } from '../trace.js'

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
  trace = identityTrace,
} = {}) => {
  // Resolved lazily and memoized: BrowserOAuthClient.load() performs network
  // I/O (it fetches and validates our own metadata document), so it must not
  // run at module load or on boot for players who never sign in.
  let clientPromise = null

  const importClient = loadClient ?? (() => import('@atproto/oauth-client-browser'))

  const getClient = () => {
    if (!clientPromise) {
      clientPromise = (async () => {
        const clientId = resolveClientId(origin, base)
        // The single most useful line in the whole trace. Nearly every
        // mysterious atproto OAuth failure is one of these three values being
        // subtly wrong for the origin the player is actually on — a project
        // site built for '/', a redirect_uri missing its trailing slash, or
        // dev browsed at localhost when the redirect goes to 127.0.0.1. All
        // three look identical from the outside ("sign-in just doesn't work")
        // and all three are obvious the moment you can read them back.
        trace.event('atproto.client.load', {
          origin,
          base,
          clientId,
          redirectUri: redirectUri(origin, base),
        })
        const mod = await importClient()
        const { BrowserOAuthClient } = mod
        const client = await BrowserOAuthClient.load({
          clientId,
          handleResolver: HANDLE_RESOLVER,
        })
        trace.event('atproto.client.ready')
        return client
      })().catch((err) => {
        clientPromise = null   // let a later attempt retry rather than latch
        trace.error('atproto.client.failed', err, { origin, base })
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

    /**
     * The provider asks for a handle, so the shell knows to show one field.
     *
     * `hint` is here rather than in the panel because the panel deliberately
     * knows nothing about atproto — and the hint is doing real work: it is the
     * only thing standing between a player and typing the email address that
     * signs them into the Bluesky app. See src/identity/loginInput.js.
     */
    input: {
      name: 'handle',
      label: 'Your handle',
      placeholder: 'alice.bsky.social',
      hint: LOGIN_HINT,
    },

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
      trace.event('atproto.restore.start')
      try {
        const client = await getClient()
        const result = await client.initRestore()
        if (!result?.session) {
          trace.event('atproto.restore.none')
          return null
        }
        trace.event('atproto.restore.ok', { did: result.session.did })
        return await toIdentity(result.session)
      } catch (err) {
        trace.error('atproto.restore.failed', err)
        return null
      }
    },

    /**
     * Begin sign-in. This NAVIGATES AWAY to the user's PDS and never returns
     * — the promise does not resolve on the happy path. The caller must treat
     * a resolved value as failure and must persist anything it needs (such as
     * the return path) BEFORE calling.
     *
     * @param {string} handle a handle, a DID, or a server URL
     * @param {{ state?: string }} [opts] `state` round-trips to the callback
     */
    async signIn(handle, { state } = {}) {
      // Validate BEFORE loading the client. It is faster (no ~200KB download
      // and no metadata round-trip to tell someone they typed their email),
      // and it means the player gets an answer written for them instead of
      // `Failed to resolve identity: <their email>` from inside the library.
      let value, form
      try {
        ({ value, form } = normalizeLoginInput(handle))
      } catch (err) {
        trace.error('atproto.signIn.rejected', err, {
          input: redactLoginInput(handle),
          code: err.code,
        })
        throw err
      }

      trace.event('atproto.signIn.start', { form, value, scope: IDENTITY_SCOPE })

      const client = await getClient()
      try {
        await client.signInRedirect(value, { scope: IDENTITY_SCOPE, state })
      } catch (err) {
        trace.error('atproto.signIn.failed', err, { form, value })
        throw asPlayerFacingError(err, value, form)
      }
      // Unreachable in a browser; a resolved call means navigation was blocked.
      trace.error('atproto.signIn.noNavigation', new Error('redirect did not navigate'))
      throw new Error('Sign-in redirect did not navigate.')
    },

    /**
     * Complete the redirect. Only the callback page calls this: it reads the
     * OAuth parameters off the current URL and exchanges them for a session.
     *
     * @returns {Promise<{ identity: object, state: string|null }>}
     */
    async completeRedirect() {
      trace.event('atproto.callback.start')
      const client = await getClient()
      try {
        const { session, state } = await client.initCallback()
        trace.event('atproto.callback.ok', { did: session.did })
        return { identity: await toIdentity(session), state: state ?? null }
      } catch (err) {
        trace.error('atproto.callback.failed', err)
        throw err
      }
    },

    /**
     * Revoke the session at the authorization server and drop local keys.
     * Best-effort: if the server is unreachable we still want the local
     * session gone, so the shell can fall back to guest either way.
     */
    async signOut(identity) {
      const sub = identity?.subject
      if (!sub) return
      trace.event('atproto.signOut.start', { did: sub })
      try {
        const client = await getClient()
        await client.revoke(sub)
        trace.event('atproto.signOut.ok')
      } catch (err) {
        trace.error('atproto.signOut.failed', err, { note: 'session dropped locally' })
      }
    },
  }
}

/**
 * Turn a resolver failure into something a player can act on.
 *
 * The library's message for an unresolvable identifier is
 * `Failed to resolve identity: <input>` — accurate, and no help at all to
 * someone who has just mistyped their handle or whose custom domain is not
 * serving its `.well-known`. Everything else (metadata, PDS, token errors) is
 * passed through untouched: rewriting an error you do not recognise is how a
 * real diagnosis gets hidden. The original is kept as `cause`, and the trace
 * holds it verbatim either way.
 *
 * The one distinction worth making inside that message is offline vs. wrong,
 * because the library reports both the same way. Telling someone with no
 * network to check their spelling sends them to fix a handle that was right.
 *
 * @returns {Error}
 */
export const asPlayerFacingError = (err, value, form) => {
  if (err instanceof LoginInputError) return err
  if (!/failed to resolve identity/i.test(err?.message ?? '')) return err

  if (isNetworkFailure(err)) {
    return new Error(
      `Couldn't reach the network to look up ${value}. Check your connection and try again.`,
      { cause: err },
    )
  }

  const message = form === FORM_SERVICE
    ? `Couldn't reach ${value}. Check the address, or try ${DEFAULT_ENTRYWAY}.`
    : `We couldn't find ${value}. Check the spelling — a handle looks like ` +
      `name.bsky.social, and a custom domain has to be set as your handle in ` +
      `Bluesky first. You can also type ${DEFAULT_ENTRYWAY} and sign in there.`

  return new Error(message, { cause: err })
}

/**
 * Whether a failure is "the request never got there" rather than "the answer
 * was no". Walks the cause chain, because the interesting error is wrapped:
 * fetch rejects with a bare `TypeError: Failed to fetch` and every layer above
 * re-describes it in its own terms.
 * @returns {boolean}
 */
const isNetworkFailure = (err) => {
  for (let e = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.name === 'TypeError' && /fetch|network|load failed/i.test(e.message ?? '')) return true
    if (/^(ERR_|net::|ENOTFOUND|ECONNREFUSED|EAI_AGAIN)/.test(e.message ?? '')) return true
  }
  return false
}
