# Spawn System Documentation

## Overview

The new spawn system provides a scalable, flexible architecture for managing enemy spawning with support for:
- Multiple spawn patterns (circle, grid, directional, line, fixed)
- Dynamic spawn modifiers (via upgrades and runtime changes)
- Time-based difficulty scaling
- Pre-game configuration via CONFIG
- Future support for timed/triggered spawn events

## Architecture

### SpawnManager (`js/spawnManager.js`)

Central class that handles all spawning logic, extracted from the original `game.js` monolithic implementation.

**Key Features:**
- Manages wave progression
- Controls spawn timing and frequency
- Applies modifiers to spawn rate, count, and enemy stats
- Supports multiple spawn patterns
- Handles difficulty scaling over time

### Configuration (`js/config.js`)

#### Pre-game Spawn Configuration (`CONFIG.spawn`)

```javascript
spawn: {
    defaultSpawnPattern: 'circle',
    spawnDistance: 12,
    spawnDistanceVariance: 5,

    difficultyScaling: {
        enabled: true,
        timeScaleInterval: 60000,      // 60 seconds
        maxTimeScaling: 3.0,           // Cap at 3x
        spawnRateIncrease: 0.05,       // +5% per interval
        enemyStatIncrease: 0.03        // +3% per interval
    }
}
```

#### Wave Configuration (`CONFIG.waves`)

Each wave now supports:
```javascript
{
    duration: 30000,           // Wave duration (ms)
    enemies: ['basic'],        // Enemy types to spawn
    spawnRate: 2000,          // Time between spawns (ms)
    spawnCount: 1,            // Enemies per spawn
    spawnPattern: 'circle',   // Pattern type
    message: "Wave message"   // UI message
}
```

## Spawn Patterns

### 1. Circle Pattern (Default)
Spawns enemies randomly around the player in a circular pattern.
- **Use case:** Standard spawning, all-around pressure
- **Radius:** Based on `spawnDistance` + variance
- **Modifiable:** `spawnRadiusMultiplier` affects distance

### 2. Grid Pattern
Spawns enemies in a grid formation around the player.
- **Use case:** Organized waves, tactical gameplay
- **Layout:** Auto-calculates grid size based on spawn count
- **Spacing:** 3 units between enemies

### 3. Directional Pattern
Spawns enemies from a specific cardinal direction (rotates with wave).
- **Use case:** Directional pressure, forcing player movement
- **Arc:** 60-degree spread
- **Direction:** Changes with wave number

### 4. Line Pattern
Spawns enemies in a line formation.
- **Use case:** Flanking attacks, horizontal pressure
- **Rotation:** Changes each wave for variety

### 5. Fixed Pattern
Spawns enemies at predefined world positions.
- **Use case:** Arena spawns, boss encounters
- **Setup:** Use `spawnManager.addSpawnPoint(x, z)`
- **Fallback:** Uses circle pattern if no points defined

## Runtime Modifiers

The spawn system supports dynamic modifiers that can be changed by upgrades, events, map mods, or code:

```javascript
modifiers: {
    spawnRateMultiplier: 1.0,      // > 1.0 = faster spawning
    spawnCountMultiplier: 1.0,     // > 1.0 = more enemies per spawn
    enemyHealthMultiplier: 1.0,    // > 1.0 = tougher enemies
    enemyDamageMultiplier: 1.0,    // > 1.0 = stronger enemies
    spawnRadiusMultiplier: 1.0,    // > 1.0 = spawn farther away
    bossSpawnChanceMultiplier: 1.0, // > 1.0 = more bosses
    eliteChanceMultiplier: 1.0     // > 1.0 = more elites
}
```

### API Methods

**Apply permanent modifier:**
```javascript
game.spawnManager.applyModifier('spawnRateMultiplier', 1.15); // +15% spawn rate
```

**Apply temporary modifier:**
```javascript
game.spawnManager.applyModifier('spawnCountMultiplier', 2.0, 30000); // 2x for 30s
```

**Set modifier to specific value:**
```javascript
game.spawnManager.setModifier('enemyHealthMultiplier', 1.5); // Set to 1.5x
```

**Add fixed spawn point:**
```javascript
game.spawnManager.addSpawnPoint(10, 10);
game.spawnManager.addSpawnPoint(-10, -10);
```

**Clear spawn points:**
```javascript
game.spawnManager.clearSpawnPoints();
```

**Get spawn stats:**
```javascript
const stats = game.spawnManager.getStats();
console.log(stats);
// {
//   currentWave: 5,
//   spawnRate: 1200,
//   spawnCount: 2,
//   healthMultiplier: "1.15",
//   damageMultiplier: "1.10",
//   timeScaling: "1.20",
//   modifiers: {...}
// }
```

## Upgrades

Five new spawn-related upgrades have been added:

### 1. Swarm Training
- **Effect:** +20% mob count
- **Modifier:** `spawnCountMultiplier × 1.2`
- **Strategy:** More enemies = more XP and drops

