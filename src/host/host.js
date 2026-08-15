/**
 * src/host/host.js — THE BOUNDARY between the shell and a game
 *
 * A game is a guest. It receives an already-resolved, opaque player context
 * and a set of capabilities the shell chose to grant it. It does not know how
 * the player signed in, it never sees a token, and it must never learn that
 * atproto exists.
 *
 * ── The one rule ────────────────────────────────────────────────────────────
 *   NO GAME MODULE MAY IMPORT `@atproto/*` OR TOUCH `localStorage` DIRECTLY.
 *   If a game needs something, it comes through `host`.
 *
 * That single rule is what keeps identity swappable and games sandboxable. A
 * game that reads localStorage has silently hardcoded "same origin, same
 * thread, one player" and cannot be moved into an iframe, a Worker, or onto a
 * server without rewriting it.
 *
 * ── Why everything is async ─────────────────────────────────────────────────
 * Every capability method returns a promise even where the current
 * implementation is synchronous. That is deliberate and load-bearing: it
 * means the entire host object can be replaced by a postMessage proxy later
 * with zero game-side changes. Making these synchronous now would be a
 * one-way door.
 *
 * ── Why `player` is a frozen snapshot ───────────────────────────────────────
 * Not a subscription, not a live object. Identity changing mid-session is an
 * exit-to-shell event, not something a game should reason about. A game that
 * could observe a sign-in mid-run would need to answer "whose run is this?"
 * — so the shell answers it instead by tearing the game down and remounting.
 *
 * ── Capabilities are declared, the shell decides ────────────────────────────
 * A manifest lists what it wants; only granted capabilities appear on the
 * host. An undeclared capability is ABSENT, not merely unused, so a game that
 * forgot to declare `storage` fails loudly at development time instead of
 * silently working until the shell tightens up.
 */

import { createLocalStorageAdapter } from './storage/localAdapter.js'
import { createTelemetry } from './telemetry.js'
import { createSettingsStore } from './settings.js'

/** Capabilities a manifest may ask for. */
export const CAPABILITIES = Object.freeze(['storage', 'saves', 'telemetry', 'settings'])

/**
 * The player snapshot handed to a game. A deliberately lossy copy of an
 * Identity: subject, kind, and cosmetic display. No tokens, no session
 * handle, no way back to the auth layer.
 * @returns {Readonly<object>}
 */
export const playerSnapshot = (identity) => Object.freeze({
  subject: identity.subject,
  kind: identity.kind,
  display: identity.display
    ? Object.freeze({ ...identity.display })
    : null,
})

/**
 * Mint a host for one launch. Frozen: a game cannot bolt extra capabilities
 * onto it, and cannot swap one out from under the shell.
 *
 * @param {{
 *   manifest: { id: string, capabilities?: string[] },
 *   identity: object,
 *   storage?: Storage,
 *   saves?: object,                       // versioned slot store, if granted
 *   launch?: object,                      // shell's per-launch choices
 *   telemetrySink?: (record: object) => void,
 *   onExit: (reason: string) => void|Promise<void>,
 *   debug?: boolean,
 * }} opts
 * @returns {Readonly<object>} the host
 */
export const createHost = ({
  manifest,
  identity,
  storage = globalThis.localStorage,
  saves = null,
  launch = {},
  telemetrySink,
  onExit,
  debug = false,
}) => {
  if (!manifest?.id) throw new Error('host: manifest.id is required')
  if (!identity?.subject) throw new Error('host: a resolved identity is required')
  if (typeof onExit !== 'function') throw new Error('host: onExit is required')

  const gameId = manifest.id
  const subject = identity.subject
  const wanted = manifest.capabilities ?? []

  for (const cap of wanted) {
    if (!CAPABILITIES.includes(cap)) {
      throw new Error(`host: game '${gameId}' declared unknown capability '${cap}'`)
    }
  }

  const grant = (cap) => wanted.includes(cap)

  const host = {
    /** Frozen snapshot. See the header for why this is not a subscription. */
    player: playerSnapshot(identity),

    /**
     * What the shell decided for this launch — which save slot, which
     * difficulty, whatever the pre-game screens collected. The shell owns
     * slot selection (it is a step in the pre-game state machine), so the
     * choice has to reach the game somehow, and a per-launch field on the
     * per-launch host is the honest place for it. A game reads it once at
     * mount; it never changes for the life of the mount.
     */
    launch: Object.freeze({ ...launch }),

    /**
     * Hand control back to the shell. The shell is responsible for calling
     * unmount() — a game must not tear itself down and must not assume it
     * keeps running after calling this.
     * @param {string} reason e.g. 'quit', 'died', 'identity-changed'
     */
    async exit(reason = 'quit') {
      await onExit(String(reason))
    },
  }

  if (grant('storage')) {
    host.storage = createLocalStorageAdapter({ storage, gameId, subject })
  }

  if (grant('saves')) {
    if (!saves) throw new Error(`host: game '${gameId}' declared 'saves' but the shell granted none`)
    // The versioned slot store (sim/save.js format). Already namespaced to
    // this subject by the shell — the game never chooses its own namespace.
    host.saves = saves
  }

  if (grant('telemetry')) {
    host.telemetry = createTelemetry({ sink: telemetrySink, gameId, subject, debug })
  }

  if (grant('settings')) {
    const store = createSettingsStore({ storage, subject })
    // Read-only on purpose: settings are shell-owned. See settings.js.
    host.settings = Object.freeze({ async get() { return store.get() } })
  }

  return Object.freeze(host)
}
