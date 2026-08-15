/**
 * src/ui/mainMenu.js — Pre-Babylon save slot menu
 *
 * Pure DOM overlay shown before the engine or Game instance exist. The 3D
 * scene does not boot until the player picks a slot, so this is the CRUD
 * surface for save files:
 *
 *   - New Run     → create slot (name + optional seed), start fresh sim
 *   - Continue    → hydrate slot's sim snapshot and start
 *   - Rename / Delete (with confirm)
 *   - Export      → download save JSON, or copy portable code to clipboard
 *   - Import      → paste JSON / code, or pick a .json file
 *
 * Saves with an incompatible schema version are listed grayed out — they can
 * be exported or deleted but not played.
 */

import { createState } from '../../sim/engine.js'
import { hydrateSim, checkCompatibility, parseImportText } from '../../sim/save.js'
import { runMetaFor, hydrateProfile } from '../../sim/profile.js'

/**
 * @param {{ store: ReturnType<import('../storage/saveStore.js').createSaveStore>,
 *           identity?: object,
 *           claim?: { count: number, accept: () => object, decline: () => void } | null,
 *           onStart: (args: { slotId: string, simState: object }) => void }} opts
 */
export const showMainMenu = ({ store, identity = null, claim = null, onStart }) => {
  // The menu is a singleton. The shell re-shows it whenever it returns from a
  // game or the identity changes, and stacking a second copy on top of a live
  // one would leave the buried menu's handlers wired to a stale save store.
  document.getElementById('mainMenu')?.remove()

  const root = document.createElement('div')
  root.id = 'mainMenu'
  document.body.appendChild(root)

  // Cleared once answered, so the banner does not survive its own re-render.
  let activeClaim = claim

  let statusTimer = null
  const setStatus = (msg, isError = false) => {
    const el = root.querySelector('.menu-status')
    el.textContent = msg
    el.classList.toggle('error', isError)
    clearTimeout(statusTimer)
    if (msg) statusTimer = setTimeout(() => { el.textContent = '' }, 5000)
  }

  const start = (slotId, simState) => {
    clearTimeout(statusTimer)
    root.remove()
    onStart({ slotId, simState })
  }

  const playSlot = async (id) => {
    const file = await store.get(id)
    if (!file) return setStatus('Save not found.', true)
    const { compatible, reason, file: usable } = checkCompatibility(file)
    if (!compatible) return setStatus(`Incompatible save: ${reason}`, true)

    const { state, warnings } = hydrateSim(usable.sim)
    if (warnings.length) console.warn('[save] hydration warnings:', warnings)

    // A dead run can't be resumed (tick() no-ops) — restart the slot fresh.
    // The restart takes a new meta snapshot so upgrades bought since the
    // last run actually apply.
    const sim = state.phase === 'dead'
      ? createState(Date.now(), runMetaFor(hydrateProfile(usable.profile)))
      : state
    start(id, sim)
  }

  const newRun = async () => {
    const name = root.querySelector('#newRunName').value.trim() || defaultRunName()
    const seedText = root.querySelector('#newRunSeed').value.trim()
    const seed = seedText === '' ? Date.now() : Number(seedText)
    if (!Number.isFinite(seed)) return setStatus('Seed must be a number.', true)

    const sim = createState(seed)
    const file = await store.create(name, sim)
    start(file.id, sim)
  }

  const importText = async (text) => {
    try {
      const imported = await store.importSaveFile(parseImportText(text))
      await render()  // re-render first — it rebuilds the status element
      setStatus(`Imported "${imported.name}".`)
    } catch (e) {
      setStatus(`Import failed: ${e.message}`, true)
    }
  }

  const exportJson = async (id, name) => {
    const json = await store.exportJson(id)
    if (!json) return setStatus('Save not found.', true)
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${name.replace(/[^\w-]+/g, '_') || 'save'}.arpg3d.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const copyCode = async (id) => {
    const code = await store.exportCode(id)
    if (!code) return setStatus('Save not found.', true)
    try {
      await navigator.clipboard.writeText(code)
      setStatus('Save code copied to clipboard.')
    } catch (_) {
      window.prompt('Copy save code:', code)
    }
  }

  const render = async () => {
    const slots = await store.list()
    root.innerHTML = `
      <div class="menu-panel">
        <h1>ARPG3D</h1>
        <div class="menu-status"></div>
        ${renderClaim(activeClaim)}

        <div class="menu-section">
          <h2>New Run</h2>
          <div class="menu-row">
            <input id="newRunName" type="text" placeholder="Run name" maxlength="40">
            <input id="newRunSeed" type="text" placeholder="Seed (optional)" maxlength="20">
            <button id="newRunBtn" class="menu-btn primary">Start</button>
          </div>
        </div>

        <div class="menu-section">
          <h2>Saved Runs</h2>
          <div class="save-list">
            ${slots.length === 0 ? '<div class="save-empty">No saves yet.</div>' : ''}
            ${slots.map(renderSlot).join('')}
          </div>
        </div>

        <div class="menu-section">
          <h2>Import</h2>
          <div class="menu-row">
            <input id="importText" type="text" placeholder="Paste save JSON or arpg3d.v1... code">
            <button id="importTextBtn" class="menu-btn">Import</button>
            <label class="menu-btn file-btn">Import File
              <input id="importFile" type="file" accept=".json,application/json" hidden>
            </label>
          </div>
        </div>
      </div>
    `

    if (activeClaim) {
      root.querySelector('#claimAccept').addEventListener('click', async () => {
        const { claimed, skipped } = await activeClaim.accept()
        // Answer first, then re-render: the copied saves have to show up in
        // the list, and the banner must not come back. setStatus runs after
        // render() because render() rebuilds the status element.
        activeClaim = null
        await render()
        setStatus(
          `Copied ${claimed} guest save${claimed === 1 ? '' : 's'} to your account.` +
          (skipped.length ? ` ${skipped.length} could not be copied.` : ''),
          skipped.length > 0
        )
      })
      root.querySelector('#claimDecline').addEventListener('click', async () => {
        await activeClaim.decline()
        activeClaim = null
        await render()
      })
    }

    root.querySelector('#newRunBtn').addEventListener('click', newRun)
    root.querySelector('#newRunName').addEventListener('keydown', e => { if (e.key === 'Enter') newRun() })
    root.querySelector('#newRunSeed').addEventListener('keydown', e => { if (e.key === 'Enter') newRun() })

    root.querySelector('#importTextBtn').addEventListener('click', () => {
      const text = root.querySelector('#importText').value
      if (text.trim()) importText(text)
    })
    root.querySelector('#importFile').addEventListener('change', async (e) => {
      const file = e.target.files[0]
      if (file) importText(await file.text())
    })

    root.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { action, id, name } = btn.dataset
        if (action === 'play') await playSlot(id)
        if (action === 'json') await exportJson(id, name)
        if (action === 'code') await copyCode(id)
        if (action === 'rename') {
          const next = window.prompt('Rename save:', name)
          if (next && next.trim()) { await store.rename(id, next.trim()); await render() }
        }
        if (action === 'delete') {
          if (window.confirm(`Delete "${name}"? This cannot be undone.`)) {
            await store.remove(id)
            await render()
          }
        }
      })
    })
  }

  // Returned so the shell can await the first paint. Everything below the
  // initial render is event-driven, so nothing else needs to wait on it.
  return render()
}

