export default {
  server: {
    port: 5173,
    open: false
  },
  // Babylon.js stays on CDN — it's a global (BABYLON) not a module import.
  // The js/ legacy files also load as globals via script tags before the
  // module entry. Nothing to bundle here beyond sim/ and src/.
  build: {
    rollupOptions: {
      external: ['babylonjs'],
      output: {
        globals: { babylonjs: 'BABYLON' }
      }
    }
  }
}
