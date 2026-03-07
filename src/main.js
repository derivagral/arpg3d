/**
 * src/main.js — ES module entry point
 *
 * This replaces js/main.js as the primary bootstrap.
 * By the time this module runs, all <script> tags above it have executed:
 *   - BABYLON global is available (CDN)
 *   - Game, Player, SceneManager, etc. are available (js/ globals)
 *
 * Responsibilities:
 *   1. Create the Babylon.js engine and Game instance (render layer)
 *   2. Create sim state (pure, deterministic)
 *   3. Hook into the render loop — sim.tick() runs first, then render syncs
 *   4. Expose debug surface on window.__sim, window.__simInput
 *
 * The old Game.startGameLoop() is still running internally (it handles
 * Babylon.js enemy meshes, projectiles, UI, etc. via js/ legacy code).
 * The sim runs alongside it, with state surfaced via window.__sim().
 * Over time, sim state will take over each responsibility from the legacy layer.
 */

import { createState, tick, isRunOver } from '../sim/engine.js'
import { autoPickGate } from '../sim/autopilot.js'

window.addEventListener('DOMContentLoaded', () => {
  if (!BABYLON.Engine.isSupported()) {
    alert("WebGL not supported. Please use a modern browser.")
    return
  }

  const canvas = document.getElementById('renderCanvas')
  const engine = new BABYLON.Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    antialias: true
  })

  // ── Legacy render layer (Babylon.js game — keeps visual running) ───────────
  const game = new Game(engine, canvas)

  // ── Sim state (primary source of truth) ───────────────────────────────────
  let simState = createState(Date.now())

  // Pending input for next tick
  let pendingInput = {
    gateChoice: null,  // null = let autopilot decide (if enabled)
    autopilot: true,   // autopilot on by default
  }

  // FPS counter (dev only)
  let fpsEl = null

  // ── Inject sim tick before each Babylon render ────────────────────────────
  // We use registerBeforeRender on the game's already-running scene loop.
  // The legacy Game.startGameLoop() already registered its own beforeRender.
  // This one runs first (registration order). Both coexist safely.
  game.scene.registerBeforeRender(() => {
    if (game.state.paused) return

    const deltaMs = engine.getDeltaTime()
    const input = { ...pendingInput }
    pendingInput.gateChoice = null  // consume single-frame input

    simState = tick(simState, deltaMs, input)

    // Sync key sim stats → legacy render layer so UI reflects sim state
    syncSimToRender(simState, game)

    if (isRunOver(simState)) {
      handleRunOver(simState, game)
    }
  })

  // ── Dev surface ────────────────────────────────────────────────────────────
  const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  if (isDev) {
    // Live state snapshot — call window.__sim() in console
    window.__sim    = () => simState
    window.__game   = game

    // Input controls
    window.__pickGate    = (idx) => { pendingInput.gateChoice = idx }
    window.__setAutopilot = (on) => { pendingInput.autopilot = on }
    window.__newRun      = (seed) => { simState = createState(seed ?? Date.now()) }

    // FPS counter
    fpsEl = document.createElement('div')
    fpsEl.style.cssText = [
      'position:absolute', 'top:10px', 'right:10px',
      'color:white', 'font-family:monospace', 'font-size:14px',
      'text-shadow:2px 2px 4px rgba(0,0,0,0.8)',
      'background:rgba(0,0,0,0.5)', 'padding:5px 10px',
      'border-radius:5px', 'z-index:100', 'pointer-events:none'
    ].join(';')
    document.body.appendChild(fpsEl)
    setInterval(() => {
      const fps = engine.getFps().toFixed()
      fpsEl.textContent = `FPS: ${fps} | depth: ${simState.depth} | phase: ${simState.phase}`
      fpsEl.style.color = fps >= 55 ? '#00ff00' : fps >= 30 ? '#ffff00' : '#ff0000'
    }, 200)

    // Legacy debug commands
    window.debugCommands = buildDebugCommands(game, engine)

    console.log([
      '%c[arpg3d sim] Dev mode active',
      'background:#222;color:#0f0;padding:4px 8px;border-radius:4px'
    ].join(''), '')
    console.log([
      'Sim API:',
      '  window.__sim()            — live SimState snapshot',
      '  window.__pickGate(0|1|2)  — manually resolve next gate',
      '  window.__setAutopilot(false) — take manual control',
      '  window.__newRun(seed?)    — restart with optional seed',
      '',
      'Legacy (render layer):',
      '  window.__game             — Babylon.js Game instance',
      '  window.debugCommands      — existing debug helpers',
    ].join('\n'))
  }

  // ── Engine loop ────────────────────────────────────────────────────────────
  engine.runRenderLoop(() => {
    if (!game.state.paused || game.state.upgradesPending > 0) {
      game.scene.render()
    }
  })

  window.addEventListener('resize', () => engine.resize())

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !game.state.paused) game.togglePause()
  })

  canvas.addEventListener('contextmenu', e => e.preventDefault())

  // Mobile perf scaling
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
    engine.setHardwareScalingLevel(2)
  }
})