/**
 * The one-time "bring your guest saves with you?" offer, shown after a first
 * sign-in. Worded to make clear this is a copy: the guest saves stay where
 * they are, so declining costs nothing and signing out gets you back to them.
 */
const renderClaim = (claim) => {
  if (!claim) return ''
  return `
    <div class="menu-claim">
      <div class="claim-text">
        You have ${claim.count} save${claim.count === 1 ? '' : 's'} from playing as a guest.
        Copy ${claim.count === 1 ? 'it' : 'them'} to this account? Your guest saves stay
        where they are either way.
      </div>
      <div class="claim-actions">
        <button id="claimAccept" class="menu-btn primary">Copy to my account</button>
        <button id="claimDecline" class="menu-btn">No thanks</button>
      </div>
    </div>
  `
}

const renderSlot = (slot) => {
  const m = slot.meta
  const summary = m
    ? `Depth ${m.depth} · ${m.gold} gold · ${m.affixCount} affixes · ${formatElapsed(m.elapsed)}${m.phase === 'dead' ? ' · <span class="save-dead">dead — restarts</span>' : ''}`
    : 'No summary'
  const updated = slot.updatedAt ? new Date(slot.updatedAt).toLocaleString() : '—'

  return `
    <div class="save-slot ${slot.compatible ? '' : 'incompatible'}">
      <div class="save-info">
        <div class="save-name">${escapeHtml(slot.name)}
          ${slot.compatible ? '' : `<span class="save-badge" title="${escapeHtml(slot.reason ?? '')}">v${slot.v} incompatible</span>`}
        </div>
        <div class="save-summary">${summary}</div>
        <div class="save-updated">${updated}</div>
      </div>
      <div class="save-actions">
        ${slot.compatible ? `<button class="menu-btn primary" data-action="play" data-id="${slot.id}">Play</button>` : ''}
        <button class="menu-btn" data-action="json" data-id="${slot.id}" data-name="${escapeHtml(slot.name)}" title="Download save as JSON">JSON</button>
        <button class="menu-btn" data-action="code" data-id="${slot.id}" title="Copy portable save code">Code</button>
        <button class="menu-btn" data-action="rename" data-id="${slot.id}" data-name="${escapeHtml(slot.name)}">Rename</button>
        <button class="menu-btn danger" data-action="delete" data-id="${slot.id}" data-name="${escapeHtml(slot.name)}">Delete</button>
      </div>
    </div>
  `
}

const defaultRunName = () => {
  const d = new Date()
  return `Run ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

const formatElapsed = (ms) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const escapeHtml = (str) =>
  String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
