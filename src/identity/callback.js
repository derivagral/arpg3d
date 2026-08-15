/**
 * src/identity/callback.js — the OAuth redirect landing page
 *
 * A spinner with a job: exchange the authorization code for a session, then
 * put the player back exactly where they were when they clicked "Sign in".
 *
 * This runs on a REAL page at a REAL path (`oauth/callback/index.html`),
 * registered as a second Vite entry point. It is not a client-side route.
 * GitHub Pages has no SPA rewrite, so a router-only path would 404 on the
 * redirect back from the PDS — and `redirect_uris` must match byte-for-byte,
 * so the trailing slash matters too.
 *
 * Failure here is recoverable and must look that way: the player is already
 * a guest, their guest saves are untouched, and the only thing lost is the
 * sign-in attempt. So an error shows a link home rather than a dead end.
 */

import { createShellIdentity, siteBase } from './boot.js'

const el = (id) => document.getElementById(id)

const fail = (message) => {
  const status = el('status')
  if (status) status.textContent = message
  el('spinner')?.remove()
  el('home')?.removeAttribute('hidden')
}

const run = async () => {
  const home = el('home')
  if (home) home.href = siteBase()

  try {
    const manager = createShellIdentity()
    const { identity, returnTo } = await manager.completeRedirect()

    const status = el('status')
    if (status) {
      const handle = identity.display?.handle
      status.textContent = handle ? `Signed in as @${handle}. Returning…` : 'Signed in. Returning…'
    }

    // replace() so the callback URL — which still carries OAuth parameters —
    // does not sit in history where a back-navigation would re-trigger it.
    location.replace(safeReturn(returnTo))
  } catch (err) {
    console.error('[identity] callback failed:', err)
    fail(err?.message ?? 'Sign-in could not be completed.')
  }
}

/**
 * Only ever navigate to a same-origin path. The return path is read back out
 * of storage, so this is belt-and-braces rather than a live threat — but a
 * stored value that reaches location.replace() is exactly the shape of an
 * open-redirect bug, and the check costs nothing.
 * @returns {string}
 */
const safeReturn = (path) => {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
    return siteBase()
  }
  return path
}

run()
