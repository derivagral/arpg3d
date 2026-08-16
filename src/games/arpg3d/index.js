/**
 * src/games/arpg3d/index.js — ARPG3D as a guest of the shell
 *
 * Exports exactly two things, per the game contract: a `manifest` and a
 * `mount()`. Everything this module needs from the outside world arrives on
 * `host` (src/host/host.js). It does not import the identity layer, does not
 * know how the player signed in, and does not touch localStorage.
 *
 * This module owns the render layer and the sim loop. It is deliberately the
 * ONLY place that reaches for the `js/` globals (Game, EnemyFactory, ...) and
 * for BABYLON, which is why the shell can boot, resolve identity and render
 * its pre-game screens without either of them having loaded.
 *
 * ── Persistence ─────────────────────────────────────────────────────────────
 * Saves go through the `saves` capability: the versioned slot store, which
 * owns the format (migration, export codes) that the generic `host.storage`
 * adapter deliberately knows nothing about. Both are fully async, so nothing
 * in this file touches `localStorage` and nothing assumes a synchronous
 * backend — the store can become IndexedDB or an HTTP API underneath without
 * a change here.
 *
 * The one exception is `pagehide`, where a promise may never resolve because
 * the page is being torn down. That path asks the store for a synchronous
 * flush and degrades to best-effort when the backend cannot offer one. See
 * the autosave block below.
 */

import { createState, tick, isRunOver } from '../../../sim/engine.js'
import { MOVE_POLICIES } from '../../../sim/movement.js'
import {
  autoEquip as autoEquipItems,
  equipFrom,
  unequipTo,
  sortContainer,
  countItems,
  loadoutScore,
  transfer,
} from '../../../sim/inventory.js'
import { itemName, itemScore, rarityInfo, SLOTS } from '../../../sim/items.js'
import {
  countUnseen,
  highestUid,
  awardRun,
  summarizeRun,
  runMetaFor,
  purchaseUpgrade,
  unlockedPolicies,
  UPGRADES,
  ACHIEVEMENTS,
  upgradeCost,
} from '../../../sim/profile.js'
import { createStashPanel } from '../../ui/stashPanel.js'
import { createNotices } from '../../ui/notices.js'

// Re-exported so a game module is self-describing when imported directly.
// The shell reads manifest.js instead, to avoid importing all of this.
export { manifest } from './manifest.js'

// Babylon colours for a dropped item's mesh, keyed by rarity. Kept here
// rather than in sim/ so the sim stays free of render concerns.
function rarityMesh(rarity) {
  const hex = rarityInfo(rarity).color
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return {
    color: new BABYLON.Color3(r, g, b),
    emissive: new BABYLON.Color3(r * 0.5, g * 0.5, b * 0.5),
  }
}

/**
 * Boot the game into `container`.
 *
 * @param {HTMLElement} container element the game may render into
 * @param {Readonly<object>} host capabilities minted by the shell
 * @returns {Promise<{ unmount(): Promise<void>, pause(): void, resume(): void }>}
 */
