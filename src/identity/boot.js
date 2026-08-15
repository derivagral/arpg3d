/**
 * src/identity/boot.js — one way to construct the identity stack
 *
 * Both the app and the OAuth callback page need an identically-configured
 * manager. If they disagreed on origin or base, the callback would build a
 * different `client_id` than the one the sign-in started with and the token
 * exchange would fail with a confusing mismatch error. So neither page
 * constructs its own — they both come here.
 *
 * `BASE_URL` is Vite's, injected at build time from `base` in vite.config.js.
 * That is what makes the same source work at `/` locally and at `/arpg3d/` on
 * GitHub Pages without a hardcoded path anywhere.
 */

import { createIdentityManager } from './manager.js'
import { createDefaultProviders } from './providers/index.js'

/** The deploy's base path, e.g. '/' or '/arpg3d/'. */
export const siteBase = () => {
  try {
    return import.meta.env?.BASE_URL ?? '/'
  } catch (_) {
    return '/'
  }
}

/**
 * @param {{ storage?: Storage }} [opts]
 * @returns {object} the identity manager
 */
export const createShellIdentity = ({ storage = globalThis.localStorage } = {}) => {
  const base = siteBase()
  const origin = globalThis.location?.origin
  return createIdentityManager({
    providers: createDefaultProviders({ origin, base, storage }),
    storage,
  })
}