### 2. Horde Master
- **Effect:** +15% spawn rate (faster spawning)
- **Modifier:** `spawnRateMultiplier × 1.15`
- **Strategy:** Test your build under pressure

### 3. Culling
- **Effect:** -30% count, +50% enemy stats
- **Modifiers:**
  - `spawnCountMultiplier × 0.7`
  - `enemyHealthMultiplier × 1.5`
  - `enemyDamageMultiplier × 1.5`
- **Strategy:** Fewer but tougher enemies, good for focused builds

### 4. Monster Magnet
- **Effect:** -25% spawn distance (enemies spawn closer)
- **Modifier:** `spawnRadiusMultiplier × 0.75`
- **Strategy:** Aggressive playstyle, faster combat

### 5. Safe Distance
- **Effect:** +40% spawn distance (enemies spawn farther)
- **Modifier:** `spawnRadiusMultiplier × 1.4`
- **Strategy:** More time to prepare, ranged builds

## Difficulty Scaling

Time-based difficulty scaling increases challenge the longer you survive:

### How It Works

Every 60 seconds (configurable):
- Spawn rate increases by 5%
- Enemy HP increases by 3%
- Enemy damage increases by 3%
- Spawn count increases (50% of spawn rate scaling)

**Caps at 3x difficulty** to prevent extreme late-game imbalance.

### Configuration

```javascript
difficultyScaling: {
    enabled: true,                 // Toggle on/off
    timeScaleInterval: 60000,      // Interval in ms
    maxTimeScaling: 3.0,           // Max multiplier
    spawnRateIncrease: 0.05,       // Rate per interval
    enemyStatIncrease: 0.03        // HP/damage per interval
}
```

### Toggle at Runtime

```javascript
game.spawnManager.difficultyScaling.enabled = false; // Disable
```

Or use debug command:
```javascript
debugCommands.toggleDifficultyScaling();
```

## Debug Commands

New debug commands for testing the spawn system:

```javascript
// Set spawn rate (2.0 = twice as fast)
debugCommands.setSpawnRate(2.0);

// Set spawn count (3.0 = 3x more enemies per spawn)
debugCommands.setSpawnCount(3.0);

// View current spawn stats
debugCommands.getSpawnStats();

// Change spawn pattern
debugCommands.setSpawnPattern('grid');
// Options: circle, grid, directional, line, fixed

// Toggle difficulty scaling
debugCommands.toggleDifficultyScaling();

// Manual enemy spawn (still works)
debugCommands.spawnEnemy('boss', 5); // Spawn 5 bosses
```

## Usage Examples

### Example 1: Create a Boss Wave

```javascript
// In config.js, add a new wave
9: {
    duration: 120000,
    enemies: ['boss'],
    spawnRate: 10000,
    spawnCount: 1,
    spawnPattern: 'fixed',
    message: "BOSS WAVE!"
}

// In game code, set up spawn points
if (game.spawnManager.currentWave === 9) {
    game.spawnManager.clearSpawnPoints();
    game.spawnManager.addSpawnPoint(0, 20);  // Spawn in front
}
```

### Example 2: Dynamic Difficulty Event

```javascript
// Create a temporary "horde mode" event
function hordeMode(duration = 30000) {
    // 3x spawn rate, 2x count for 30 seconds
    game.spawnManager.applyModifier('spawnRateMultiplier', 3.0, duration);
    game.spawnManager.applyModifier('spawnCountMultiplier', 2.0, duration);
    console.log('HORDE MODE ACTIVATED!');
}

// Trigger it
hordeMode(30000);
```

### Example 3: Custom Upgrade - Timed Boost

```javascript
// In CONFIG.upgrades, add:
{
    name: "Adrenaline Rush",
    description: "Extreme spawning for 60s",
    stat: "3x Rate, 2x Count (60s)",
    apply: (game) => {
        game.spawnManager.applyModifier('spawnRateMultiplier', 3.0, 60000);
        game.spawnManager.applyModifier('spawnCountMultiplier', 2.0, 60000);
    }
}
```

### Example 4: Schedule Future Spawn Event

```javascript
// Schedule a special spawn in 2 minutes
game.spawnManager.scheduleSpawnEvent({
    triggerTime: Date.now() + 120000,
    callback: (manager) => {
        // Custom spawn logic
        manager.applyModifier('bossSpawnChanceMultiplier', 10.0, 30000);
        console.log('Boss spawn chance increased for 30s!');
    }
});
```

## Elite Enemy System

Any non-boss enemy can be promoted to elite on spawn. Elites have boosted stats, unique abilities, gold visuals, and better drops.

### Elite Promotion

Handled in `SpawnManager.createEnemy()` → `promoteToElite()`:
- Base chance: 5% + 1% per wave, capped at 25% (configurable in `CONFIG.elite`)
- Scaled by `eliteChanceMultiplier` modifier

