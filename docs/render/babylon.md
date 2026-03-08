# Render Layer — Babylon.js Notes

## CDN vs npm
Babylon.js 7.0.0 is loaded from CDN via `<script>` tag in index.html.
It is NOT imported as an npm module — it's a browser global (`BABYLON`).

Why: keeps scope small during prototyping. Migration path if needed:
1. `npm install @babylonjs/core`
2. Replace CDN tag with `import * as BABYLON from '@babylonjs/core'` in src/main.js
3. Update vite.config.js (remove the external/globals rollup config)
4. Tree-shaking then works properly.

## Vite and globals
Vite serves `src/main.js` as an ES module. The CDN Babylon.js and all `js/` script
tags load before the module executes (browser script-then-module load order).
This means `BABYLON`, `Game`, `Player`, `EnemyFactory`, etc. are all available as
globals when `src/main.js` runs — no import needed.

## Scene setup
The Babylon.js scene, camera, and engine are owned by the `Game` class (js/game.js).
`src/main.js` receives the `game` instance and hooks into `game.scene.registerBeforeRender`.

## Frame timing
`engine.getDeltaTime()` returns ms since last frame (~16.67ms at 60fps).
This value is passed directly to `tick(state, deltaMs, input)`.
The sim accumulates `elapsed` correctly even at variable frame rates.
