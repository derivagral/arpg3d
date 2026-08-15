import { resolve } from 'node:path'
import { buildClientMetadata, METADATA_FILENAME } from './src/identity/clientMetadata.js'

// Deploy-time configuration. Both default to a root-served site, which is what
// local dev and a user/org Pages site or custom domain want. A GitHub Pages
// PROJECT site is served from /<repo>/, so that deploy must set:
//
//   SITE_BASE=/arpg3d/ SITE_ORIGIN=https://<user>.github.io npm run build
//
// These are not cosmetic. They are baked into client-metadata.json, and an
// atproto authorization server fetches that document at the exact URL it was
// handed as client_id — a wrong value does not degrade, it fails sign-in.
const BASE = process.env.SITE_BASE ?? '/'
const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'http://127.0.0.1:5173'

/**
 * Emits client-metadata.json, and serves it in dev.
 *
 * Generated rather than committed because client identity in atproto OAuth is
 * origin+path-bound: production, a preview branch and localhost are three
 * different clients and need three different documents. A committed file would
 * be correct for exactly one of them.
 */
const atprotoClientMetadata = ({ origin, base }) => ({
  name: 'atproto-client-metadata',

  configureServer(server) {
    // Dev uses the loopback client_id form instead of this document (see
    // src/identity/clientMetadata.js), but serving it anyway makes the
    // generated output inspectable without a full build.
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith(`/${METADATA_FILENAME}`)) return next()
      const devOrigin = `http://${req.headers.host ?? 'localhost:5173'}`
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(buildClientMetadata(devOrigin, '/'), null, 2))
    })
  },

  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: METADATA_FILENAME,
      source: JSON.stringify(buildClientMetadata(origin, base), null, 2),
    })
  },
})

export default {
  base: BASE,

  server: {
    port: 5173,
    open: false,
    // atproto's loopback client_id form requires the redirect to land on
    // 127.0.0.1 — NOT localhost. Browsing dev at localhost:5173 completes the
    // redirect on a different origin, where the session (IndexedDB) is not
    // visible, and sign-in silently appears to do nothing.
    host: '127.0.0.1',
  },

  plugins: [atprotoClientMetadata({ origin: SITE_ORIGIN, base: BASE })],

  // Babylon.js stays on CDN — it's a global (BABYLON) not a module import.
  // The js/ legacy files also load as globals via script tags before the
  // module entry. Nothing to bundle here beyond sim/ and src/.
  build: {
    rollupOptions: {
      // Two real pages. The callback must exist as a file on disk because
      // GitHub Pages has no SPA rewrite and `redirect_uris` must resolve.
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        callback: resolve(import.meta.dirname, 'oauth/callback/index.html'),
      },
      external: ['babylonjs'],
      output: {
        globals: { babylonjs: 'BABYLON' }
      }
    }
  }
}
