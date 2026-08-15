/**
 * src/host/settings.js — shell-owned player settings
 *
 * Volume, render quality and keybinds belong to the PLAYER, not to any one
 * game, so they live in the shell and are namespaced by subject alone. A
 * player who sets the music to 20% should not have to set it again in the
 * next game.
 *
 * Games get a read-only view (`host.settings.get()`). Writing is a shell
 * concern: a game rendering its own volume slider would mean every game
 * re-implementing the same screen, and would let one game rewrite settings
 * another game relies on. If a game needs an in-game options screen later,
 * the right move is a shell-rendered overlay, not a write capability here.
 */

import { subjectKey } from '../identity/identity.js'

export const SETTINGS_NS = 'arpg3d.shell:settings:v1'

/** Shipped defaults. Unknown keys in storage are preserved; absent ones fill in. */
export const DEFAULT_SETTINGS = Object.freeze({
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.8,
  quality: 'auto',        // 'auto' | 'low' | 'medium' | 'high'
  reducedMotion: false,
  keybinds: Object.freeze({
    up: 'KeyW',
    down: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    inventory: 'KeyI',
    pause: 'Escape',
  }),
})

/**
 * @param {{ storage?: Storage, subject: string }} opts
 */
export const createSettingsStore = ({ storage = globalThis.localStorage, subject }) => {
  if (!subject) throw new Error('settings: subject is required')
  const key = `${SETTINGS_NS}:${subjectKey(subject)}`

  const read = () => {
    try {
      const raw = storage.getItem(key)
      if (!raw) return { ...DEFAULT_SETTINGS }
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS }
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        keybinds: { ...DEFAULT_SETTINGS.keybinds, ...(parsed.keybinds ?? {}) },
      }
    } catch (_) {
      return { ...DEFAULT_SETTINGS }
    }
  }

  return {
    /** @returns {object} a fresh mutable copy — callers cannot corrupt the store */
    get: () => read(),

    /** Shallow-merge a patch. Shell-only; not exposed on the host. */
    set(patch) {
      const next = { ...read(), ...patch }
      if (patch?.keybinds) next.keybinds = { ...read().keybinds, ...patch.keybinds }
      try {
        storage.setItem(key, JSON.stringify(next))
      } catch (err) {
        console.warn('[settings] could not persist:', err)
      }
      return next
    },

    reset() {
      try { storage.removeItem(key) } catch (_) { /* already gone */ }
      return { ...DEFAULT_SETTINGS }
    },
  }
}