// ── Sync sim state → Babylon.js render layer ──────────────────────────────
// The sim and the legacy game are currently parallel — the legacy game owns
// its own health, enemies, and combat. Don't cross-write health here or the
// legacy checkGameOver() will trigger when the sim player dies.
// Expand this as each system gets ported from legacy to sim.
function syncSimToRender(_simState, _game) {
  // Nothing yet — sim surfaces via window.__sim() in dev console
}

function handleRunOver(simState, game) {
  const elapsed = simState.elapsed
  const mins = Math.floor(elapsed / 60000)
  const secs = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0')
  alert(`Sim: Run over!\nReached depth: ${simState.depth}\nTime: ${mins}:${secs}`)
}

// Preserve legacy debug commands for render-layer inspection
function buildDebugCommands(game, engine) {
  return {
    giveXP: (amount = 100) => {
      game.player.stats.xp += amount
      console.log(`[legacy] +${amount} XP`)
    },
    setHealth: (amount) => {
      game.player.stats.health = Math.min(amount, game.player.stats.maxHealth)
      game.ui.updateHealthBar()
    },
    skipToWave: (waveNum) => {
      game.spawnManager.currentWave = waveNum
      game.spawnManager.waveStartTime = Date.now()
      game.ui.showWaveIndicator(waveNum)
    },
    clearEnemies: () => {
      game.state.enemies.forEach(e => { if (e.destroy) e.destroy() })
      game.state.enemies = []
    },
    godMode: () => {
      game.player.stats.health = 99999
      game.player.stats.maxHealth = 99999
      game.player.stats.damage = 9999
      game.ui.updateHealthBar()
      console.log('[legacy] God mode')
    },
    spawnEnemy: (type = 'basic', count = 1) => {
      for (let i = 0; i < count; i++) {
        const enemy = EnemyFactory.createEnemy(type, game.scene)
        if (enemy) {
          const angle = Math.random() * Math.PI * 2
          const dist  = 12 + Math.random() * 5
          enemy.mesh.position.x = game.player.mesh.position.x + Math.cos(angle) * dist
          enemy.mesh.position.z = game.player.mesh.position.z + Math.sin(angle) * dist
          enemy.mesh.position.y = 0.5
          game.state.enemies.push(enemy)
        }
      }
    },
    getSpawnStats:          () => game.spawnManager.getStats(),
    setSpawnRate:           (m) => game.spawnManager.setModifier('spawnRateMultiplier', m),
    setSpawnCount:          (m) => game.spawnManager.setModifier('spawnCountMultiplier', m),
    toggleDifficultyScaling: () => {
      game.spawnManager.difficultyScaling.enabled = !game.spawnManager.difficultyScaling.enabled
    },
  }
}
