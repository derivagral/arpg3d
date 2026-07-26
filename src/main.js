/**
 * src/main.js — ES module entry point
 *
 * This replaces js/main.js as the primary bootstrap.
 * By the time this module runs, all <script> tags above it have executed:
 *   - BABYLON global is available (CDN)
 *   - Game, Player, SceneManager, etc. are available (js/ globals)
 *
 * Boot flow:
 *   1. Show the pre-Babylon main menu (src/ui/mainMenu.js) — save slot CRUD
 *   2. On slot selection, create the Babylon.js engine and Game instance
 *   3. Hook into the render loop — sim.tick() runs first, then render syncs
 *   4. Autosave the active slot on wave clear, death, and page hide
 *   5. Expose debug surface on window.__sim, window.__save, etc.
 *
 * The old Game.startGameLoop() is still running internally (it handles
 * Babylon.js enemy meshes, projectiles, UI, etc. via js/ legacy code).
 * The sim runs alongside it, with state surfaced via window.__sim().
 * Over time, sim state will take over each responsibility from the legacy layer.
 */

import { createState, tick, isRunOver } from '../sim/engine.js'
import { MOVE_POLICIES } from '../sim/movement.js'
import {
  awardRun,
  summarizeRun,
  runMetaFor,
  purchaseUpgrade,
  unlockedPolicies,
  UPGRADES,
  ACHIEVEMENTS,
  upgradeCost,
} from '../sim/profile.js'
import { createSaveStore } from './storage/saveStore.js'
import { showMainMenu } from './ui/mainMenu.js'

window.addEventListener('DOMContentLoaded', () => {
  // The menu is deliberately pre-Babylon: it must work even if the CDN
  // script is still loading (or failed), so WebGL support is checked at
  // game start, not here.
  const store = createSaveStore()
  showMainMenu({
    store,
    onStart: ({ slotId, simState }) => startGame({ store, slotId, initialSim: simState }),
  })
})