export async function mount(container, host) {
  if (typeof BABYLON === 'undefined' || !BABYLON.Engine.isSupported()) {
    throw new Error('WebGL is not supported in this browser.')
  }

  const { slotId, simState: initialSim } = host.launch
  const store = host.saves
  if (!slotId || !initialSim) throw new Error('arpg3d: launch requires { slotId, simState }')

  // Every listener this mount adds is tied to one signal, so unmount() can
  // drop all of them at once. Leaking a keydown handler across a remount
  // would double-apply every input.
  const teardown = new AbortController()
  const { signal } = teardown

  const canvas = container.querySelector('#renderCanvas') ?? document.getElementById('renderCanvas')
  if (!canvas) throw new Error('arpg3d: no #renderCanvas in the container')

  const engine = new BABYLON.Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    antialias: true,
  })

  // ── Legacy render layer (Babylon.js game — keeps visual running) ───────────
  const game = new Game(engine, canvas)

  // ── Sim state (primary source of truth) ───────────────────────────────────
  let simState = initialSim

  // ── Character profile (persistent meta, survives death) ───────────────────
  // Held in memory and written alongside the run on every persist. The sim
  // never reads it directly — it only ever sees the runMeta snapshot taken
  // when a run starts.
  let profile = await store.getProfile(slotId)

  // Player-level preferences the shell owns. Read once at mount: settings
  // changing mid-run is a shell concern, not something the game watches.
  const settings = host.settings ? await host.settings.get() : null

  // ── Stash screen (Bag <-> Stash <-> Equipment) ────────────────────────────
  // Reads the canonical sources (sim bag, profile stash/loadout) and hands
  // mutations back here. The legacy inventory screen (I) is a separate, older
  // surface over the legacy item system; this one is the real thing.
  // HUD nudges. Only the inventory channel exists today — see src/ui/notices.js
  // for why buff/combat channels are deliberately not here yet.
  const notices = createNotices()
  const refreshItemNotice = () => {
    const unseen = countUnseen(simState.player.inventory, profile.seenItemUid ?? 0)
    notices.set('inventory', unseen, () => game.openStashPanel())
  }
  // Opening the gear screen IS the acknowledgement — no separate dismiss.
  const markItemsSeen = () => {
    const top = highestUid(simState.player.inventory, profile.seenItemUid ?? 0)
    if (top !== (profile.seenItemUid ?? 0)) {
      profile = { ...profile, seenItemUid: top }
      persist()
    }
    refreshItemNotice()
  }

  const stashPanel = createStashPanel({
    getBag: () => simState.player.inventory,
    getEquipment: () => simState.player.equipment,
    getProfile: () => profile,
    onChange: ({ inventory, equipment, profile: nextProfile }) => {
      if (inventory || equipment) {
        simState = {
          ...simState,
          player: {
            ...simState.player,
            ...(inventory ? { inventory } : {}),
            ...(equipment ? { equipment } : {}),
          },
        }
      }
      // Mirror the loadout onto the profile so it survives a reload mid-run;
      // awardRun() also captures the run's final gear when the run ends.
      if (equipment) profile = { ...(nextProfile ?? profile), equipment }
      else if (nextProfile) profile = nextProfile
      persist()
    },
    onClose: () => {
      game.state.paused = false
      game.state.atStash = false
      game.state.stashOpen = false
    },
  })
  game.openStashPanel = () => {
    markItemsSeen()
    game.state.paused = true
    game.state.stashOpen = true
    stashPanel.open()
  }

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
  const bind = settings?.keybinds ?? {}
  const MOVE_KEYS = {
    [bind.up ?? 'KeyW']: [0, -1], ArrowUp: [0, -1],
    [bind.down ?? 'KeyS']: [0, 1],  ArrowDown: [0, 1],
    [bind.left ?? 'KeyA']: [-1, 0], ArrowLeft: [-1, 0],
    [bind.right ?? 'KeyD']: [1, 0], ArrowRight: [1, 0],
  }
  const readMoveKeys = () => {
    let x = 0, z = 0
    for (const code of held) {
      const v = MOVE_KEYS[code]
      if (v) { x += v[0]; z += v[1] }
    }
    return (x === 0 && z === 0) ? null : { x, z }
  }
  window.addEventListener('keydown', (e) => { if (MOVE_KEYS[e.code]) held.add(e.code) }, { signal })
  window.addEventListener('keyup',   (e) => held.delete(e.code), { signal })
  window.addEventListener('blur',    () => held.clear(), { signal })

  // ── Autosave ───────────────────────────────────────────────────────────────
  // Persist the active slot at checkpoints: wave clear (combat→gate), death,
  // and page hide. Writes are a few KB — cheap at this cadence.
  //
  // The store is async, so two checkpoints landing close together could
  // otherwise stack up writes. Instead an in-flight write coalesces: a
  // checkpoint arriving mid-write just marks the state dirty, and the loop
  // re-reads `simState`/`profile` and writes once more with the newest values.
  // That bounds outstanding writes at one, no matter the checkpoint rate.
  let writing = false
  let dirty = false
  const persist = async () => {
    if (writing) { dirty = true; return }
    writing = true
    try {
      do {
        dirty = false
        await store.update(slotId, simState, profile)
      } while (dirty)
    } catch (e) {
      console.warn('[save] autosave failed:', e)
    } finally {
      writing = false
    }
  }

  // Unload is the one place async persistence genuinely cannot work: the page
  // may be torn down before a promise resolves, losing the last checkpoint on
  // every tab close. Backends that can write synchronously say so, and this
  // uses that path; ones that cannot (a future HTTP backend) fall back to a
  // best-effort async write and rely on the checkpoints above.
  const persistOnUnload = () => {
    if (store.canWriteSync) store.updateSync(slotId, simState, profile)
    else persist()
  }
  window.addEventListener('pagehide', persistOnUnload, { signal })

  // FPS counter (dev only)
  let fpsEl = null
  let fpsTimer = null

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
    const prevLogLen = simState.log.length
    let newDrops = false
    simState = tick(simState, deltaMs, input)

    // Hand any new sim item drops to the render layer so it can show a pickup
    // at the next corpse. The sim already banked the item — this is display
    // only, and it replaces the legacy layer's separate Math.random() roll.
    for (let i = prevLogLen; i < simState.log.length; i++) {
      const ev = simState.log[i]
      if (ev.type !== 'item_drop') continue
      const item = (simState.player.inventory ?? []).find(it => it && it.uid === ev.payload.uid)
      if (item) game.simDropQueue.push({ ...item, fromSim: true, rarityConfig: rarityMesh(item.rarity) })
      newDrops = true
    }
    if (newDrops) refreshItemNotice()

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
      const summary = summarizeRun(simState)
      const { profile: earned, echoes, unlocked, stashed, overflow } = awardRun(profile, summary)
      profile = earned
      persist()

      // Client-reported and unverifiable by construction — see host/telemetry.js.
      host.telemetry?.report('run.ended', {
        depth: simState.depth,
        echoes: echoes.total,
        newRecord: echoes.pb > 0,
      })

      console.log(
        `[run] depth ${simState.depth} → +${echoes.total} echoes` +
        (echoes.pb > 0 ? ` (${echoes.pb} from a new record)` : '') +
        ` | ${profile.echoes} banked`
      )
      for (const a of unlocked) {
        console.log(`[unlocked] ${a.name} — ${a.desc}${a.grants ? ` → ${a.grants}` : ''}`)
      }
      if (stashed.length) console.log(`[stash] +${stashed.length} items (${countItems(profile.stash)} stored)`)
      if (overflow.length) {
        console.warn(`[stash] FULL — ${overflow.length} item(s) could not be stored and were lost.`)
      }

      simState = createState(Date.now(), runMetaFor(profile))
      refreshItemNotice()   // the bag just emptied into the stash
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
    window.__openStash = () => game.openStashPanel()

    // ── Items: run bag, stash, and loadout ─────────────────────────────────
    const describe = (item, i) => item && ({
      i, uid: item.uid, name: itemName(item), kind: item.kind,
      rarity: item.rarity, ilvl: item.ilvl, score: itemScore(item),
      affixes: item.affixes.map(a => a.id),
    })
    window.__bag = () => (simState.player.inventory ?? []).map(describe).filter(Boolean)
    window.__stash = () => (profile.stash ?? []).map(describe).filter(Boolean)
    window.__gear = () => ({
      slots: Object.fromEntries(SLOTS.map(s => [s, profile.equipment[s] ? itemName(profile.equipment[s]) : '—'])),
      score: loadoutScore(profile.equipment),
      note: 'Changes apply to the NEXT run — gear is snapshotted at run start.',
    })
    window.__equip = (stashIndex, slot) => {
      const res = equipFrom(profile.equipment, profile.stash, stashIndex, slot)
      if (!res.equipped) { console.warn(`[gear] cannot equip: ${res.reason}`); return false }
      profile = { ...profile, equipment: res.equipment, stash: res.container }
      persist()
      console.log(`[gear] equipped ${itemName(res.equipped)} → ${slot} (next run)`)
      return true
    }
    window.__unequip = (slot) => {
      const res = unequipTo(profile.equipment, profile.stash, slot)
      if (!res.removed) { console.warn(`[gear] nothing to unequip at ${slot} (or stash full)`); return false }
      profile = { ...profile, equipment: res.equipment, stash: res.container }
      persist()
      return true
    }
    window.__autoEquip = () => {
      const res = autoEquipItems(profile.equipment, profile.stash)
      profile = { ...profile, equipment: res.equipment, stash: res.container }
      persist()
      console.log(`[gear] auto-equipped ${res.changes.length} slot(s):`,
        res.changes.map(c => `${c.slot}=${itemName(c.item)}`).join(', ') || '(nothing better)')
      return window.__gear()
    }
    window.__sortStash = () => {
      profile = { ...profile, stash: sortContainer(profile.stash) }
      persist()
      return window.__stash().length
    }
    // Move an item from the live run bag straight into the stash (normally
    // this happens automatically when the run ends).
    window.__stashItem = (bagIndex) => {
      const res = transfer(simState.player.inventory, profile.stash, bagIndex)
      if (!res.moved) { console.warn('[stash] nothing moved (empty slot or stash full)'); return false }
      simState = { ...simState, player: { ...simState.player, inventory: res.from } }
      profile = { ...profile, stash: res.to }
      persist()
      return true
    }
    window.__newRun      = (seed) => { simState = createState(seed ?? Date.now()) }

    // Persistence controls
    window.__save  = async () => { await persist(); return store.get(slotId) }
    window.__store = store

    // Identity + host surface (read-only — this is everything the game can see)
    window.__player = () => host.player
    window.__exit   = (reason = 'debug') => host.exit(reason)

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
    fpsTimer = setInterval(() => {
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
      `Playing as: ${host.player.display?.handle ? '@' + host.player.display.handle : host.player.kind} (${host.player.subject})`,
      '',
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
      '',
      'Items:',
      '  window.__bag()            — items found in the current run',
      '  window.__stash()          — stored items (persists across runs)',
      '  window.__gear()           — equipped loadout + score',
      '  window.__equip(i, slot)   — equip stash item i (applies NEXT run)',
      '  window.__unequip(slot)    — return equipped gear to the stash',
      '  window.__autoEquip()      — greedily equip the best of everything',
      '  window.__sortStash()      — sort stash by item score',
      '  window.__openStash()      — open the Bag/Stash/Equipment screen',
      '  E at the stash in Home Base — open the same screen',
      '  window.__newRun(seed?)    — restart with optional seed',
      '  window.__save()           — force-save active slot now',
      '  window.__store            — save store (list/get/remove/...)',
      '',
      'Shell / host:',
      '  window.__player()         — the player snapshot this game was given',
      '  window.__exit()           — hand control back to the shell',
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

  window.addEventListener('resize', () => engine.resize(), { signal })

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !game.state.paused) game.togglePause()
  }, { signal })

  canvas.addEventListener('contextmenu', e => e.preventDefault(), { signal })

  // Mobile perf scaling
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
    engine.setHardwareScalingLevel(2)
  }

  return {
    /**
     * Give everything back. Called by the shell — never by the game itself.
     * Saves first: unmount is also the path taken when the player signs in
     * or out mid-run, and losing progress to an identity change would be an
     * unpleasant surprise.
     */
    async unmount() {
      await persist()
      teardown.abort()
      if (fpsTimer) clearInterval(fpsTimer)
      fpsEl?.remove()
      engine.stopRenderLoop()
      engine.dispose()
    },

    pause() { game.state.paused = true },
    resume() { game.state.paused = false },
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
