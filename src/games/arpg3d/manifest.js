/**
 * src/games/arpg3d/manifest.js — what the shell knows before launching
 *
 * Split from index.js on purpose. The shell needs every game's manifest to
 * render the game-select screen, but it must not pay to import every game's
 * code to do it — index.js drags in the whole sim and the Babylon render
 * layer. Manifests are eagerly globbed; the module behind one is imported
 * lazily, only when the player actually launches it.
 *
 * `capabilities` is a REQUEST, not a grant. The shell decides what to hand
 * over, and anything not listed here is absent from the host object at
 * runtime rather than merely unused.
 */

export const manifest = Object.freeze({
  id: 'arpg3d',
  title: 'ARPG3D',
  blurb: 'Descend, die, bank echoes, descend further.',
  saveSchema: 2,
  capabilities: Object.freeze(['saves', 'telemetry', 'settings']),
})

export default manifest
