/**
 * src/identity/manager.js — the shell's identity state machine
 *
 * Owns "who is playing right now" and the transitions between identities.
 * Everything above it (menu, chip, save store) reads a resolved Identity;
 * everything below it (providers) knows about exactly one auth method.
 *
 * The invariant that makes the rest of the codebase simple: resolve() ALWAYS
 * returns an Identity. Sign-in failure, an expired session, a blocked popup,
 * no network — every path falls back to the guest identity rather than to
 * null. No caller ever writes `if (identity)`.
 *
 * ── The provider interface ──────────────────────────────────────────────────
 * Adding an auth method (OIDC, passkey, an itch.io token, whatever) means
 * writing one object and registering it. Nothing else in the codebase changes.
 *
 *   id        string                       stable key, persisted
 *   label     string                       button text
 *   kind      string                       lands in Identity.kind
 *   input     { name, label, placeholder } | undefined — one field, if needed
 *   available()            → Promise<boolean>   can it run here at all
 *   restore()              → Promise<Identity|null>   silent, no interaction
 *   signIn(input, { state })  → Promise<Identity> | never returns (redirect)
 *   signOut(identity)      → Promise<void>
 *   completeRedirect()     → Promise<{ identity, state }>   redirect flows only
 *
 * Providers that finish in-page (a passkey, say) simply return an Identity
 * from signIn() and never implement completeRedirect(). The manager handles
 * both shapes, which is why signIn() is allowed to either resolve or navigate.
 */

import { makeIdentity, isAnon, IDENTITY_NS } from './identity.js'
import { identityTrace } from './trace.js'

export const SESSION_KEY = `${IDENTITY_NS}:session`
export const RETURN_KEY = `${IDENTITY_NS}:return`

/**
 * @param {{
 *   providers: object[],       // anon provider MUST be among them
 *   storage?: Storage,
 *   trace?: object,            // see src/identity/trace.js
 * }} opts
 */
