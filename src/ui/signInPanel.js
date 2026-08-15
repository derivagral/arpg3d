/**
 * src/ui/signInPanel.js — the sign-in modal
 *
 * Renders whatever providers the registry offers. It has no idea what atproto
 * is: a provider declaring `input: { name, label, placeholder }` gets one text
 * field, a provider without one gets a plain button. Adding an auth method
 * never touches this file.
 *
 * THERE IS NO PASSWORD FIELD HERE, AND THERE MUST NEVER BE ONE. For atproto,
 * the handle is resolved to a DID, then to that user's PDS, and the player
 * authenticates on their own server. This app never sees a credential — which
 * is exactly why it can be a static site with no backend.
 */

export const showSignInPanel = ({ manager, onDone }) => {
  const root = document.createElement('div')
  root.className = 'identity-modal'
  document.body.appendChild(root)

  const close = () => {
    root.remove()
    document.removeEventListener('keydown', onKey)
    onDone?.()
  }
  const onKey = (e) => { if (e.key === 'Escape') close() }
  document.addEventListener('keydown', onKey)

  const setStatus = (msg, isError = false) => {
    const el = root.querySelector('.identity-status')
    if (!el) return
    el.textContent = msg ?? ''
    el.classList.toggle('error', isError)
  }

  const setBusy = (busy) => {
    root.querySelectorAll('button, input').forEach(el => { el.disabled = busy })
  }

  const render = (providers) => {
    root.innerHTML = `
      <div class="identity-panel">
        <button class="identity-close" type="button" aria-label="Close">×</button>
        <h2>Sign in</h2>
        <p class="identity-blurb">
          Signing in keys your saves to your account instead of this browser,
          so they follow you to another machine. You can keep playing as a
          guest — nothing is locked behind this.
        </p>
        <div class="identity-status"></div>
        ${providers.map(renderProvider).join('')}
      </div>
    `

    root.querySelector('.identity-close').addEventListener('click', close)
    root.addEventListener('click', (e) => { if (e.target === root) close() })

    for (const provider of providers) {
      const form = root.querySelector(`[data-provider="${provider.id}"]`)
      if (!form) continue
      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        const input = form.querySelector('input')?.value ?? ''
        setBusy(true)
        setStatus(provider.input ? 'Finding your server…' : 'Signing in…')
        try {
          // For redirect providers this never returns — the browser leaves.
          await manager.signIn(provider.id, input)
          close()
        } catch (err) {
          setBusy(false)
          setStatus(err.message || 'Sign-in failed.', true)
        }
      })
    }
  }

  const renderProvider = (provider) => `
    <form class="identity-provider" data-provider="${escapeAttr(provider.id)}">
      ${provider.input ? `
        <label class="identity-field">
          <span>${escapeHtml(provider.input.label)}</span>
          <input type="text"
                 name="${escapeAttr(provider.input.name)}"
                 placeholder="${escapeAttr(provider.input.placeholder ?? '')}"
                 autocomplete="username"
                 autocapitalize="none"
                 spellcheck="false">
        </label>
      ` : ''}
      <button type="submit" class="menu-btn primary">${escapeHtml(provider.label)}</button>
    </form>
  `

  // Guest is not offered as a choice here — the player already IS a guest.
  manager.availableProviders()
    .then(providers => render(providers.filter(p => p.kind !== 'anon')))
    .catch(err => {
      root.innerHTML = `<div class="identity-panel"><p class="identity-status error">${escapeHtml(err.message)}</p></div>`
    })

  return { close }
}

const escapeHtml = (str) =>
  String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const escapeAttr = escapeHtml
