/**
 * src/games/registry.js — the shell's catalogue of games
 *
 * Adding a game is a DIRECTORY, not a code change. Drop
 * `src/games/<id>/manifest.js` and `src/games/<id>/index.js` in place and it
 * appears. Nothing here, in the shell, or in any other game needs editing.
 *
 * Manifests are globbed eagerly because the game-select screen needs all of
 * them; the modules behind them are globbed lazily so each game builds to its
 * own chunk and a player who launches one never downloads the others.
 *
 * Vite-only module: `import.meta.glob` is a build-time transform. Nothing in
 * `sim/` or the identity layer imports this, so Node tests are unaffected.
 */

const manifestModules = import.meta.glob('./*/manifest.js', { eager: true })
const gameModules = import.meta.glob('./*/index.js')

/** './arpg3d/manifest.js' → 'arpg3d' */
const dirOf = (path) => path.split('/')[1]

/**
 * @returns {Array<{ manifest: object, load: () => Promise<{ mount: Function }> }>}
 *   catalogue entries, sorted by title
 */
export const listGames = () =>
  Object.entries(manifestModules)
    .map(([path, mod]) => {
      const manifest = mod.manifest ?? mod.default
      const dir = dirOf(path)
      if (!manifest?.id) {
        console.warn(`[games] ${path} exports no manifest — skipping`)
        return null
      }
      if (manifest.id !== dir) {
        // The directory name is the URL-facing id and the storage namespace;
        // a mismatch would silently split one game's saves across two keys.
        console.warn(`[games] ${path}: manifest.id '${manifest.id}' ≠ directory '${dir}' — using the directory`)
      }
      const loader = gameModules[`./${dir}/index.js`]
      if (!loader) {
        console.warn(`[games] ${dir} has a manifest but no index.js — skipping`)
        return null
      }
      return { manifest: { ...manifest, id: dir }, load: loader }
    })
    .filter(Boolean)
    .sort((a, b) => a.manifest.title.localeCompare(b.manifest.title))

/** @returns {object|null} catalogue entry for one id */
export const findGame = (id) => listGames().find(g => g.manifest.id === id) ?? null