export const createIdentityManager = ({
  providers,
  storage = globalThis.localStorage,
  trace = identityTrace,
}) => {
  const byId = new Map(providers.map(p => [p.id, p]))
  const anon = providers.find(p => p.id === 'anon')
  if (!anon) throw new Error('identity: an "anon" provider is required — guest is the fallback floor')

  let current = null
  const listeners = new Set()

  const readKey = (key) => {
    try { return storage?.getItem(key) ?? null } catch (_) { return null }
  }
  const writeKey = (key, value) => {
    try {
      if (value === null) storage?.removeItem(key)
      else storage?.setItem(key, value)
    } catch (_) { /* storage unavailable; session simply won't survive reload */ }
  }

  const emit = () => {
    for (const fn of listeners) {
      try { fn(current) } catch (err) { console.warn('[identity] listener threw:', err) }
    }
  }

  const set = (identity) => {
    current = identity
    emit()
    return identity
  }

  /** Remember which provider owns the live session, so boot can restore it. */
  const rememberProvider = (id) => writeKey(SESSION_KEY, id === 'anon' ? null : id)

  return {
    /** Providers that can actually run here, in registration order. */
    async availableProviders() {
      const checked = await Promise.all(
        providers.map(async p => (await safeAvailable(p)) ? p : null)
      )
      return checked
        .filter(Boolean)
        .map(({ id, label, kind, input }) => ({ id, label, kind, input: input ?? null }))
    },

    /** @returns {object|null} the live Identity, or null before resolve() */
    current: () => current,

    /** The guest subject, if one has ever been minted. Used by the claim offer. */
    anonSubject: () => anon.peek?.() ?? null,

    /**
     * Boot path: silently restore the last session, or mint/return the guest.
     * Never throws, never returns null.
     * @returns {Promise<object>} Identity
     */
    async resolve() {
      const lastId = readKey(SESSION_KEY)
      const provider = lastId ? byId.get(lastId) : null
      trace.event('manager.resolve.start', { lastId: lastId ?? 'none' })

      if (provider && !isAnonProvider(provider) && await safeAvailable(provider)) {
        try {
          const identity = await provider.restore()
          if (identity) {
            trace.event('manager.resolve.restored', { provider: provider.id })
            return set(identity)
          }
          // Not an error, and the single most confusing outcome on this path:
          // the player believes they are signed in, the shell shows "guest",
          // and nothing anywhere says why. Now it is on the record.
          trace.event('manager.resolve.sessionGone', { provider: provider.id })
        } catch (err) {
          trace.error('manager.resolve.failed', err, { provider: provider.id })
        }
        // The stored session is gone or unusable — stop trying on every boot.
        rememberProvider('anon')
      }

      const guest = set(await anon.restore())
      trace.event('manager.resolve.guest')
      return guest
    },

    /**
     * Start sign-in with a provider.
     *
     * For redirect providers this navigates away and never resolves; the
     * return path is persisted first so the callback can come back to where
     * the player was. For in-page providers it resolves with the Identity.
     *
     * @param {string} providerId
     * @param {string} [input] e.g. the handle
     * @param {{ returnTo?: string }} [opts]
     * @returns {Promise<object>} Identity (redirect providers never resolve)
     */
    async signIn(providerId, input, { returnTo } = {}) {
      const provider = byId.get(providerId)
      if (!provider) throw new Error(`identity: unknown provider '${providerId}'`)

      // Persisted BEFORE the call: a redirect provider will not come back
      // here, so anything written after signIn() would never run.
      const returnPath = returnTo ?? currentPath()
      writeKey(RETURN_KEY, returnPath)
      rememberProvider(providerId)
      trace.event('manager.signIn.start', { provider: providerId, returnTo: returnPath })

      try {
        const identity = await provider.signIn(input, { state: providerId })
        trace.event('manager.signIn.inPage', { provider: providerId })
        return set(identity)
      } catch (err) {
        trace.error('manager.signIn.failed', err, { provider: providerId })
        rememberProvider('anon')
        writeKey(RETURN_KEY, null)
        throw err
      }
    },

    /**
     * Finish a redirect flow. Called only by the OAuth callback page.
     * @returns {Promise<{ identity: object, returnTo: string }>}
     */
    async completeRedirect(providerId = readKey(SESSION_KEY)) {
      const provider = providerId ? byId.get(providerId) : null
      trace.event('manager.completeRedirect.start', { provider: providerId ?? 'none' })
      if (!provider?.completeRedirect) {
        // Almost always means the callback page cannot see the localStorage
        // the sign-in was started from — i.e. it is running on a different
        // origin. That is the localhost/127.0.0.1 trap, and it is worth
        // saying so rather than making someone deduce it from a bare message.
        const err = new Error('identity: no redirect in progress')
        trace.error('manager.completeRedirect.noProvider', err, {
          provider: providerId ?? 'none',
          origin: globalThis.location?.origin ?? '?',
        })
        throw err
      }
      const { identity } = await provider.completeRedirect()
      rememberProvider(provider.id)
      const returnTo = readKey(RETURN_KEY) ?? '/'
      writeKey(RETURN_KEY, null)
      trace.event('manager.completeRedirect.ok', { provider: provider.id, returnTo })
      return { identity: set(identity), returnTo }
    },

    /**
     * Sign out to guest. The guest subject is NOT destroyed — the player
     * lands back on the same guest they were before, with those saves intact.
     * @returns {Promise<object>} the guest Identity
     */
    async signOut() {
      const previous = current
      trace.event('manager.signOut.start', { kind: previous?.kind ?? 'none' })
      if (previous && !isAnon(previous)) {
        const provider = byId.get(readKey(SESSION_KEY)) ?? byId.get(previous.kind)
        try {
          await provider?.signOut?.(previous)
        } catch (err) {
          trace.error('manager.signOut.failed', err, { note: 'continuing to guest' })
        }
      }
      rememberProvider('anon')
      return set(await anon.restore())
    },

    /**
     * Destroy the stored guest subject and mint a fresh one. This orphans
     * every save under the old subject — the caller must confirm first.
     * @returns {Promise<object>} the new guest Identity
     */
    async forgetGuest() {
      await anon.forget?.()
      if (current && isAnon(current)) return set(await anon.restore())
      return current
    },

    /**
     * Subscribe to identity changes (for the chip in the shell chrome).
     * NOTE: a running game never subscribes — see src/host/host.js.
     * @returns {() => void} unsubscribe
     */
    subscribe(fn) {
      listeners.add(fn)
      // Guarded exactly like emit(): a listener that throws on its first call
      // must not propagate out of subscribe() into whoever was wiring up the
      // UI, or one bad chip takes down the whole shell.
      if (current) {
        try { fn(current) } catch (err) { console.warn('[identity] listener threw:', err) }
      }
      return () => listeners.delete(fn)
    },
  }
}

const isAnonProvider = (p) => p.id === 'anon'

const safeAvailable = async (provider) => {
  try { return await provider.available() } catch (_) { return false }
}

/** Where to come back to after a redirect sign-in. */
const currentPath = () => {
  const loc = globalThis.location
  if (!loc) return '/'
  return `${loc.pathname}${loc.search}${loc.hash}`
}

/** Re-exported so callers don't need a second import for the common check. */
export { makeIdentity, isAnon }