### Elite Stats (defaults in `CONFIG.elite`)

| Property | Multiplier |
|----------|-----------|
| Health | 2.5x |
| Damage | 1.8x |
| Size | 1.3x |
| XP | 3x |
| Drop chance | 3x (gold, items, health) |

### Elite Visuals

- Golden emissive tint (lerp 40% toward gold)
- Orbiting torus ring (parented to mesh, rotates in `update()`)

### Unique Elite Abilities

Each type gets one telegraphed ability on a 5s cooldown:

| Type | Ability | Telegraph | Effect |
|------|---------|-----------|--------|
| Basic | Ground Slam | AOE circle r=2, 800ms | 1.5x damage in area |
| Fast | Dash Strike | Direction line, 600ms | 6-unit lunge, 2x damage on contact |
| Tank | Shockwave | AOE circle r=3.5, 1000ms | 1.2x damage in area |
| Swarm | Split | AOE circle r=1.5, 500ms | Spawns 3 mini swarm on death (one-time) |
| Explosive | Chain Detonation | AOE circle r=4, 1000ms | Larger explosion + 2s burning ground |
| Ranged | Triple Shot | 3 direction lines, 500ms | 3-projectile spread |

### Map Mod Integration

All elite parameters flow through the existing modifier API:
```javascript
game.spawnManager.applyModifier('eliteChanceMultiplier', 3.0);  // 3x elite rate
game.spawnManager.applyModifier('eliteChanceMultiplier', 0, 60000); // No elites for 60s
// Enemy stat modifiers also apply to elites (multiplicative):
game.spawnManager.applyModifier('enemyHealthMultiplier', 2.0);  // All enemies 2x HP
```

## Attack Indicator System

Visual telegraphs for enemy attacks, managed by `AttackIndicatorManager` (`js/attackIndicators.js`).

### Indicator Types

**AOE Circle** — Filling disc on ground with pulsing border ring. Duration configurable per attack (500-1000ms). Fires `onComplete` callback when telegraph ends, giving the player a real dodge window.

**Directional Line** — Flat box on ground showing attack direction. Fades in over 30% of duration, holds, fades out over final 20%.

**Projectile Path** — Dashed line (alternating box segments) along enemy projectile trajectory. Low alpha, 500ms lifetime.

### Configuration (`CONFIG.indicators`)

```javascript
indicators: {
    aoe: { fillColor: [1, 0.3, 0.1], borderColor: [1, 0, 0], alpha: 0.2, borderAlpha: 0.3 },
    line: { color: [1, 0.2, 0.1], alpha: 0.2, width: 0.3 },
    projectilePath: { color: [1, 0.5, 0.5], alpha: 0.1, segmentCount: 6, length: 8 },
    enabled: true
}
```

### API

```javascript
// AOE with callback (attack fires after telegraph)
game.indicatorManager.createAOEIndicator(position, radius, durationMs, colorArray, onComplete);

// Directional line
game.indicatorManager.createLineIndicator(from, to, width, durationMs, colorArray);

// Projectile path (auto-created in addEnemyProjectile when enabled)
game.indicatorManager.createProjectilePath(from, direction, length, durationMs, colorArray);

// Cleanup
game.indicatorManager.clear();
```

### Rendering

All indicators use renderingGroup 1 with `disableDepthWrite` to avoid Z-fighting with the ground plane.

## Future Enhancements

The system is designed to support:

1. **Event System** - Fully implemented spawn event queue for timed/triggered spawns
2. **Custom Spawn Functions** - Easy to add new patterns via `spawnPatterns` object
3. **Conditional Spawning** - Can add logic based on player stats, time, enemies alive, etc.
4. **Boss Mechanics** - Special spawn points, phases, minion spawning
5. **Arena System** - Define spawn zones, enable/disable based on player location

## Migration Notes

### Changes from Original System

**Before:**
- Spawn logic in `game.js` (monolithic)
- Wave state in `game.state.currentWave`
- Simple circular spawning only
- No runtime modifiers

**After:**
- Spawn logic in `SpawnManager` class
- Wave state in `game.spawnManager.currentWave`
- 5 spawn patterns + extensible
- Full modifier system with upgrades

### Compatibility

- All existing wave configs work without changes
- New wave properties are optional (defaults used)
- Debug commands updated to use SpawnManager
- UI updated to reference `spawnManager.currentWave`

## Performance

The SpawnManager adds minimal overhead:
- Single update call per frame
- Efficient modifier calculations (simple multiplication)
- No additional loops or complex algorithms
- Pattern functions are lightweight

## Conclusion

The spawn system provides a solid foundation for:
- ✅ Pre-game configuration
- ✅ Dynamic in-game modifications
- ✅ Multiple spawn patterns
- ✅ Upgrade-based modifiers
- ✅ Time-based scaling
- ✅ Extensibility for events

You now have full control over enemy spawning with both static configuration and dynamic runtime adjustments!
