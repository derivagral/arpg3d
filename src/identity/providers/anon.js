/**
 * src/identity/providers/anon.js — the guest identity provider
 *
 * Mints a random subject on first visit and remembers it. This is what makes
 * "anonymous is a first-class identity" true rather than aspirational: the
 * guest has a real, stable subject, so their saves are namespaced exactly
 * like a signed-in player's and can be handed over wholesale when they later
 * sign in (see src/storage/claim.js).
 *
 * The anon subject deliberately SURVIVES sign-in. It is not cleared when the
 * player authenticates, because the claim offer ("bring your guest saves with
 * you?") needs it, and because signing out should drop the player back into
 * the same guest they were before rather than orphaning those saves behind a
 * fresh uuid.
 *
 * `forget()` is the only thing that destroys it, and it is wired to an
 * explicit "forget me" action — never to sign-out.
 */

import { makeIdentity, KIND_ANON, ANON_PREFIX, IDENTITY_NS } from '../identity.js'

export const ANON_KEY = `${IDENTITY_NS}:anon`

/**
 * A uuid, preferring the platform CSPRNG. The fallback exists because
 * crypto.randomUUID() is unavailable on insecure origins (plain-http LAN
 * testing on a phone, for instance) — uniqueness still matters there, but
 * unpredictability does not, since an anon subject grants no authority.
 * @returns {string}
 */
const uuid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const rand = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return `${rand()}${rand()}-${rand()}-4${rand().slice(1)}-a${rand().slice(1)}-${rand()}${rand()}${rand()}`
}

/**
 * @param {{ storage?: Storage }} [opts] injectable for tests
 */
export const createAnonProvider = ({ storage = globalThis.localStorage } = {}) => {
  /** Read the stored subject, ignoring anything that isn't a well-formed one. */
  const read = () => {
    let stored = null
    try {
      stored = storage?.getItem(ANON_KEY) ?? null
    } catch (_) {
      // Private-mode / disabled storage: fall through to an ephemeral subject.
      return null
    }
    if (typeof stored !== 'string' || !stored.startsWith(ANON_PREFIX)) return null
    if (stored.length <= ANON_PREFIX.length) return null
    return stored
  }

  const mint = () => {
    const subject = `${ANON_PREFIX}${uuid()}`
    try {
      storage?.setItem(ANON_KEY, subject)
    } catch (_) {
      // Nothing persisted — the player is a guest for this tab only. Saves
      // still work in-memory for the session; they just won't be found again.
    }
    return subject
  }

  return {
    id: 'anon',
    label: 'Continue as guest',
    kind: KIND_ANON,

    /** No credentials, no network, no config: always usable. */
    async available() {
      return true
    },

    /**
     * The guest identity, minting one on first visit. Never returns null —
     * this provider is the floor the whole identity stack falls back to.
     */
    async restore() {
      return makeIdentity({ subject: read() ?? mint(), kind: KIND_ANON })
    },

    /** Signing in as a guest is just restoring the guest. */
    async signIn() {
      return this.restore()
    },

    /**
     * No-op. Signing out OF a guest is meaningless — the guest is the
     * signed-out state. Use forget() to actually destroy the subject.
     */
    async signOut() {},

    /**
     * Destroy the stored guest subject. The caller is responsible for warning
     * that saves under it become unreachable.
     */
    async forget() {
      try {
        storage?.removeItem(ANON_KEY)
      } catch (_) { /* nothing to forget */ }
    },

    /** @returns {string|null} the stored subject without minting one */
    peek() {
      return read()
    },
  }
}
