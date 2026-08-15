/**
 * src/identity/providers/index.js — the provider registry
 *
 * The one place that knows which auth methods this build ships with. Adding a
 * method is a file plus a line here; nothing in the shell, the save store, the
 * host contract or any game changes.
 *
 * Order matters for presentation only — the sign-in panel renders them in this
 * order, minus any that report `available() === false` in the current
 * environment. `anon` is always last because it is the fallback, not a choice
 * anyone should have to make first.
 */

import { createAnonProvider } from './anon.js'
import { createAtprotoProvider } from './atproto.js'

/**
 * @param {{ origin?: string, base?: string, storage?: Storage }} [opts]
 * @returns {object[]} providers, in display order
 */
export const createDefaultProviders = ({
  origin = globalThis.location?.origin,
  base = '/',
  storage = globalThis.localStorage,
} = {}) => [
  createAtprotoProvider({ origin, base }),
  createAnonProvider({ storage }),
]

export { createAnonProvider, createAtprotoProvider }