function startGame({ store, slotId, initialSim }) {
  if (typeof BABYLON === 'undefined' || !BABYLON.Engine.isSupported()) {
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
  let simState = initialSim

  // ── Character profile (persistent meta, survives death) ───────────────────
  // Held in memory and written alongside the run on every persist. The sim
  // never reads it directly — it only ever sees the runMeta snapshot taken
  // when a run starts.
  let profile = store.getProfile(slotId)

  // Pending input for next tick
  let pendingInput = {
    gateChoice: null,   // null = let autopilot decide (if enabled)
    autopilot: true,    // autopilot on by default
    gateReroll: false,  // single-frame: spend gold to reroll gate options
    move: null,         // { x, z } manual movement; null = use movePolicy
    movePolicy: 'center',
  }

  // Manual movement capability: WASD/arrows feed the sim as an input vector,
  // overriding the idle policy while keys are held. Manual play is not a
  // separate code path — same tick, same balance, still deterministic.
  const held = new Set()
  const MOVE_KEYS = {
    KeyW: [0, -1], ArrowUp: [0, -1],
    KeyS: [0, 1],  ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0],  ArrowRight: [1, 0],
  }
  const readMoveKeys = () => {
    let x = 0, z = 0
    for (const code of held) {
      const v = MOVE_KEYS[code]
      if (v) { x += v[0]; z += v[1] }
    }
    return (x === 0 && z === 0) ? null : { x, z }
  }
  window.addEventListener('keydown', (e) => { if (MOVE_KEYS[e.code]) held.add(e.code) })
  window.addEventListener('keyup',   (e) => held.delete(e.code))
  window.addEventListener('blur',    () => held.clear())

  // ── Autosave ───────────────────────────────────────────────────────────────
  // Persist the active slot at checkpoints: wave clear (combat→gate), death,
  // and page hide. localStorage writes are a few KB — cheap at this cadence.
  const persist = () => {
    try {
      store.update(slotId, simState, profile)
    } catch (e) {
      console.warn('[save] autosave failed:', e)
    }
  }
  window.addEventListener('pagehide', persist)

  // FPS counter (dev only)
  let fpsEl = null

  // ── Inject sim tick before each Babylon render ────────────────────────────
  // We use registerBeforeRender on the game's already-running scene loop.
  // The legacy Game.startGameLoop() already registered its own beforeRender.
  // This one runs first (registration order). Both coexist safely.
  game.scene.registerBeforeRender(() => {
    if (game.state.paused) return

    const deltaMs = engine.getDeltaTime()
    const input = { ...pendingInput, move: pendingInput.move ?? readMoveKeys() }
    pendingInput.gateChoice = null   // consume single-frame inputs
    pendingInput.gateReroll = false

    const prevPhase = simState.phase
    simState = tick(simState, deltaMs, input)

    // Sync key sim stats → legacy render layer so UI reflects sim state
    syncSimToRender(simState, game)

    // Checkpoint on phase transitions worth keeping (wave clear, death)
    if (simState.phase !== prevPhase && (simState.phase === 'gate' || simState.phase === 'dead')) {
      persist()
    }

    // Run ended: fold it into the character profile (echoes, record depth,
    // lifetime stats, achievement unlocks), persist, then start a fresh run
    // from a NEW meta snapshot so purchases and unlocks take effect.
    if (isRunOver(simState)) {
      const { profile: earned, echoes, unlocked } = awardRun(profile, summarizeRun(simState))
      profile = earned
      persist()

      console.log(
        `[run] depth ${simState.depth} → +${echoes.total} echoes` +
        (echoes.pb > 0 ? ` (${echoes.pb} from a new record)` : '') +
        ` | ${profile.echoes} banked`
      )
      for (const a of unlocked) {
        console.log(`[unlocked] ${a.name} — ${a.desc}${a.grants ? ` → ${a.grants}` : ''}`)
      }

      simState = createState(Date.now(), runMetaFor(profile))
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
    window.__rerollGate  = () => { pendingInput.gateReroll = true }
    window.__setAutopilot = (on) => { pendingInput.autopilot = on }
    window.__setMovePolicy = (name) => {
      pendingInput.movePolicy = name
      const allowed = simState.runMeta?.policies ?? []
      if (!allowed.includes(name)) {
        console.warn(`[policy] '${name}' is not unlocked for this run — the sim will ignore it.`,
          `Unlocked: ${allowed.join(', ')}`)
      }
      return allowed
    }
    window.__movePolicies = () => ({
      all: Object.keys(MOVE_POLICIES),
      unlocked: unlockedPolicies(profile),
      activeThisRun: simState.runMeta?.policies ?? [],
    })

    // ── Meta progression ───────────────────────────────────────────────────
    window.__profile = () => profile
    window.__board = () => UPGRADES.map(u => {
      const level = profile.upgrades[u.id] ?? 0
      const cost = upgradeCost(u.id, level)
      return {
        id: u.id, name: u.name, desc: u.desc,
        level, maxLevel: u.maxLevel,
        cost: cost ?? 'MAXED',
        affordable: cost !== null && profile.echoes >= cost,
      }
    })
    window.__buy = (id) => {
      const { profile: next, bought, cost } = purchaseUpgrade(profile, id)
      if (!bought) {
        console.warn(`[board] could not buy '${id}'`,
          cost === null ? '(unknown or maxed)' : `(costs ${cost}, have ${profile.echoes})`)
        return false
      }
      profile = next
      persist()
      console.log(`[board] bought ${id} → level ${profile.upgrades[id]} (-${cost} echoes, ${profile.echoes} left).`,
        'Takes effect on the next run.')
      return true
    }
    window.__achievements = () => ACHIEVEMENTS.map(a => ({
      id: a.id, name: a.name, desc: a.desc,
      grants: a.grants ?? '—',
      earned: profile.achievements.includes(a.id),
    }))
    window.__endRun = () => { simState = { ...simState, phase: 'dead' } }
    window.__newRun      = (seed) => { simState = createState(seed ?? Date.now()) }

    // Persistence controls
    window.__save  = () => { persist(); return store.get(slotId) }
    window.__store = store

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
      '  window.__rerollGate()     — spend gold to reroll gate options',
      '  window.__setAutopilot(false) — take manual control',
      '  window.__setMovePolicy(name) — hold | center | patrol | kite',
      '  WASD / arrows             — manual movement (overrides policy)',
      '',
      'Meta (persists across deaths, per character slot):',
      '  window.__profile()        — echoes, record depth, unlocks, lifetime',
      '  window.__board()          — upgrade board with costs/affordability',
      '  window.__buy(id)          — buy a level (applies to the NEXT run)',
      '  window.__achievements()   — checklist; these grant movement policies',
      '  window.__movePolicies()   — all vs unlocked vs active this run',
      '  window.__endRun()         — end the run now and bank its echoes',
      '  window.__newRun(seed?)    — restart with optional seed',
      '  window.__save()           — force-save active slot now',
      '  window.__store            — save store (list/get/remove/...)',
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
}

// ── Sync sim state → Babylon.js render layer ──────────────────────────────
// The sim and the legacy game are currently parallel — the legacy game owns
// its own health, enemies, and combat. Don't cross-write health here or the
// legacy checkGameOver() will trigger when the sim player dies.
// Expand this as each system gets ported from legacy to sim.
function syncSimToRender(_simState, _game) {
  // Nothing yet — sim surfaces via window.__sim() in dev console
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
    // Re-draw the in-map markers for the current area from CONFIG.markers.pool
    rerollMarkers: () => {
      game.markerManager.spawn(game.areaManager.currentArea)
      const names = game.markerManager.markers.map(m => m.def.name)
      console.log('[markers] rerolled:', names.join(', ') || '(none for this area)')
    },
  }
}
