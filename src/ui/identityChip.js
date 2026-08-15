/**
 * src/ui/identityChip.js — "Playing as guest · Sign in" / "@handle · Sign out"
 *
 * Lives in the shell chrome and stays put across every pre-game screen. Two
 * rules it exists to enforce:
 *
 *   - Signing in NEVER dumps you on a landing page. The chip stashes where
 *     you were and the callback returns you there.
 *   - There is never a login wall. The chip is an offer, not a gate; the
 *     player can ignore it forever and still play.
 *
 * It is hidden while a game is mounted: the game owns the screen, and an
 * identity control floating over it would invite a mid-run identity change,
 * which is precisely the thing the host contract is built to avoid.
 */

import { displayLabel, isAnon } from '../identity/identity.js'
import { showSignInPanel } from './signInPanel.js'

/**
 * @param {{ manager: object, container?: HTMLElement }} opts
 * @returns {{ element: HTMLElement, show(): void, hide(): void, destroy(): void }}
 */
export const mountIdentityChip = ({ manager, container = document.body }) => {
  const root = document.createElement('div')
  root.className = 'identity-chip'
  container.appendChild(root)

  const render = (identity) => {
    const guest = !identity || isAnon(identity)
    const avatar = identity?.display?.avatar
    root.innerHTML = `
      ${avatar ? `<img class="identity-avatar" src="${escapeAttr(avatar)}" alt="">` : '<span class="identity-dot"></span>'}
      <span class="identity-label" title="${escapeAttr(identity?.subject ?? '')}">${
        guest ? 'Playing as guest' : escapeHtml(displayLabel(identity))
      }</span>
      <button class="identity-action" type="button">${guest ? 'Sign in' : 'Sign out'}</button>
    `
    root.querySelector('.identity-action').addEventListener('click', async () => {
      if (guest) {
        showSignInPanel({ manager })
      } else {
        await manager.signOut()
      }
    })
  }

  const unsubscribe = manager.subscribe(render)

  return {
    element: root,
    show() { root.style.display = '' },
    hide() { root.style.display = 'none' },
    destroy() {
      unsubscribe()
      root.remove()
    },
  }
}

const escapeHtml = (str) =>
  String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const escapeAttr = escapeHtml
