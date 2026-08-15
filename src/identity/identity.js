/**
 * src/identity/identity.js — the Identity value type
 *
 * This is the ONLY identity shape anything downstream ever sees. Games never
 * see it at all (they get `host.player`, a copy); the shell UI and the save
 * store see this.
 *
 * Two rules drive the whole design:
 *
 *   1. The SUBJECT is the key, the handle is not. `did:plc:abc123` is
 *      permanent; `patrick.bsky.social` can be handed to someone else
 *      tomorrow. Every save file, score and settings blob is keyed on
 *      subject. `display` is cosmetic, refetched on load, never persisted
 *      as a key.
 *
 *   2. Anonymous is a first-class identity, not a null. There is always a
 *      subject, so no downstream code ever branches on logged-in-ness and
 *      nobody hits a login wall before they can play.
 *
 *      { subject: 'anon:0193-...uuid' | 'did:plc:abc123',
 *        kind:    'anon' | 'atproto',
 *        display: { handle, name, avatar } | null }
 *
 * Identities are frozen. Identity is not a live object you mutate or
 * subscribe to from inside a session — a change of identity is an
 * exit-to-shell event (see src/host/host.js).
 *
 * This module has zero dependencies on the game, on storage, and on any
 * auth library. That is deliberate: it is the future `packages/identity`
 * boundary, and it must stay importable in Node for tests.
 */

/** Identity kinds known to the shell. Providers declare one of these. */
export const KIND_ANON = 'anon'
export const KIND_ATPROTO = 'atproto'

/** Subject prefix for locally-minted anonymous players. */
export const ANON_PREFIX = 'anon:'

/**
 * Shell-level storage namespace. Deliberately NOT imported from sim/save.js:
 * identity outlives and out-scopes any single game, so it must not depend on
 * game code.
 */
export const IDENTITY_NS = 'arpg3d.shell:identity:v1'

/**
 * Build a frozen Identity. Throws on a missing subject or kind — a
 * half-formed identity must never reach the save store, because a bad
 * subject means saves written to the wrong namespace.
 *
 * @param {{ subject: string, kind: string,
 *           display?: { handle?: string|null, name?: string|null, avatar?: string|null } | null }} input
 * @returns {Readonly<{ subject: string, kind: string, display: object|null }>}
 */
export const makeIdentity = ({ subject, kind, display = null }) => {
  if (typeof subject !== 'string' || subject.trim() === '') {
    throw new TypeError('identity: subject must be a non-empty string')
  }
  if (typeof kind !== 'string' || kind.trim() === '') {
    throw new TypeError('identity: kind must be a non-empty string')
  }
  return Object.freeze({
    subject,
    kind,
    display: display
      ? Object.freeze({
          handle: display.handle ?? null,
          name: display.name ?? null,
          avatar: display.avatar ?? null,
        })
      : null,
  })
}

/** @returns {boolean} true for a locally-minted guest identity */
export const isAnon = (identity) => identity?.kind === KIND_ANON

/**
 * What to show in the identity chip. Handle wins over display name because
 * a handle is unique and a display name is not; both are cosmetic.
 * @returns {string}
 */
export const displayLabel = (identity) => {
  if (!identity) return 'Signed out'
  if (isAnon(identity)) return 'Guest'
  const handle = identity.display?.handle
  if (handle) return `@${handle}`
  return identity.display?.name || shortSubject(identity.subject)
}

/**
 * A subject shortened for display when there is no handle to show. Never use
 * this as a key — it is lossy on purpose.
 * @returns {string}
 */
export const shortSubject = (subject) => {
  if (typeof subject !== 'string') return '—'
  if (subject.length <= 20) return subject
  return `${subject.slice(0, 12)}…${subject.slice(-6)}`
}

/**
 * Storage namespace segment for a subject. Percent-encoded so that a subject
 * containing ':' (every DID does) can never collide with, or escape into,
 * the key separators used by callers.
 * @returns {string}
 */
export const subjectKey = (subject) => encodeURIComponent(subject)

/**
 * Same identity, with a refreshed display block. Used after an unauthenticated
 * profile fetch resolves a handle/avatar — the subject is untouched.
 * @returns {Readonly<object>}
 */
export const withDisplay = (identity, display) =>
  makeIdentity({ subject: identity.subject, kind: identity.kind, display })

/** @returns {boolean} true when both refer to the same player */
export const sameSubject = (a, b) => Boolean(a && b && a.subject === b.subject)
