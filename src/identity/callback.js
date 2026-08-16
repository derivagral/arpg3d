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
import { identityTrace } from './trace.js'

const el = (id) => document.getElementById(id)

/**
 * Show the failure, and hand over the trace.
 *
 * This page is the far end of a flow that started on a different document, so
 * "it didn't work" here is close to unactionable on its own — the cause is
 * usually a client_id, redirect_uri or origin decided one navigation ago. The
 * trace survived that navigation (sessionStorage, see trace.js), so it is put
 * on screen, collapsed, as pasteable text.
 */
const fail = (message) => {
  const status = el('status')
  if (status) status.textContent = message
  el('spinner')?.remove()
  el('home')?.removeAttribute('hidden')

  const details = el('details')
  const dump = el('trace')
  if (details && dump) {
    dump.textContent = identityTrace.report()
    details.removeAttribute('hidden')
  }
}

const run = async () => {
  const home = el('home')
  if (home) home.href = siteBase()

  identityTrace.install()
  identityTrace.event('callback.page', {
    origin: location.origin,
    href: `${location.origin}${location.pathname}`,
    hasCode: new URLSearchParams(location.search).has('code'),
    hasError: new URLSearchParams(location.search).get('error') ?? 'none',
  })

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
    identityTrace.error('callback.failed', err)
    fail(playerMessage(err))
  }
}

/**
 * One translation, for the one failure a player can actually reach by accident.
 *
 * "No redirect in progress" means this page cannot see the localStorage the
 * sign-in was started from — a reloaded or bookmarked callback URL, a second
 * tab, or dev browsed at localhost while the redirect landed on 127.0.0.1.
 * All of them are "start again", and none of them are worth showing in those
 * words. Everything else keeps its own message; the trace below has the rest.
 * @returns {string}
 */
const playerMessage = (err) => {
  if (/no redirect in progress/i.test(err?.message ?? '')) {
    return 'This sign-in link has already been used, or was started in a different ' +
      'window. Head back and try signing in again.'
  }
  return err?.message ?? 'Sign-in could not be completed.'
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
