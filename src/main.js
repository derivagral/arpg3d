/**
 * src/main.js — the shell
 *
 * The site shell owns identity and the pre-game flow. Games are guests: they
 * receive an already-resolved player context and a frozen set of capabilities,
 * and are mounted into a container. See src/host/host.js for the boundary.
 *
 * Boot flow (a plain state machine, all of it shell-owned):
 *
 *   boot → resolve identity (silent restore, or mint guest)
 *        → title / save-slot menu   [identity chip visible throughout]
 *        → slot select
 *        → mount game
 *
 * Nothing here waits on Babylon.js or the legacy `js/` globals. The menu is
 * deliberately pre-engine so it works while the CDN script is still loading —
 * or has failed — and WebGL support is checked at mount, not at boot.
 *
 * Note what this file does NOT do: it never imports a game's code. The
 * registry globs manifests, and the module behind one is imported lazily on
 * launch, so a player only ever downloads the game they chose.
 */

import { createShellIdentity } from './identity/boot.js'
import { isAnon } from './identity/identity.js'
import { createSaveStore, adoptLegacySaves } from './storage/saveStore.js'
import { claimOffer, claimSaves, declineClaim } from './storage/claim.js'
import { createHost } from './host/host.js'
import { findGame } from './games/registry.js'
import { mountIdentityChip } from './ui/identityChip.js'
import { showMainMenu } from './ui/mainMenu.js'

const GAME_ID = 'arpg3d'

window.addEventListener('DOMContentLoaded', () => {
  boot().catch(err => {
    console.error('[shell] boot failed:', err)
    document.body.insertAdjacentHTML('beforeend',
      `<div class="shell-error">Could not start: ${err?.message ?? err}</div>`)
  })
})

async function boot() {
  const storage = globalThis.localStorage
  const identityManager = createShellIdentity({ storage })

  // Always yields an Identity — a guest one if nothing else resolves. No
  // caller below this line ever has to handle "signed out".
  const identity = await identityManager.resolve()

  // Saves written before this build knew about subjects belong to whoever is
  // sitting at this browser, which is the guest. Adopt them once, so an
  // existing player does not open the menu to an empty save list.
  if (isAnon(identity)) adoptLegacySaves(storage, identity.subject)

  const chip = mountIdentityChip({ manager: identityManager })

  let active = null      // the mounted game, if any

  /** Tear down any running game and return to the pre-game menu. */
  const toMenu = async () => {
    if (active) {
      await active.instance.unmount()
      active = null
    }
    chip.show()
    document.body.classList.remove('in-game')
    showMenu(identityManager.current())
  }

  // Identity changing while a game runs is an exit-to-shell event, never
  // something the game reasons about — its host holds a frozen snapshot that
  // would silently go stale. Signing out mid-run therefore unmounts.
  identityManager.subscribe((next) => {
    if (active && active.subject !== next.subject) {
      console.log('[shell] identity changed — returning to the menu')
      toMenu()
    }
  })

  const showMenu = (who) => {
    const store = createSaveStore({ storage, subject: who.subject })
    showMainMenu({
      store,
      identity: who,
      // Offered once per guest→account pair, and only when there is actually
      // something to bring across. See src/storage/claim.js.
      claim: buildClaimPrompt({ storage, identityManager, who }),
      onStart: ({ slotId, simState }) =>
        launch({ identity: who, store, slotId, simState }).catch(err => {
          console.error('[shell] launch failed:', err)
          alert(`Could not start the game: ${err.message}`)
          toMenu()
        }),
    })
  }

  /** Mint a host and hand control to the game. */
  const launch = async ({ identity: who, store, slotId, simState }) => {
    const entry = findGame(GAME_ID)
    if (!entry) throw new Error(`no game registered as '${GAME_ID}'`)

    const container = document.getElementById('gameRoot') ?? document.body
    const host = createHost({
      manifest: entry.manifest,
      identity: who,
      storage,
      // Granted because the manifest declares 'saves'. Already namespaced to
      // this player — the game never chooses its own namespace.
      saves: store,
      launch: { slotId, simState },
      onExit: () => toMenu(),
      debug: isDev(),
    })

    chip.hide()
    document.body.classList.add('in-game')

    const { mount } = await entry.load()
    const instance = await mount(container, host)
    active = { instance, subject: who.subject }
  }

  showMenu(identity)
}

/**
 * Build the "bring your guest saves with you?" prompt, or null when there is
 * nothing to offer. Returned as data, not UI: the menu owns where it renders
 * and when it re-renders itself afterwards.
 */
function buildClaimPrompt({ storage, identityManager, who }) {
  const from = identityManager.anonSubject()
  const { offer, count } = claimOffer({ storage, from, to: who })
  if (!offer) return null

  return {
    count,
    accept() {
      const { claimed, skipped } = claimSaves({ storage, from, to: who.subject })
      if (skipped.length) {
        console.warn('[claim] some saves could not be copied:', skipped)
      }
      return { claimed, skipped }
    },
    decline() {
      declineClaim({ storage, from, to: who.subject })
    },
  }
}

const isDev = () =>
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
